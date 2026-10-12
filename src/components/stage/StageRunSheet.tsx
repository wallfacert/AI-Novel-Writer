import { useEffect } from 'react'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'
import { navigate, type RunPaneFacet } from '../../stores/navigation/navigation-intents'
import { useStageStore } from '../../stores/navigation/stage-store'
import AIOutputPanel from '../panels/AIOutputPanel'
import BottomPanel from '../panels/BottomPanel'
import { Sheet } from '../ui/Sheet'

const FACETS: { id: RunPaneFacet; label: [string, string] }[] = [
  { id: 'output', label: ['输出', 'Output'] },
  { id: 'tasks', label: ['任务', 'Tasks'] },
  { id: 'log', label: ['日志', 'Log'] },
  { id: 'models', label: ['模型调用', 'Model calls'] },
]

/**
 * 运行侧页的过渡版本：在 RD-4 重做之前沿用旧的 AI 输出与任务面板，内容与操作一项不少。
 * 旧面板自带的关闭按钮改的是旧布局字段，这里把它们的关闭当作收起侧页。
 */
export default function StageRunSheet({ facet }: { facet: RunPaneFacet }) {
  const text = useLocaleStore(s => s.text)
  const rightView = useLayoutStore(s => s.rightView)
  const bottomOpen = useLayoutStore(s => s.bottomPanelOpen)
  const close = () => useStageStore.setState({ sheet: null })

  useEffect(() => {
    if (facet === 'output' ? rightView !== 'ai-output' : !bottomOpen) useStageStore.setState({ sheet: null })
  }, [facet, rightView, bottomOpen])

  return (
    <Sheet
      open
      title={text('运行', 'Run')}
      closeLabel={text('收起运行侧页', 'Close run sheet')}
      onClose={close}
      wide={facet === 'log' || facet === 'models'}
      tabs={{
        items: FACETS.map(item => ({ id: item.id, label: text(...item.label) })),
        active: facet,
        onChange: id => navigate({ kind: 'run', facet: id as RunPaneFacet }),
      }}
    >
      <div className="stage-run-slot">
        {facet === 'output' ? <AIOutputPanel /> : <BottomPanel />}
      </div>
    </Sheet>
  )
}
