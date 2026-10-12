import { useEffect } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore, type EditorTab } from '../../stores/editor-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'
import { navigate } from '../../stores/navigation/navigation-intents'
import { useStageStore } from '../../stores/navigation/stage-store'
import type { ProjectData } from '../../shared/ipc-channels'
import { ErrorBoundary } from '../ErrorBoundary'
import EditorTabContent from '../panels/EditorTabContent'
import CharactersView from '../panels/sidebar/CharactersView'
import { WriterWelcomePage } from '../pages/v2/use-project-overview'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { DangerConfirm } from '../ui/DangerConfirm'
import StageRunSheet from './StageRunSheet'
import StageTabs from './StageTabs'
import { commandLabel } from './shortcut-keys'
import { stageTabName } from './stage-text'
import { cancelCloseTab, confirmCloseTab, requestCloseTab, STAGE_CONTENT_ID } from './tab-close'

/** 角色在 RD-6 并入架构阶段之前，标签里并排放旧的角色列表与角色档案。 */
function TabContent({ tab, project }: { tab: EditorTab; project: ProjectData }) {
  if (tab.type === 'character') {
    return (
      <div className="stage-characters">
        <div className="stage-characters-list"><CharactersView /></div>
        <div className="stage-characters-editor"><EditorTabContent activeTab={tab} currentProject={project} /></div>
      </div>
    )
  }
  return <EditorTabContent activeTab={tab} currentProject={project} />
}

export default function StageWorkspace({ library, focus }: { library: boolean; focus: boolean }) {
  const text = useLocaleStore(s => s.text)
  const project = useProjectStore(s => s.currentProject)
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const sheet = useStageStore(s => s.sheet)
  const tabDomId = (tabId: string) => `${STAGE_CONTENT_ID}-tab-${tabId.replace(/[^\w-]/g, '_')}`
  const closingTabId = useStageStore(s => s.closingTabId)
  const pending = tabs.find(tab => tab.id === closingTabId) ?? null
  const pendingName = pending ? stageTabName(pending, text) : ''

  const activeTab = tabs.find(tab => tab.id === activeTabId)
  useEffect(() => {
    if (tabs.length > 0 && !activeTab) useEditorStore.getState().setActiveTab(tabs[0].id)
  }, [tabs, activeTab])

  if (library || !project) {
    return (
      <main className="stage-panel" data-page="library">
        <div className="stage-library">
          <WriterWelcomePage onNewProject={() => useLayoutStore.getState().openNewProject()} />
        </div>
      </main>
    )
  }

  const showTabs = !focus && tabs.length > 1
  return (
    <main className="stage-panel">
      {showTabs && (
        <StageTabs
          tabs={tabs}
          activeTabId={activeTab?.id ?? null}
          onSelect={tabId => useEditorStore.getState().setActiveTab(tabId)}
          onClose={requestCloseTab}
          tabDomId={tabDomId}
          panelId={STAGE_CONTENT_ID}
        />
      )}
      <div className="stage-body">
        <div
          className="stage-content"
          id={STAGE_CONTENT_ID}
          tabIndex={-1}
          role={showTabs ? 'tabpanel' : undefined}
          aria-labelledby={showTabs && activeTab ? tabDomId(activeTab.id) : undefined}
        >
          {activeTab
            ? (
              <ErrorBoundary key={activeTab.id} fallbackLabel={text('编辑区渲染失败', 'Editor failed to render')}>
                <TabContent tab={activeTab} project={project} />
              </ErrorBoundary>
            )
            : (
              <EmptyState
                heading={text('从流程脊选一步开始', 'Pick a step in the flow to begin')}
                description={text('左侧按设定、架构、蓝图、正文排列，点任意一步打开它。', 'Setup, architecture, blueprint and manuscript are listed on the left. Open any of them.')}
                action={<Button variant="primary" onClick={() => navigate({ kind: 'stage', stage: 'setup' })}>{text('打开设定', 'Open setup')}</Button>}
              />
            )}
        </div>
        {sheet && !focus && (
          <div className="stage-sheet-slot" data-wide={sheet.facet === 'log' || sheet.facet === 'models' || undefined}>
            <ErrorBoundary fallbackLabel={text('AI 面板渲染失败', 'AI panel failed to render')}>
              <StageRunSheet facet={sheet.facet} />
            </ErrorBoundary>
          </div>
        )}
      </div>
      <DangerConfirm
        open={pending !== null}
        onOpenChange={open => { if (!open) cancelCloseTab() }}
        title={text('放弃未保存的修改？', 'Discard unsaved changes?')}
        consequence={text(`「${pendingName}」有未保存的修改，关闭后这些修改会丢失。`, `“${pendingName}” has unsaved changes. Closing it discards them.`)}
        recoverability={text(`丢弃后无法恢复。想保留就选「继续编辑」，再按 ${commandLabel('s')} 保存。`, `This cannot be undone. Choose “Keep editing” and press ${commandLabel('s')} to keep them.`)}
        confirmLabel={text('放弃并关闭', 'Discard and close')}
        cancelLabel={text('继续编辑', 'Keep editing')}
        onConfirm={confirmCloseTab}
      />
    </main>
  )
}
