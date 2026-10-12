import type { DraftMeta } from '../../services/draft-index'
import type { NovelConfig } from '../../shared/ipc-channels'
import type { EditorTab } from '../editor-store'
import type { WorkflowRun } from '../workflow-store'
import type { ResourcePage, WorkStage } from './navigation-intents'
import type { StageWork } from './stage-store'

/** 设定的必填项，与设定画板一致：一段核心大纲，加类型、篇幅、目标读者三项。 */
export type SetupField = 'coreOutline' | 'genre' | 'length' | 'targetAudience'
export const SETUP_FIELDS: readonly SetupField[] = ['coreOutline', 'genre', 'length', 'targetAudience']

/**
 * 架构的四节：故事前提、角色名单、世界观、情节大纲。
 * ia.md 写的是「4 节均已确认」，但产品里各节没有确认状态（ArchitectureConfirmDialog 只是生成前勾选步骤），
 * 所以取旧外壳侧栏与架构页同一个判定：这一节已有内容（checkArchStatus）。
 */
export const ARCHITECTURE_SECTIONS = ['premise', 'characters', 'worldbuilding', 'synopsis'] as const

/** 完成为实心勾选圆，进行中为按比例填充的进度环，未开始为虚线圆。 */
export type StageProgress =
  | { state: 'done' }
  | { state: 'active'; ratio: number }
  | { state: 'todo' }

export type StageStatus =
  | { stage: 'setup'; progress: StageProgress; missing: readonly SetupField[] }
  | { stage: 'architecture'; progress: StageProgress; filled: number; total: number }
  /** total 是设定里的规划章数；至少 1 章蓝图即完成，planned / total 只作进度说明。 */
  | { stage: 'blueprint'; progress: StageProgress; planned: number; total: number }
  | { stage: 'manuscript'; progress: StageProgress; finalized: number; total: number }

/** 一章所处的位置：待写、草稿（待审稿）、已审稿（待修稿）、已修稿（待定稿）、定稿。 */
export type ChapterPhase = 'todo' | 'draft' | 'reviewed' | 'revised' | 'final'

export interface ChapterRow {
  number: number
  title: string
  phase: ChapterPhase
  /** 有工作流正在写这一章。 */
  running: boolean
  /** 打开这一章时载入的稿：有定稿之后才建的未归档草稿时取它，否则取定稿，再否则取最新的未归档草稿；待写章为空。 */
  draft: DraftMeta | null
}

export interface WorkFacts {
  config: Pick<NovelConfig, 'coreOutline' | 'genre' | 'targetAudience' | 'totalChapters' | 'wordsPerChapter'>
  architecture: StageWork['architecture']
  blueprints: StageWork['blueprints']
  drafts: Readonly<Record<number, readonly DraftMeta[]>>
  runningChapters: ReadonlySet<number>
}

const DONE: StageProgress = { state: 'done' }
const TODO: StageProgress = { state: 'todo' }

function fraction(done: number, total: number): StageProgress {
  if (total <= 0 || done <= 0) return TODO
  return done >= total ? DONE : { state: 'active', ratio: done / total }
}

export function missingSetup(config: WorkFacts['config']): SetupField[] {
  const blank = (value: string | undefined) => !value?.trim()
  return SETUP_FIELDS.filter(field => field === 'length'
    ? !(config.totalChapters > 0 && config.wordsPerChapter > 0)
    : blank(config[field]))
}

/**
 * 四个阶段的状态，顺序固定为设定、架构、蓝图、正文。完成判定按 ia.md：设定必填项齐全，架构四节都有内容，
 * 蓝图至少 1 章（分批规划的作品不会因为没规划完就一直停在蓝图），正文按章统计。
 * 定稿章数与章节列表同源：定稿之后又建了草稿的章按草稿算，不计入定稿。
 */
export function deriveStages(facts: WorkFacts, chapters: readonly ChapterRow[] = deriveChapters(facts)): StageStatus[] {
  const missing = missingSetup(facts.config)
  const filled = ARCHITECTURE_SECTIONS.filter(section => facts.architecture[section]).length
  const total = Math.max(0, facts.config.totalChapters || 0)
  const planned = facts.blueprints.length
  const finalized = chapters.filter(row => row.phase === 'final').length
  const started = chapters.some(row => row.phase !== 'todo')
  return [
    { stage: 'setup', missing,
      progress: missing.length === 0 ? DONE : { state: 'active', ratio: (SETUP_FIELDS.length - missing.length) / SETUP_FIELDS.length } },
    { stage: 'architecture', filled, total: ARCHITECTURE_SECTIONS.length, progress: fraction(filled, ARCHITECTURE_SECTIONS.length) },
    { stage: 'blueprint', planned, total, progress: planned > 0 ? DONE : TODO },
    { stage: 'manuscript', finalized, total,
      progress: total > 0 && finalized >= total ? DONE : started ? { state: 'active', ratio: total > 0 ? finalized / total : 0 } : TODO },
  ]
}

const IN_PROGRESS: Partial<Record<DraftMeta['status'], ChapterPhase>> = { draft: 'draft', reviewed: 'reviewed', revised: 'revised' }

/**
 * 这份稿在定稿之后才建（版本历史「回退到此版本」会在定稿章上新建草稿）。草稿箱允许给较旧的版本定稿，
 * 所以不能按版本号比：定稿前就有的更高版本不算。定稿时间取定稿稿的 updated_at（定稿后不可再改）；
 * 两者同为数据库 datetime('now') 的写法，可直接按字符串比；同一秒内分不出先后时退回按版本号。
 */
function createdAfterFinal(draft: DraftMeta, final: DraftMeta): boolean {
  const finalizedAt = final.updatedAt
  if (!finalizedAt || draft.createdAt === finalizedAt) return draft.version > final.version
  return draft.createdAt > finalizedAt
}

/** 正文阶段的章节列表：蓝图章与已有稿的章取并集，按章号排序。 */
export function deriveChapters(facts: Pick<WorkFacts, 'blueprints' | 'drafts' | 'runningChapters'>): ChapterRow[] {
  const titles = new Map(facts.blueprints.map(blueprint => [blueprint.chapterNumber, blueprint.title]))
  const numbers = new Set([...titles.keys(), ...Object.keys(facts.drafts).map(Number)])
  return [...numbers].sort((a, b) => a - b).map(number => {
    const drafts = facts.drafts[number] ?? []
    const final = drafts.find(draft => draft.status === 'finalized') ?? null
    const latest = drafts.filter(draft => IN_PROGRESS[draft.status]).sort((a, b) => b.version - a.version)[0] ?? null
    const working = latest && (!final || createdAfterFinal(latest, final)) ? latest : null
    return {
      number,
      title: titles.get(number) || final?.chapterTitle || '',
      phase: working ? IN_PROGRESS[working.status]! : final ? 'final' : 'todo',
      running: facts.runningChapters.has(number),
      draft: working ?? final,
    }
  })
}

/** 点「正文」时打开的章：最早一章写到一半的，其次最早待写的，都没有时取最后一章定稿。 */
export function focusChapter(rows: readonly ChapterRow[]): ChapterRow | null {
  return rows.find(row => row.phase !== 'todo' && row.phase !== 'final')
    ?? rows.find(row => row.phase === 'todo')
    ?? rows.at(-1)
    ?? null
}

/** 打开作品时落在第一个未完成的阶段；四个阶段都完成时落在正文。 */
export function landingStage(stages: readonly StageStatus[]): WorkStage {
  return stages.find(status => status.progress.state !== 'done')?.stage ?? 'manuscript'
}

export type StageLocation =
  | { kind: 'stage'; stage: WorkStage; chapter?: number }
  | { kind: 'resource'; page: ResourcePage }

const TAB_LOCATION: Record<EditorTab['type'], StageLocation> = {
  config: { kind: 'stage', stage: 'setup' },
  'world-building': { kind: 'stage', stage: 'architecture' },
  'arch-file': { kind: 'stage', stage: 'architecture' },
  character: { kind: 'stage', stage: 'architecture' },
  outline: { kind: 'stage', stage: 'architecture' },
  'chapter-card': { kind: 'stage', stage: 'blueprint' },
  chapter: { kind: 'stage', stage: 'manuscript' },
  'review-report': { kind: 'stage', stage: 'manuscript' },
  diff: { kind: 'stage', stage: 'manuscript' },
  'narrative-thread': { kind: 'resource', page: 'plot' },
  knowledge: { kind: 'resource', page: 'knowledge' },
  'version-history': { kind: 'resource', page: 'history' },
}

/** 当前标签属于哪个阶段或资料页；正文类标签带上章号。 */
export function locate(tab: Pick<EditorTab, 'type' | 'chapterNumber'> | undefined): StageLocation | null {
  if (!tab) return null
  const location = TAB_LOCATION[tab.type]
  return location.kind === 'stage' && location.stage === 'manuscript' && tab.chapterNumber !== undefined
    ? { ...location, chapter: tab.chapterNumber }
    : location
}

/** 工作流正在写的章：运行声明的资源里形如 chapter:<章号> 的那些。 */
export function runningChapters(runs: readonly { resourceKeys?: readonly string[] }[]): Set<number> {
  const numbers = new Set<number>()
  for (const run of runs) {
    for (const key of run.resourceKeys ?? []) {
      const match = /^chapter:(\d+)$/.exec(key)
      if (match) numbers.add(Number(match[1]))
    }
  }
  return numbers
}

/** 整个运行的完成比例：已完成步骤加当前步骤自身的进度。 */
export function runProgress(run: Pick<WorkflowRun, 'steps' | 'currentStepIndex'>): number {
  if (run.steps.length === 0) return 0
  const completed = run.steps.filter(step => step.status === 'completed' || step.status === 'skipped').length
  const current = run.steps[run.currentStepIndex]
  const partial = current && current.status === 'running' ? (current.progress ?? 0) / 100 : 0
  return Math.min(1, (completed + partial) / run.steps.length)
}
