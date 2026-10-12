import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import { useAppearanceStore } from '../../appearance-bootstrap'
import { useEditorStore } from '../../editor-store'
import { useLayoutStore } from '../../layout-store'
import { useProjectStore } from '../../project-store'
import { navigate } from '../navigation-intents'
import { useStageStore } from '../stage-store'

const PROJECT_PATH = 'C:\\novels\\stage'
const WRITE = { title: '夜雨', role: '发展', purpose: '交代来信', keyEvents: '收到密信', characters: '林岚', userGuidance: '', chapterOutline: '' }

const originalAppearance = useAppearanceStore.getState()
const originalLayout = useLayoutStore.getState()
const originalEditor = useEditorStore.getState()
const originalProject = useProjectStore.getState()
const originalStage = useStageStore.getState()

beforeEach(() => {
  useAppearanceStore.setState({ resolvedShell: 'stage' })
  useLayoutStore.setState({ sidebarView: 'home', activeRailItem: 'home', settingsOpen: false, chapterCreationOpen: false,
    chapterCreationPrefill: null, immersive: false, bottomPanelOpen: false, rightView: 'agent' })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useProjectStore.setState({ currentProject: { id: 'stage', name: '灯塔', path: PROJECT_PATH } as ProjectData })
  useStageStore.setState({ sheet: { kind: 'run', facet: 'log' }, focus: true, palette: 'commands', work: null, closingTabId: null })
})

afterEach(() => {
  useAppearanceStore.setState(originalAppearance, true)
  useLayoutStore.setState(originalLayout, true)
  useEditorStore.setState(originalEditor, true)
  useProjectStore.setState(originalProject, true)
  useStageStore.setState(originalStage, true)
})

const tabTypes = () => useEditorStore.getState().tabs.map(tab => tab.type)

describe('新外壳下 navigate 的落点，调用方与旧外壳相同', () => {
  it('回到流程脊：离开书房、退出沉浸、收起搜索与侧页，不打开页面', () => {
    navigate({ kind: 'stage' })
    expect(useStageStore.getState()).toMatchObject({ sheet: null, focus: false, palette: null })
    expect(useLayoutStore.getState().sidebarView).toBe('project')
    expect(tabTypes()).toEqual([])
  })

  it('阶段与资料页各开一个标签，再次打开时切回同一个标签', () => {
    navigate({ kind: 'stage', stage: 'setup' })
    navigate({ kind: 'stage', stage: 'architecture' })
    navigate({ kind: 'stage', stage: 'blueprint' })
    navigate({ kind: 'resource', page: 'plot' })
    navigate({ kind: 'resource', page: 'knowledge' })
    navigate({ kind: 'resource', page: 'history' })
    navigate({ kind: 'stage', stage: 'setup' })
    expect(tabTypes()).toEqual(['config', 'world-building', 'chapter-card', 'narrative-thread', 'knowledge', 'version-history'])
    expect(useEditorStore.getState().tabs.find(tab => tab.id === useEditorStore.getState().activeTabId)?.type).toBe('config')
    expect(useStageStore.getState().focus).toBe(false)
  })

  it('运行意图打开运行侧页并定位到请求的分页', () => {
    navigate({ kind: 'run', facet: 'output', runId: 'run-7' })
    expect(useStageStore.getState().sheet).toEqual({ kind: 'run', facet: 'output' })
    expect(useLayoutStore.getState()).toMatchObject({ rightView: 'ai-output', rightPanelRunId: 'run-7' })
    navigate({ kind: 'run', facet: 'models' })
    expect(useStageStore.getState().sheet).toEqual({ kind: 'run', facet: 'models' })
    expect(useLayoutStore.getState()).toMatchObject({ bottomTab: 'models', bottomPanelOpen: true })
  })

  it('设置分组与写作此章仍打开原来的对话框，不退出沉浸', () => {
    navigate({ kind: 'settings', section: 'backup' })
    navigate({ kind: 'chapter', chapterNumber: 3, write: WRITE })
    expect(useLayoutStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'backup', chapterCreationOpen: true,
      chapterCreationPrefill: { chapterNumber: 3, ...WRITE } })
    expect(useStageStore.getState().focus).toBe(true)
  })

  it('旧外壳不受影响：同一意图仍写旧布局字段', () => {
    useAppearanceStore.setState({ resolvedShell: 'writer' })
    navigate({ kind: 'run', facet: 'tasks' })
    expect(useStageStore.getState().sheet).toEqual({ kind: 'run', facet: 'log' })
    expect(useLayoutStore.getState()).toMatchObject({ bottomPanelOpen: true, bottomTab: 'tasks', activeRailItem: 'tasks' })
  })
})
