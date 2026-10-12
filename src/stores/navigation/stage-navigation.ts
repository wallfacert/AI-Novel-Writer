import { toast } from '../../components/ui/Toast'
import type { DraftMeta } from '../../services/draft-index'
import { chapterTabName } from '../../shared/chapter-label'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../shared/project-session-context'
import { fetchChapterDrafts, useDraftStore } from '../draft-store'
import { useEditorStore } from '../editor-store'
import { useLayoutStore } from '../layout-store'
import { useLocaleStore } from '../locale-store'
import { openBuiltinEditor } from '../open-builtin-editor'
import { openDraftTab } from '../open-draft-tab'
import { useProjectStore } from '../project-store'
import { chapterWritePrefill } from './legacy-layout'
import type { NavigationIntent } from './navigation-intents'
import { openPageTab } from './page-tabs'
import { deriveChapters, focusChapter } from './stage-progress'
import { useStageStore } from './stage-store'

/** 回到作品：离开书房、退出沉浸、收起搜索。 */
function enterWork(): void {
  useStageStore.setState({ focus: false, palette: null })
  if (useLayoutStore.getState().sidebarView === 'home') useLayoutStore.setState({ sidebarView: 'project', activeRailItem: 'project' })
}

function currentSession(): ProjectSessionContext | null {
  return projectSessionContextFromProject(useProjectStore.getState().currentProject)
}

/** 草稿 store 已按这次会话完整载入时直接用它；否则单独读这一章，不依赖可能被新一轮 loadAllDrafts 作废的载入。 */
async function chapterDrafts(chapterNumber: number, session: ProjectSessionContext): Promise<readonly DraftMeta[]> {
  const loaded = useDraftStore.getState()
  if (sameProjectSessionContext(loaded.dataProjectSession, session) && !loaded.loading) return loaded.draftsByChapter[chapterNumber] ?? []
  return fetchChapterDrafts(chapterNumber, session)
}

let openChapterRequest = 0

/**
 * 打开一章：已有这一稿的标签就直接切过去；否则读出正文开新标签。待写的章还没有正文，落到蓝图并选中这一章，那里有「写作此章」。
 * 连续点几章时只有最后一次生效；读取失败时提示作者，而不是点了没反应。
 */
export async function openChapter(chapterNumber: number): Promise<void> {
  const request = ++openChapterRequest
  const session = currentSession()
  if (!session) return
  const text = useLocaleStore.getState().text
  const stillWanted = () => request === openChapterRequest && sameProjectSessionContext(session, currentSession())
  try {
    const drafts = await chapterDrafts(chapterNumber, session)
    if (!stillWanted()) return
    const work = useStageStore.getState().work
    const [row] = deriveChapters({
      blueprints: (work && sameProjectSessionContext(work.session, session) ? work.blueprints : [])
        .filter(blueprint => blueprint.chapterNumber === chapterNumber),
      drafts: { [chapterNumber]: drafts },
      runningChapters: new Set(),
    })
    const draft = row?.draft
    if (!draft) {
      openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprint'), 'chapter-card', undefined, chapterNumber)
      return
    }
    const editor = useEditorStore.getState()
    const open = editor.tabs.find(tab => tab.type === 'chapter' && tab.projectKey === session.projectPath && tab.filePath === draft.filePath)
    if (open) {
      editor.setActiveTab(open.id)
      return
    }
    await openDraftTab(draft, chapterTabName(chapterNumber, row.title, text), session, stillWanted)
  } catch (error) {
    if (!stillWanted()) return
    const reason = error instanceof Error ? error.message : String(error)
    toast.error(text(`打开第 ${chapterNumber} 章失败：${reason}`, `Could not open chapter ${chapterNumber}: ${reason}`))
  }
}

function openKnowledge(): void {
  const projectKey = useProjectStore.getState().currentProject?.path
  if (!projectKey) return
  const text = useLocaleStore.getState().text
  useEditorStore.getState().openFile({ id: 'knowledge-base', name: text('知识库', 'Knowledge base'), type: 'knowledge', projectKey })
}

/** 正文阶段本身没有页面，落到当前该写的那一章；还没有任何章时先去蓝图。 */
async function openManuscript(): Promise<void> {
  const session = currentSession()
  const work = useStageStore.getState().work
  if (!session || !work || !sameProjectSessionContext(work.session, session)) {
    openPageTab('blueprint')
    return
  }
  const drafts = useDraftStore.getState()
  const target = focusChapter(deriveChapters({
    blueprints: work.blueprints,
    drafts: sameProjectSessionContext(drafts.dataProjectSession, session) ? drafts.draftsByChapter : {},
    runningChapters: new Set(),
  }))
  if (target) await openChapter(target.number)
  else openPageTab('blueprint')
}

/** 新外壳下各意图的落点。设置与写作此章仍由旧对话框承接，RD-5、RD-7 换成新页面。 */
export function stageNavigate(intent: NavigationIntent): void {
  if (intent.kind === 'settings') {
    useLayoutStore.setState({ settingsOpen: true, settingsSection: intent.section })
    return
  }
  if (intent.kind === 'chapter' && intent.write) {
    useLayoutStore.setState(chapterWritePrefill(intent.chapterNumber, intent.write))
    return
  }
  enterWork()
  switch (intent.kind) {
    case 'stage':
      if (!intent.stage) useStageStore.setState({ sheet: null })
      else if (intent.stage === 'manuscript') void openManuscript()
      else openPageTab(intent.stage)
      return
    case 'resource':
      if (intent.page === 'knowledge') openKnowledge()
      else openPageTab(intent.page)
      return
    case 'run':
      useStageStore.setState({ sheet: { kind: 'run', facet: intent.facet } })
      // 运行侧页在 RD-4 之前沿用旧的 AI 输出与任务面板，它们读这几个布局字段。
      useLayoutStore.setState(intent.facet === 'output'
        ? { rightView: 'ai-output', rightPanelRunId: intent.runId ?? null }
        : { bottomTab: intent.facet, bottomPanelOpen: true })
      return
    case 'chapter':
      void openChapter(intent.chapterNumber)
  }
}
