import { useEffect, useMemo, useRef } from 'react'
import { checkArchStatus } from '../../services/architecture-service'
import { ipc } from '../../services/ipc-client'
import { globalEventBus } from '../../shared/event-bus'
import { sameProjectPathKey, sameProjectSessionContext } from '../../shared/project-session-context'
import { useDraftStore } from '../../stores/draft-store'
import { useEditorStore } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import {
  deriveChapters, deriveStages, landingStage, locate, missingSetup, runningChapters,
  type ChapterRow, type StageLocation, type StageStatus,
} from '../../stores/navigation/stage-progress'
import { useStageStore } from '../../stores/navigation/stage-store'
import { navigate } from '../../stores/navigation/navigation-intents'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore, type WorkflowRun } from '../../stores/workflow-store'
import { shouldRefreshBlueprints } from '../editor/blueprint-refresh'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { toast } from '../ui/Toast'

let refreshSequence = 0

/**
 * 读一次流程脊需要而 project-store、draft-store 里没有的数据：架构四节是否已有内容、蓝图章号与标题；草稿顺带刷新。
 * 守卫与项目树的刷新相同：只认最后一次请求，项目会话或会话代数变了就丢弃结果。
 */
export async function refreshStageWork(text: (zh: string, en: string) => string): Promise<void> {
  const { currentProject, projectSessionEpoch } = useProjectStore.getState()
  const session = captureProjectSession(currentProject)
  const request = ++refreshSequence
  if (!session) {
    useStageStore.setState({ work: null })
    return
  }
  const current = () => request === refreshSequence && isProjectSessionCurrent(session)
    && useProjectStore.getState().projectSessionEpoch === projectSessionEpoch
  try {
    const [architecture, blueprints] = await Promise.all([
      checkArchStatus(session),
      ipc.invokeWithProjectSession(session, 'db:blueprint-get-all', session.projectPath),
      useDraftStore.getState().loadAllDrafts(session.projectPath, session),
    ])
    if (!current()) return
    useStageStore.setState({ work: {
      session,
      architecture,
      blueprints: blueprints.map(({ chapterNumber, title }) => ({ chapterNumber, title })),
    } })
  } catch (error) {
    if (current()) toast.error(text(`项目资源刷新失败：${String(error)}`, `Could not refresh project resources: ${String(error)}`))
  }
}

/** 与项目树同一个键：任一运行的状态或步骤状态变化都要重新读。 */
function workflowRefreshKey(runs: readonly WorkflowRun[]): string {
  return runs.map(run => `${run.id}:${run.status}|${run.steps.map(step => step.status).join(',')}`).join(';')
}

/**
 * 刷新时机与过滤和项目树相同：换项目或会话代数变化时立即刷新；工作流步骤推进、架构更新、蓝图资源变化时合并成一次。
 * 项目身份与工作流共用一个 effect，打开作品时只刷新一次。
 */
export function useStageWorkRefresh(): void {
  const projectPath = useProjectStore(s => s.currentProject?.path)
  const epoch = useProjectStore(s => s.projectSessionEpoch)
  const workflowKey = useWorkflowStore(s => workflowRefreshKey(s.activeRuns))
  const identity = projectPath === undefined ? null : `${projectPath}\n${epoch}`
  const refreshedIdentity = useRef<string | null | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedule = useRef(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void refreshStageWork(useLocaleStore.getState().text)
    }, 80)
  })

  useEffect(() => {
    if (refreshedIdentity.current !== identity) {
      refreshedIdentity.current = identity
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      void refreshStageWork(useLocaleStore.getState().text)
      return
    }
    if (identity !== null) schedule.current()
  }, [identity, workflowKey])

  useEffect(() => {
    const offArch = globalEventBus.on('ARCH_FILE_UPDATED', ({ projectSession }) => {
      if (isProjectSessionCurrent(projectSession)) schedule.current()
    })
    const offResource = globalEventBus.on('REFRESH_RESOURCE', ({ projectSession, resources }) => {
      if (isProjectSessionCurrent(projectSession) && shouldRefreshBlueprints(resources)) schedule.current()
    })
    return () => {
      offArch()
      offResource()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])
}

export interface StageView {
  stages: StageStatus[]
  chapters: ChapterRow[]
  location: StageLocation | null
  /** 架构、蓝图与草稿都已按当前项目会话载入，且草稿不在重新载入中；落点只在此时计算。 */
  settled: boolean
}

/** 这部作品正在生成的章号，排好序拼成字符串：运行进度每跳一次，只要涉及的章没变，键就不变。 */
function runningKey(runs: readonly WorkflowRun[], projectPath: string | undefined): string {
  if (!projectPath) return ''
  return [...runningChapters(runs.filter(run => sameProjectPathKey(run.projectPath, projectPath)))].sort((a, b) => a - b).join(',')
}

/** 当前标签所在的位置。只订阅类型、章号与所属项目这几个原始值，正文每敲一个字外壳不跟着重渲染。 */
function useActiveLocation(projectPath: string | undefined): StageLocation | null {
  const type = useEditorStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.type)
  const chapterNumber = useEditorStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.chapterNumber)
  const projectKey = useEditorStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.projectKey)
  return useMemo(() => projectPath && type && projectKey === projectPath ? locate({ type, chapterNumber }) : null,
    [projectPath, type, chapterNumber, projectKey])
}

export function useStageView(): StageView {
  const project = useProjectStore(s => s.currentProject)
  const work = useStageStore(s => s.work)
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)
  const draftSession = useDraftStore(s => s.dataProjectSession)
  const draftsLoading = useDraftStore(s => s.loading)
  const running = useWorkflowStore(s => runningKey(s.activeRuns, project?.path))
  const location = useActiveLocation(project?.path)
  const session = captureProjectSession(project)

  const currentWork = session && work && sameProjectSessionContext(work.session, session) ? work : null
  const drafts = session && sameProjectSessionContext(draftSession, session) ? draftsByChapter : null
  const runningChapterSet = useMemo(() => new Set(running ? running.split(',').map(Number) : []), [running])

  const chapters = useMemo(() => currentWork && drafts
    ? deriveChapters({ blueprints: currentWork.blueprints, drafts, runningChapters: runningChapterSet })
    : [], [currentWork, drafts, runningChapterSet])
  const stages = useMemo(() => project && currentWork && drafts
    ? deriveStages({ config: project.novelConfig, architecture: currentWork.architecture, blueprints: currentWork.blueprints, drafts, runningChapters: runningChapterSet }, chapters)
    : [], [project, currentWork, drafts, runningChapterSet, chapters])
  return { stages, chapters, location, settled: Boolean(currentWork && drafts && !draftsLoading) }
}

/**
 * 打开作品时把内容区放到下一步：设定没填完就停在设定，否则等流程脊数据到了再落到第一个未完成的阶段。
 * 每次打开（项目会话）只落一次；这次打开已有标签时保持原样（例如从旧外壳切过来）。
 */
export function useLandingPage(view: StageView): void {
  const project = useProjectStore(s => s.currentProject)
  const landed = useRef<string | null>(null)
  useEffect(() => {
    const session = captureProjectSession(project)
    if (!project || !session) return
    const key = `${session.projectId}\n${session.leaseId}`
    if (landed.current === key) return
    if (useEditorStore.getState().tabs.some(tab => tab.projectKey === session.projectPath)) {
      landed.current = key
      return
    }
    if (missingSetup(project.novelConfig).length > 0) {
      landed.current = key
      navigate({ kind: 'stage', stage: 'setup' })
      return
    }
    if (!view.settled) return
    landed.current = key
    navigate({ kind: 'stage', stage: landingStage(view.stages) })
  }, [project, view.settled, view.stages])
}
