import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePaperInkRoot } from './use-paper-ink-root'

const GAP = 6
const TABBABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]'

/**
 * Menu 与 Popover 共用：浮层 Portal 到最近的 .paper-ink 根，按触发按钮位置 fixed 定位，
 * 不被侧页等滚动容器裁切。点击外部、滚动外部容器、改变窗口大小时关闭；
 * Esc 关闭并把焦点还给触发按钮；Tab 离开浮层时先回到触发按钮，再由浏览器继续移动焦点。
 */
export function useAnchoredLayer(align: 'start' | 'end'): {
  open: boolean
  layerId: string
  anchorRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
  layerRef: RefObject<HTMLDivElement | null>
  renderLayer: (layer: ReactNode) => ReactNode
  show: () => void
  toggle: () => void
  close: (returnFocus: boolean) => void
} {
  const [open, setOpen] = useState(false)
  const layerId = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const root = usePaperInkRoot(anchorRef)

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const layer = layerRef.current
    const trigger = triggerRef.current
    if (!open || !layer || !trigger) return
    const rect = trigger.getBoundingClientRect()
    layer.style.top = `${rect.bottom + GAP}px`
    if (align === 'end') layer.style.right = `${document.documentElement.clientWidth - rect.right}px`
    else layer.style.left = `${rect.left}px`
  }, [open, align])

  useEffect(() => {
    const layer = layerRef.current
    const anchor = anchorRef.current
    if (!open || !layer || !anchor) return
    const inside = (target: EventTarget | null) => target instanceof Node && (anchor.contains(target) || layer.contains(target))
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) close(false)
    }
    const onScroll = (event: Event) => {
      if (!layer.contains(event.target as Node)) close(false)
    }
    const onResize = () => close(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(true)
      }
    }
    const onLayerKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const tabbables = [...layer.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => element.tabIndex >= 0)
      const active = document.activeElement
      if (event.shiftKey && (tabbables.length === 0 || active === layer || active === tabbables[0])) {
        event.preventDefault()
        close(true)
      } else if (!event.shiftKey && (tabbables.length === 0 || active === tabbables[tabbables.length - 1])) {
        close(true)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    anchor.addEventListener('keydown', onKeyDown)
    layer.addEventListener('keydown', onKeyDown)
    layer.addEventListener('keydown', onLayerKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      anchor.removeEventListener('keydown', onKeyDown)
      layer.removeEventListener('keydown', onKeyDown)
      layer.removeEventListener('keydown', onLayerKeyDown)
    }
  }, [open, close])

  return {
    open,
    layerId,
    anchorRef,
    triggerRef,
    layerRef,
    renderLayer: (layer) => (root ? createPortal(layer, root) : layer),
    show: useCallback(() => setOpen(true), []),
    toggle: useCallback(() => setOpen((value) => !value), []),
    close,
  }
}
