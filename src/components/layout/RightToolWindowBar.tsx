import { Bot, Sparkles } from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLocaleStore } from '../../stores/locale-store'
import { navigate } from '../../stores/navigation/navigation-intents'

/**
 * 右侧工具窗口栏（RightToolWindowBar）
 * JetBrains 风格：30px 宽，纯图标，激活时右侧 2px 竖线
 * 支持 Agent 面板和 AI 输出面板之间切换
 */
export default function RightToolWindowBar() {
  const text = useLocaleStore(s => s.text)
  const aiPanelOpen = useLayoutStore(s => s.aiPanelOpen)
  const rightView = useLayoutStore(s => s.rightView)
  const atHome = useLayoutStore(s => s.sidebarView === 'home')
  const toggleAIPanel = useLayoutStore(s => s.toggleAIPanel)
  const openAgentPanel = useLayoutStore(s => s.openAgentPanel)
  const currentRun = useWorkflowStore((s) => s.currentRun)

  /** 工作流活跃时给 AI 输出按钮显示脉冲 */
  const showPulse = currentRun && (currentRun.status === 'running' || currentRun.status === 'waiting')

  /** 面板已在项目视图里显示此视图时关闭，否则打开并切到此视图（首页隐藏面板，总是打开）。 */
  const handleClick = (view: 'agent' | 'ai-output') => {
    if (aiPanelOpen && rightView === view && !atHome) toggleAIPanel()
    else if (view === 'ai-output') navigate({ kind: 'run', facet: 'output' })
    else openAgentPanel()
  }

  return (
    <div
      className="no-select flex flex-col items-center justify-start h-full py-0.5 gap-0.5"
      style={{
        width: 'var(--width-right-bar)',  /* 30px */
        backgroundColor: 'var(--color-activity-bar)',
        borderLeft: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      {/* AI Agent 面板按钮 */}
      <button
        onClick={() => handleClick('agent')}
        title={text('AI Agent 面板', 'AI agent panel')}
        className="tool-btn"
        style={{
          height: 30,
          boxShadow: aiPanelOpen && rightView === 'agent'
            ? 'inset -2px 0 0 var(--color-activity-indicator)'
            : 'none',
          color: aiPanelOpen && rightView === 'agent'
            ? 'var(--color-activity-icon-active)'
            : 'var(--color-activity-icon)',
        }}
      >
        <Bot size={15} strokeWidth={aiPanelOpen && rightView === 'agent' ? 2 : 1.5} />
      </button>

      {/* AI 输出面板按钮 */}
      <button
        onClick={() => handleClick('ai-output')}
        title={text('AI 输出', 'AI output')}
        className="tool-btn relative"
        style={{
          height: 30,
          boxShadow: aiPanelOpen && rightView === 'ai-output'
            ? 'inset -2px 0 0 var(--color-activity-indicator)'
            : 'none',
          color: aiPanelOpen && rightView === 'ai-output'
            ? 'var(--color-activity-icon-active)'
            : 'var(--color-activity-icon)',
        }}
      >
        <Sparkles size={15} strokeWidth={aiPanelOpen && rightView === 'ai-output' ? 2 : 1.5} />
        {/* 工作流活跃时的脉冲指示点 */}
        {showPulse && !(aiPanelOpen && rightView === 'ai-output') && (
          <span
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--color-accent)' }}
          />
        )}
      </button>
    </div>
  )
}
