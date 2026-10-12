import { useId, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button } from './Button'
import { usePaperInkRoot } from './use-paper-ink-root'

interface DangerConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** 后果，例如「将删除全部章节、蓝图与设定」。 */
  consequence: string
  /** 能否恢复，例如「删除后无法恢复，项目备份不受影响」。 */
  recoverability: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  /** 删除整部作品时要求输入作品名，输入一致才可确认。 */
  typeToConfirm?: { expected: string; label: string }
}

/**
 * 不可逆、影响作品数据的操作用的危险确认对话框。
 * Portal 到最近的 .paper-ink 根而不是 body，才能取到纸墨令牌与深色主题；
 * 原地的空 span 只用来找到这个根。
 */
export function DangerConfirm({
  open,
  onOpenChange,
  title,
  consequence,
  recoverability,
  confirmLabel,
  cancelLabel,
  onConfirm,
  typeToConfirm,
}: DangerConfirmProps) {
  const [typed, setTyped] = useState('')
  const inputId = useId()
  const confirmable = !typeToConfirm || typed === typeToConfirm.expected
  const sentinelRef = useRef<HTMLSpanElement>(null)
  const root = usePaperInkRoot(sentinelRef)

  const changeOpen = (next: boolean) => {
    if (!next) setTyped('')
    onOpenChange(next)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={changeOpen}>
      <span ref={sentinelRef} hidden />
      {root !== undefined && (
        <DialogPrimitive.Portal container={root}>
          <DialogPrimitive.Overlay className="pi-scrim" />
          <DialogPrimitive.Content className="pi-dialog">
            <div className="pi-dialog-head">
              <DialogPrimitive.Title className="pi-dialog-title">{title}</DialogPrimitive.Title>
            </div>
            <div className="pi-dialog-body">
              <DialogPrimitive.Description asChild>
                <div className="pi-dialog-text">
                  <p>{consequence}</p>
                  <p>{recoverability}</p>
                </div>
              </DialogPrimitive.Description>
              {typeToConfirm && (
                <label className="pi-field" htmlFor={inputId}>
                  {typeToConfirm.label}
                  <input
                    id={inputId}
                    className="pi-input"
                    value={typed}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="pi-dialog-foot">
              <DialogPrimitive.Close asChild>
                <Button variant="secondary">{cancelLabel}</Button>
              </DialogPrimitive.Close>
              <Button
                variant="danger-solid"
                disabled={!confirmable}
                onClick={() => {
                  onConfirm()
                  changeOpen(false)
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  )
}
