import type { GenerationAuthorInput, GenerationRecoveryContext } from '../../../shared/generation-owner-contract'
import { isDraftVisibleTextVersion } from '../../../shared/draft-visible-text'
import { DRAFT_RECONCILE_PURPOSE } from '../../../shared/draft-reconciliation'
import { DRAFT_SHORT_OUTLINE_PURPOSE } from '../../../shared/draft-short-outline'
import type { MainGenerationRunView } from '../../generation/generation-runtime'

/**
 * 写稿恢复分类的唯一裁决点。原先 `GenerateDraftCommand.execute` 里用 6 个布尔量的
 * 交叉组合表达「这次恢复能不能续、该走哪条路」；这里收拢为一个判别联合，准入顺序
 * （范围 → 模式 → 作者输入 → 来源选择）与拒绝码全部表驱动，可穷举测试。
 *
 * 分类是纯函数：不取数、不发请求、不改状态。`generation:read-context` 与
 * `generation:read` 的数据读取留在调用方；`needsFailedBatchView` 只声明是否需要读。
 */
export type DraftRecoveryPlan =
  | { kind: 'fresh' }
  | { kind: 'resume-composition' }
  | { kind: 'retry-outline' }
  | { kind: 'resume-outlined' }
  | { kind: 'resume-reconciled' }
  | { kind: 'retry-failed-batch' }
  | { kind: 'rejected'; code: DraftRecoveryRejectionCode }

export type DraftRecoveryRejectionCode =
  | 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED'
  | 'GENERATION_DRAFT_RECOVERY_AUTHOR_INPUT_CHANGED'
  | 'GENERATION_DRAFT_RECOVERY_SOURCE_SELECTION_CHANGED'

/**
 * 对账与短细纲的产物 id。它们是计划产物，永远不允许被确认（acknowledge）成正文，
 * 也不允许计入失败批次的可重放证据。
 */
export function planningArtifactIds(recovery: GenerationRecoveryContext | null): readonly string[] {
  return [...(recovery?.draftReconciliation?.artifactIds ?? []), ...(recovery?.draftShortOutline?.artifactIds ?? [])]
}

/**
 * 是否需要先读失败批次的 run view 才能完成分类。这是批次重试检查的廉价前置条件；
 * 不满足时调用方不得发起 `generation:read`。
 */
export function needsFailedBatchView(recovery: GenerationRecoveryContext | null, batchId: string | undefined): boolean {
  return !!recovery && !!batchId && recovery.batchId === batchId
    && !recovery.composition && recovery.draftSave.kind === 'absent'
    && recovery.lastCompositionFinishReason === null
    && recovery.attemptedPurposes.at(-1) === 'chapter-draft'
}

export interface DraftRecoveryExpectations {
  chapterNumber: number
  batchId?: string
  /** 批次重试要求 run view 仍是同一个 run。 */
  resumeRunId?: string
  authorInputs: readonly GenerationAuthorInput[]
  selectedDraftIds: readonly number[]
  selectedFinalizedDraftIds: readonly number[]
  selectedBlueprintChapterNumbers: readonly number[]
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return JSON.stringify([...new Set(left)].sort((a, b) => a - b))
    === JSON.stringify([...new Set(right)].sort((a, b) => a - b))
}

function isResumableComposition(recovery: GenerationRecoveryContext): boolean {
  return !!recovery.composition && isDraftVisibleTextVersion(recovery.composition.algorithm)
    && ['stop', 'length'].includes(recovery.lastCompositionFinishReason ?? '')
}

function isRetryableFailedBatch(input: {
  recovery: GenerationRecoveryContext
  view: MainGenerationRunView | null
  batchId?: string
  resumeRunId?: string
}): boolean {
  if (!input.view || !needsFailedBatchView(input.recovery, input.batchId)) return false
  const view = input.view
  const lastAttempt = view.budgetDiagnostics?.at(-1)
  const planningIds = new Set(planningArtifactIds(input.recovery))
  return view.status === 'running' && !view.nonReplayable
    && view.handle.runId === input.resumeRunId && (view.ledger?.physicalRequests ?? 0) > 0
    && !view.ledger?.blockedCode && lastAttempt?.finishReason === null
    && (lastAttempt.failureCode === 'GENERATION_PROVIDER_FAILED' || lastAttempt.failureCode === 'NETWORK_ERROR')
    && ![...view.artifacts, ...(view.candidates ?? [])].some(artifact => !planningIds.has(artifact.artifactId) && artifact.text.trim())
    && !view.unsavedTails?.some(tail => tail.text.trim())
}

export function classifyDraftRecovery(input: {
  recovery: GenerationRecoveryContext | null
  failedBatchView: MainGenerationRunView | null
  expected: DraftRecoveryExpectations
}): DraftRecoveryPlan {
  const { recovery, failedBatchView, expected } = input
  if (!recovery) return { kind: 'fresh' }
  if (recovery.operation !== 'chapter-draft' || recovery.chapterNumber !== expected.chapterNumber) {
    return { kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' }
  }
  const retryOutline = recovery.draftShortOutline?.retry?.kind === 'available'
  const outlinedOnly = !!recovery.draftShortOutline?.completedOutput && !recovery.composition
    && recovery.attemptedPurposes.every(purpose => purpose === DRAFT_SHORT_OUTLINE_PURPOSE)
  const reconciledOnly = !recovery.composition && recovery.draftSave.kind === 'absent'
    && recovery.attemptedPurposes.length > 0
    && recovery.attemptedPurposes.every(purpose => purpose === DRAFT_RECONCILE_PURPOSE)
  const retryFailedBatch = isRetryableFailedBatch({
    recovery, view: failedBatchView, batchId: expected.batchId, resumeRunId: expected.resumeRunId,
  })
  const mode: DraftRecoveryPlan['kind'] = retryOutline ? 'retry-outline'
    : outlinedOnly ? 'resume-outlined'
      : reconciledOnly ? 'resume-reconciled'
        : retryFailedBatch ? 'retry-failed-batch'
          : isResumableComposition(recovery) ? 'resume-composition'
            : 'rejected'
  if (mode === 'rejected') return { kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_EVIDENCE_REQUIRED' }
  if (recovery.authorInputs
    && expected.authorInputs.some(item => recovery.authorInputs.find(other => other.id === item.id)?.text !== item.text)) {
    return { kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_AUTHOR_INPUT_CHANGED' }
  }
  if (!sameIds(recovery.selectedDraftIds, expected.selectedDraftIds)
    || !sameIds(recovery.selectedFinalizedDraftIds, expected.selectedFinalizedDraftIds)
    || !sameIds(recovery.selectedBlueprintChapterNumbers, expected.selectedBlueprintChapterNumbers)) {
    return { kind: 'rejected', code: 'GENERATION_DRAFT_RECOVERY_SOURCE_SELECTION_CHANGED' }
  }
  return { kind: mode }
}
