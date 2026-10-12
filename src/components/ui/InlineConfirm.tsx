import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { Button } from './Button'

interface InlineConfirmProps {
  /** 写明后果与能否恢复，例如「清空后无法恢复这 12 条日志」。 */
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** 侧页内影响较小的危险操作用的就地确认条。出现时焦点落在取消上，Esc 取消。 */
export function InlineConfirm({ message, confirmLabel, cancelLabel, onConfirm, onCancel }: InlineConfirmProps) {
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="pi-inline-confirm" role="group" aria-labelledby={messageId} onKeyDown={onKeyDown}>
      <p id={messageId} className="pi-inline-confirm-text">{message}</p>
      <Button ref={cancelRef} variant="text" size="sm" onClick={onCancel}>{cancelLabel}</Button>
      <Button variant="danger" size="sm" onClick={onConfirm}>{confirmLabel}</Button>
    </div>
  )
}
