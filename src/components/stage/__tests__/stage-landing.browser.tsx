/* eslint-disable react-refresh/only-export-components */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { NovelConfig, ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useAppearanceStore } from '../../../stores/appearance-bootstrap'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useStageStore } from '../../../stores/navigation/stage-store'
import { useProjectStore } from '../../../stores/project-store'
import { useLandingPage, useStageView } from '../use-stage-work'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'C:\\novels\\landing'
const READY: Partial<NovelConfig> = { coreOutline: '雾钟每晚提前一刻响起。', genre: '悬疑', targetAudience: '成年读者', totalChapters: 12, wordsPerChapter: 3000 }
function snapshot<T>(store: StoreApi<T>): () => void {
  const state = store.getState()
  return () => store.setState(state, true)
}
const restores = [snapshot(useAppearanceStore), snapshot(useDraftStore), snapshot(useEditorStore), snapshot(useLayoutStore), snapshot(useStageStore), snapshot(useProjectStore)]

let root: Root | undefined
let host: HTMLDivElement | undefined

function Landing() {
  useLandingPage(useStageView())
  return null
}

function session(leaseId: string): ProjectSessionContext {
  return { projectId: 'landing', leaseId, projectPath: PATH }
}

/** 像 openProject 一样换上这次打开：主进程签发的会话、新的项目对象（标签已被清掉）。 */
async function open(context: ProjectSessionContext, novelConfig: Partial<NovelConfig>) {
  await act(async () => {
    setActiveProjectSessionContext(context)
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useProjectStore.setState({ currentProject: { id: context.projectId, sessionLease: context.leaseId, name: '灯塔', path: PATH, novelConfig } as unknown as ProjectData })
  })
}

const tabTypes = () => useEditorStore.getState().tabs.map(tab => tab.type)

beforeEach(async () => {
  useAppearanceStore.setState({ resolvedShell: 'stage' })
  useStageStore.setState({ work: null, focus: false, palette: null, sheet: null, closingTabId: null })
  useDraftStore.setState({ draftsByChapter: {}, dataProjectSession: null, loading: false })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  setActiveProjectSessionContext(null)
  for (const restore of restores) restore()
})

describe('打开作品时的落点', () => {
  it('同一部作品重新打开（新的项目会话）时再落一次', async () => {
    await open(session('first'), { ...READY, coreOutline: '' })
    await act(async () => root!.render(<Landing />))
    expect(tabTypes()).toEqual(['config'])

    await open(session('reopened'), { ...READY, coreOutline: '' })
    expect(tabTypes()).toEqual(['config'])
  })

  it('草稿还没按这次会话载入完时不落；载入完才落到第一个未完成的阶段', async () => {
    const current = session('current')
    await open(current, READY)
    await act(async () => {
      useStageStore.setState({ work: { session: current, architecture: { premise: true }, blueprints: [{ chapterNumber: 1, title: '旧港' }] } })
      useDraftStore.setState({ dataProjectSession: session('stale'), loading: false })
    })
    await act(async () => root!.render(<Landing />))
    expect(tabTypes()).toEqual([])

    await act(async () => useDraftStore.setState({ dataProjectSession: current, loading: true }))
    expect(tabTypes()).toEqual([])

    await act(async () => useDraftStore.setState({ loading: false }))
    expect(tabTypes()).toEqual(['world-building'])
  })

  it('上一次打开留下的架构与蓝图数据不算这次的', async () => {
    const current = session('current')
    await open(current, READY)
    await act(async () => {
      useStageStore.setState({ work: { session: session('previous'), architecture: { premise: true }, blueprints: [] } })
      useDraftStore.setState({ dataProjectSession: current, loading: false })
    })
    await act(async () => root!.render(<Landing />))
    expect(tabTypes()).toEqual([])
  })
})
