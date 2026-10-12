import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import type { WindowCloseGuard } from '../layout/use-window-close-guard'

/** 关窗时还有未保存内容或运行中的任务。判定与处理在 useWindowCloseGuard，这里只是新外壳的呈现。 */
export default function ExitGuardDialog({ guard, container }: { guard: WindowCloseGuard; container: HTMLElement | null }) {
  const text = useLocaleStore(s => s.text)
  const { exitRequest, exitBusy, exitError, cancelExit, discardAndExit, saveAndExit } = guard
  const blocked = Boolean(exitRequest?.workflowBlocked)
  return (
    <DialogPrimitive.Root open={exitRequest !== null} onOpenChange={open => { if (!open) void cancelExit() }}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="pi-scrim" />
        <DialogPrimitive.Content className="pi-dialog stage-dialog">
          <div className="pi-dialog-head">
            <DialogPrimitive.Title className="pi-dialog-title stage-dialog-title">
              {blocked ? text('创作任务仍在运行', 'A writing task is still running') : text('退出前处理未保存的内容', 'Handle unsaved changes before exiting')}
            </DialogPrimitive.Title>
          </div>
          <div className="pi-dialog-body">
            <DialogPrimitive.Description className="pi-dialog-text">
              {blocked
                ? text('请等当前任务完成，或在运行侧页里取消任务后再退出。', 'Wait for the current task to finish, or cancel it in the run sheet before exiting.')
                : text('保存会用各编辑器当前的项目会话写入；有内容无法安全保存，或保存期间又有输入时，应用不会退出。', 'Each editor saves through its current project session. The app stays open if something cannot be saved safely or new input arrives while saving.')}
            </DialogPrimitive.Description>
            {exitError && <p className="stage-dialog-error" role="alert">{exitError}</p>}
          </div>
          <div className="pi-dialog-foot">
            <Button variant="secondary" disabled={exitBusy} onClick={() => void cancelExit()}>
              {blocked ? text('知道了', 'OK') : text('取消', 'Cancel')}
            </Button>
            {!blocked && (
              <>
                <Button variant="danger" disabled={exitBusy} onClick={() => void discardAndExit()}>{text('放弃并退出', 'Discard and exit')}</Button>
                <Button variant="primary" disabled={exitBusy} onClick={() => void saveAndExit()}>
                  {exitBusy ? text('正在处理…', 'Working…') : text('保存并退出', 'Save and exit')}
                </Button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
