import { describe, expect, it } from 'vitest'
import { classifyDraftRecovery, needsFailedBatchView, planningArtifactIds } from '../draft-recovery-plan'
import type { GenerationRecoveryContext } from '../../../../shared/generation-owner-contract'
import { DRAFT_VISIBLE_TEXT_VERSION } from '../../../../shared/draft-visible-text'
import type { MainGenerationRunHandle, MainGenerationRunView } from '../../../generation/generation-runtime'

const handle: MainGenerationRunHandle = { projectId: 'p', epoch: 'e', rootActionId: 'r', runId: 'run-1' }

function baseRecovery(overrides: Partial<GenerationRecoveryContext> = {}): GenerationRecoveryContext {
  return {
    modelId: 'm',
    handle,
    operation: 'chapter-draft',
    chapterNumber: 3,
    authorInputs: [{ id: 'draft:chapter-info', text: 'info' }, { id: 'draft:target-units', text: '3000' }],
    selectedDraftIds: [],
    selectedFinalizedDraftIds: [],
    selectedBlueprintChapterNumbers: [3, 4, 5, 6, 7, 8],
    composition: null,
    lastCompositionFinishReason: null,
    attemptedPurposes: [],
    draftSave: { kind: 'absent' },
    ...overrides,
  }
}

const expected = {
  chapterNumber: 3,
  authorInputs: [{ id: 'draft:chapter-info', text: 'info' }, { id: 'draft:target-units', text: '3000' }],
  selectedDraftIds: [],
  selectedFinalizedDraftIds: [],
  selectedBlueprintChapterNumbers: [3, 4, 5, 6, 7, 8],
}

function runView(overrides: Partial<MainGenerationRunView> = {}): MainGenerationRunView {
  return {
    handle,
    budget: { maxAttempts: 9, maxRequestedOutputTokens: 32_768, maxRequestedOutputTokensPerAttempt: 8192, deadlineAt: Date.now() + 60_000 },
    status: 'running',
    nonReplayable: false,
    artifacts: [],
    ...overrides,
  } as MainGenerationRunView
}

function classify(recovery: GenerationRecoveryContext | null, failedBatchView: MainGenerationRunView | null = null) {
  return classifyDraftRecovery({ recovery, failedBatchView, expected })
}

describe('classifyDraftRecovery', () => {
  it('classifies a missing recovery context as fresh', () => {
    expect(classify(null)).toEqual({ kind: 'fresh' })
  })

  it.each([
    ['operation', baseRecovery({ operation: 'blueprint-draft' })],
    ['chapterNumber', baseRecovery({ chapterNumber: 4 })],
  ])('rejects a %s mismatch before any mode, even with an outline retry available', (_field, recovery) => {
    const withRetry = { ...recovery, draftShortOutline: { artifactIds: ['o'], completedOutput: null, promptHash: 'h', retry: { kind: 'available' as const, failedAttemptId: 'f' } } }
    expect(classify(withRetry)).toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' })
  })

  it('names the outline retry when the short outline has a retryable failed attempt', () => {
    const recovery = baseRecovery({
      attemptedPurposes: ['chapter-draft-short-outline'],
      draftShortOutline: { artifactIds: ['o'], completedOutput: null, promptHash: 'h', retry: { kind: 'available', failedAttemptId: 'f' } },
    })
    expect(classify(recovery)).toEqual({ kind: 'retry-outline' })
  })

  it('names resume-outlined when only the outline completed', () => {
    const recovery = baseRecovery({
      attemptedPurposes: ['chapter-draft-short-outline'],
      draftShortOutline: { artifactIds: ['o'], completedOutput: '计划', promptHash: 'h', retry: { kind: 'unavailable' } },
    })
    expect(classify(recovery)).toEqual({ kind: 'resume-outlined' })
  })

  it('names resume-reconciled when only the reconciliation completed', () => {
    const recovery = baseRecovery({
      attemptedPurposes: ['chapter-draft-reconcile'],
      draftReconciliation: { artifactIds: ['r'], completedOutput: '对账' },
    })
    expect(classify(recovery)).toEqual({ kind: 'resume-reconciled' })
  })

  it('names resume-composition for a current composition with a settled finish reason', () => {
    const recovery = baseRecovery({
      attemptedPurposes: ['chapter-draft-short-outline', 'chapter-draft'],
      composition: { algorithm: DRAFT_VISIBLE_TEXT_VERSION, text: '正文', textHash: 'h', artifactIds: ['a'], sources: [] },
      lastCompositionFinishReason: 'length',
      draftShortOutline: { artifactIds: ['o'], completedOutput: '计划', promptHash: 'h', retry: { kind: 'unavailable' } },
    })
    expect(classify(recovery)).toEqual({ kind: 'resume-composition' })
  })

  it.each([null, 'draft-visible-v0'] as const)('rejects an unrestorable composition: %s', variant => {
    const recovery = baseRecovery({
      composition: variant === null ? null : { algorithm: variant, text: '正文', textHash: 'h', artifactIds: ['a'], sources: [] } as never,
      lastCompositionFinishReason: variant === null ? null : 'content_filter',
    })
    expect(classify(recovery)).toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' })
  })

  it('rejects a recovery context with no admissible mode', () => {
    expect(classify(baseRecovery({ attemptedPurposes: ['chapter-draft-continuation'] })))
      .toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' })
  })

  describe('retry-failed-batch', () => {
    const batchExpected = { ...expected, batchId: 'b1', resumeRunId: 'run-1' }
    const retryableView = runView({
      budgetDiagnostics: [{ finishReason: null, failureCode: 'NETWORK_ERROR' } as never],
      ledger: { policy: {} as never, tokenLiability: 0, physicalRequests: 2, activeElapsedMs: 0, blockedCode: null },
    })
    const batchRecovery = () => baseRecovery({
      batchId: 'b1',
      attemptedPurposes: ['chapter-draft'],
    })

    it('names retry-failed-batch for a clean provider/network failure with no usable artifacts', () => {
      expect(classifyDraftRecovery({ recovery: batchRecovery(), failedBatchView: retryableView, expected: batchExpected }))
        .toEqual({ kind: 'retry-failed-batch' })
    })

    it('rejects when an artifact holds real prose outside the planning receipts', () => {
      const view = { ...retryableView, artifacts: [{ artifactId: 'prose', text: '正文' } as never] }
      expect(classifyDraftRecovery({ recovery: batchRecovery(), failedBatchView: view, expected: batchExpected }))
        .toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' })
    })

    it('rejects when the view belongs to a different run', () => {
      const view = runView({ handle: { ...handle, runId: 'other-run' }, nonReplayable: false })
      expect(classifyDraftRecovery({ recovery: batchRecovery(), failedBatchView: view, expected: batchExpected }))
        .toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' })
    })

    it('rejects when unsaved tails still hold text', () => {
      const view = runView({
        budgetDiagnostics: [{ finishReason: null, failureCode: 'GENERATION_PROVIDER_FAILED' } as never],
        ledger: { policy: {} as never, tokenLiability: 0, physicalRequests: 1, activeElapsedMs: 0, blockedCode: null },
        unsavedTails: [{ attemptId: 'a', artifactId: 't', durableRevision: 1, text: '尾', failureCode: 'GENERATION_PROVIDER_FAILED' }],
      })
      expect(classifyDraftRecovery({ recovery: batchRecovery(), failedBatchView: view, expected: batchExpected }))
        .toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' })
    })
  })

  it('rejects changed author inputs even when a mode is available', () => {
    const recovery = baseRecovery({
      attemptedPurposes: ['chapter-draft-short-outline'],
      draftShortOutline: { artifactIds: ['o'], completedOutput: '计划', promptHash: 'h', retry: { kind: 'unavailable' } },
      authorInputs: [{ id: 'draft:chapter-info', text: 'changed' }, { id: 'draft:target-units', text: '3000' }],
    })
    expect(classify(recovery)).toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_AUTHOR_INPUT_CHANGED' })
  })

  it('rejects changed source selection after the mode check passes', () => {
    const recovery = baseRecovery({
      attemptedPurposes: ['chapter-draft-short-outline'],
      draftShortOutline: { artifactIds: ['o'], completedOutput: '计划', promptHash: 'h', retry: { kind: 'unavailable' } },
      selectedDraftIds: [9],
    })
    expect(classify(recovery)).toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_SOURCE_SELECTION_CHANGED' })
  })

  it('reports the mode failure, not later checks, when the mode itself is invalid', () => {
    const recovery = baseRecovery({
      attemptedPurposes: [],
      authorInputs: [{ id: 'draft:chapter-info', text: 'changed' }],
    })
    expect(classify(recovery)).toEqual({ kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' })
  })
})

describe('needsFailedBatchView', () => {
  it('requires the batch id, an absent save, no composition, and a last chapter-draft attempt', () => {
    const gate = (overrides: Partial<GenerationRecoveryContext>, batchId?: string) =>
      needsFailedBatchView(baseRecovery(overrides), batchId)
    expect(gate({ batchId: 'b1', attemptedPurposes: ['chapter-draft'] }, 'b1')).toBe(true)
    expect(gate({ batchId: 'b1', attemptedPurposes: ['chapter-draft'] }, undefined)).toBe(false)
    expect(gate({ batchId: 'b1', attemptedPurposes: ['chapter-draft'] }, 'b2')).toBe(false)
    expect(gate({ batchId: 'b1', attemptedPurposes: ['chapter-draft-continuation'] }, 'b1')).toBe(false)
    expect(gate({ batchId: 'b1', attemptedPurposes: ['chapter-draft'], lastCompositionFinishReason: 'stop' }, 'b1')).toBe(false)
    expect(gate({ batchId: 'b1', attemptedPurposes: ['chapter-draft'], draftSave: { kind: 'current', receipt: {} as never } }, 'b1')).toBe(false)
    expect(needsFailedBatchView(null, 'b1')).toBe(false)
  })
})

describe('planningArtifactIds', () => {
  it('merges reconciliation and short outline artifact ids and tolerates absence', () => {
    expect(planningArtifactIds(baseRecovery({
      draftReconciliation: { artifactIds: ['r1'], completedOutput: null },
      draftShortOutline: { artifactIds: ['o1', 'o2'], completedOutput: null, promptHash: 'h', retry: { kind: 'unavailable' } },
    }))).toEqual(['r1', 'o1', 'o2'])
    expect(planningArtifactIds(null)).toEqual([])
  })
})
