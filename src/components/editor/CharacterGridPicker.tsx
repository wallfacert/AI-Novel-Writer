import { useRef, useState } from 'react'
import { ChevronDown, Loader2, Users } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

interface CharacterGridPickerProps {
  /** 当前已选角色名列表（蓝图 characters 字段） */
  value: readonly string[]
  onChange: (names: string[]) => void
  projectSession: ProjectSessionContext | null
}

/**
 * 蓝图「出场关键人物」选择器。
 * 只读框展示已选角色，点击后在框正下方弹出角色网格（来自角色卡，可多选），确认后写回。
 * 历史手填、不在角色卡中的名字会作为额外选项保留，允许继续勾选或取消。
 */
export default function CharacterGridPicker({ value, onChange, projectSession }: CharacterGridPickerProps) {
  const text = useLocaleStore(s => s.text)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [gridNames, setGridNames] = useState<readonly string[]>([])
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const requestSeqRef = useRef(0)

  const openPicker = () => {
    setOpen(true)
    setLoadError('')
    setGridNames([])
    setPending(new Set(value))
    const seq = ++requestSeqRef.current
    if (!projectSession) return
    setLoading(true)
    void (async () => {
      try {
        const cards = await ipc.invokeWithProjectSession(projectSession, 'db:character-get-all', projectSession.projectPath)
        if (requestSeqRef.current !== seq) return
        const cardNames = [...new Set((Array.isArray(cards) ? cards : []).map(card => card.name).filter(Boolean))]
        const customNames = value.filter(name => !cardNames.includes(name))
        setGridNames([...cardNames, ...customNames])
      } catch (err) {
        if (requestSeqRef.current !== seq) return
        setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (requestSeqRef.current === seq) setLoading(false)
      }
    })()
  }

  const toggleName = (name: string) => {
    setPending(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const confirmSelection = () => {
    onChange(gridNames.filter(name => pending.has(name)))
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex h-7 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1 text-left text-xs',
          'transition-all duration-200 ease-out hover:border-[var(--color-text-muted)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)]',
          open && 'border-[var(--color-accent)]',
        )}
      >
        <span className={cn('truncate', value.length === 0 && 'text-[var(--color-text-muted)]')}>
          {value.length > 0 ? value.join('、') : text('点击选择角色', 'Click to choose characters')}
        </span>
        <ChevronDown size={12} className="shrink-0 text-[var(--color-text-muted)]" />
      </button>

      {open && (
        <>
          {/* 点击选择器外部关闭，不应用改动 */}
          <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={text('选择出场角色', 'Choose key characters')}
            className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-[var(--color-border)] p-2 shadow-lg"
            style={{ backgroundColor: 'var(--color-panel)' }}
          >
            <div
              className="mb-1.5 flex items-center justify-between text-[0.7rem]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <span className="flex items-center gap-1">
                <Users size={11} />
                {text('选择出场角色（可多选）', 'Choose key characters (multi-select)')}
              </span>
              <span>{text(`已选 ${pending.size} 人`, `${pending.size} selected`)}</span>
            </div>

            {loading ? (
              <div
                className="flex items-center justify-center gap-1.5 py-4 text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Loader2 size={12} className="animate-spin" />
                {text('加载角色卡...', 'Loading character cards...')}
              </div>
            ) : gridNames.length === 0 ? (
              <div className="py-4 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {loadError || text('暂无角色卡', 'No character cards yet')}
              </div>
            ) : (
              <div
                role="group"
                aria-label={text('角色网格', 'Character grid')}
                className="grid max-h-44 grid-cols-3 gap-1 overflow-y-auto"
              >
                {gridNames.map((name) => {
                  const active = pending.has(name)
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleName(name)}
                      title={name}
                      className={cn(
                        'cursor-pointer truncate rounded-md border px-2 py-1.5 text-xs transition-colors',
                        active
                          ? 'border-[var(--color-accent)] font-medium'
                          : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-hover)]',
                      )}
                      style={active
                        ? { backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--color-accent)' }
                        : undefined}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                {text('点击外部取消，保持原选择', 'Click outside to dismiss and keep the current selection')}
              </span>
              <Button variant="default" size="sm" onClick={confirmSelection} disabled={loading}>
                {text('确认', 'Confirm')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
