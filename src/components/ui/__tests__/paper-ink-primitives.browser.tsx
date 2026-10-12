import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, StrictMode, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page, userEvent } from 'vitest/browser'
import { Ellipsis } from 'lucide-react'

import '../../../index.css'
import { Button } from '../Button'
import { Check } from '../Check'
import { DangerConfirm } from '../DangerConfirm'
import { EmptyState } from '../EmptyState'
import { InlineConfirm } from '../InlineConfirm'
import { Lifecycle } from '../Lifecycle'
import { Menu } from '../Menu'
import { Notice } from '../Notice'
import { Popover } from '../Popover'
import { SegmentedControl } from '../SegmentedControl'
import { Sheet } from '../Sheet'
import { StatGrid } from '../StatGrid'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SHOTS = '../../../../.runtime/rd1-shots'
const ACCENT = { light: 'rgb(44, 74, 140)', dark: 'rgb(169, 190, 240)' }
const DANGER = { light: 'rgb(180, 35, 24)', dark: 'rgb(240, 138, 126)' }

let root: Root | undefined
let host: HTMLDivElement | undefined

async function mount(node: ReactNode, theme: 'light' | 'dark' = 'light') {
  host = document.createElement('div')
  host.className = 'paper-ink'
  host.dataset.theme = theme
  host.style.cssText = 'padding: 32px; min-height: 480px; width: 900px;'
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  return host
}

const settle = () => act(async () => {})
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, element: host! })
const focused = () => document.activeElement as HTMLElement
const finishAnimations = (element: Element) => Promise.all(element.getAnimations().map((animation) => animation.finished))

const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number)

function luminance(color: string) {
  const [r, g, b] = channels(color).slice(0, 3).map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

/** 半透明前景色叠在不透明底色上的实际颜色。 */
function composite(over: string, under: string) {
  const [r, g, b, a = 1] = channels(over)
  const base = channels(under)
  return `rgb(${[r, g, b].map((value, i) => Math.round(value * a + base[i] * (1 - a))).join(', ')})`
}

function tokenColor(scope: HTMLElement, name: string) {
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  scope.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

/** 焦点环由令牌 --focus-ring 绘制：外圈为强调色。 */
function expectFocusRing(element: Element, theme: 'light' | 'dark' = 'light') {
  expect(getComputedStyle(element).boxShadow).toContain(ACCENT[theme])
}

beforeEach(async () => {
  await page.viewport(1000, 720)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe('Button 纸墨六种', () => {
  const six = (
    <div style={{ display: 'flex', gap: 12 }}>
      <Button variant="primary">写作此章</Button>
      <Button variant="secondary">重新生成</Button>
      <Button variant="text">稍后</Button>
      <Button variant="danger">删除作品…</Button>
      <Button variant="danger-solid">永久删除</Button>
      <Button variant="icon" aria-label="更多操作"><Ellipsis size={16} aria-hidden /></Button>
    </div>
  )

  it.each(['light', 'dark'] as const)('%s 主题下六种按钮依次可 Tab 到达且焦点环可见', async (theme) => {
    const container = await mount(six, theme)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.map((button) => button.className.match(/pi-btn--[\w-]+/)?.[0])).toEqual([
      'pi-btn--primary', 'pi-btn--secondary', 'pi-btn--text', 'pi-btn--danger', 'pi-btn--danger-solid', 'pi-btn--icon',
    ])
    for (const button of buttons) {
      await userEvent.tab()
      expect(focused()).toBe(button)
      expectFocusRing(button, theme)
    }
    expect(buttons.every((button) => button.type === 'button')).toBe(true)
    expect(buttons[5].getAttribute('aria-label')).toBe('更多操作')
    ;(document.activeElement as HTMLElement).blur()
    await shot(`rd1-buttons-${theme}`)
  })

  it('主按钮为黛蓝实心，危险按钮从不使用强调色且外形与主按钮不同', async () => {
    const container = await mount(six)
    const [primary, , , danger, dangerSolid] = [...container.querySelectorAll('button')].map((b) => getComputedStyle(b))
    expect(primary.backgroundColor).toBe(ACCENT.light)
    expect(danger.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(danger.color).toBe(DANGER.light)
    expect(danger.borderTopStyle).toBe('solid')
    expect(dangerSolid.backgroundColor).toBe(DANGER.light)
    expect([danger.color, danger.backgroundColor, dangerSolid.backgroundColor]).not.toContain(ACCENT.light)
  })

  it.each(['light', 'dark'] as const)('%s 主题正文对比度不低于 4.5:1，说明文字不低于 3:1', async (theme) => {
    const container = await mount(<p>正文</p>, theme)
    const tokens = getComputedStyle(container)
    const value = (name: string) => tokenColor(container, name)
    for (const surface of ['--paper', '--surface', '--frame']) {
      expect(contrast(value('--ink'), value(surface))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value('--ink-2'), value(surface))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value('--ink-3'), value(surface))).toBeGreaterThanOrEqual(3)
    }
    expect(contrast(value('--accent-ink'), value('--accent'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(value('--danger-ink'), value('--danger'))).toBeGreaterThanOrEqual(4.5)
    expect(tokens.color).toBe(value('--ink'))
  })

  it('旧外壳变体不受影响，仍走旧样式', async () => {
    const container = await mount(<Button variant="outline">旧按钮</Button>)
    const button = container.querySelector('button')!
    expect(button.className).not.toContain('pi-btn')
    expect(button.className).toContain('border-[var(--color-border)]')
  })
})

describe('Sheet', () => {
  function Harness({ onClose = () => {}, initiallyOpen = false }: { onClose?: () => void; initiallyOpen?: boolean }) {
    const [open, setOpen] = useState(initiallyOpen)
    const [tab, setTab] = useState('a')
    return (
      <div style={{ display: 'flex', gap: 16, height: 400, alignItems: 'flex-start' }}>
        <Button variant="secondary" onClick={() => setOpen(true)}>打开蓝图</Button>
        <Sheet
          open={open}
          title="第 4 章"
          subtitle="蓝图"
          closeLabel="关闭侧页"
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          tabs={{ items: [{ id: 'a', label: '蓝图' }, { id: 'b', label: '要求' }, { id: 'c', label: '设定' }], active: tab, onChange: setTab }}
        >
          正文
        </Sheet>
        <Button variant="text">侧页之后</Button>
      </div>
    )
  }

  it('打开时焦点移到标题，Esc 或关闭按钮关闭后焦点回到打开它的按钮', async () => {
    const onClose = vi.fn()
    const container = await mount(<Harness onClose={onClose} />)
    const trigger = container.querySelector('button')!

    await userEvent.click(trigger)
    const sheet = container.querySelector('aside')!
    const heading = container.querySelector('h2')!
    expect(sheet.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(focused()).toBe(heading)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(container.querySelector('aside')).toBeNull()
    expect(focused()).toBe(trigger)

    await userEvent.keyboard('{Enter}')
    expect(focused()).toBe(container.querySelector('h2'))
    await userEvent.tab()
    expect(focused().getAttribute('aria-label')).toBe('关闭侧页')
    expectFocusRing(focused())
    await userEvent.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(focused()).toBe(trigger)

    await userEvent.click(trigger)
    await userEvent.click(page.getByText('正文'))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(focused()).toBe(trigger)
  })

  it('StrictMode 下以打开状态挂载，关闭后焦点回到挂载前的元素', async () => {
    const outside = document.createElement('button')
    outside.textContent = '挂载前'
    document.body.append(outside)
    outside.focus()
    try {
      const container = await mount(<StrictMode><Harness initiallyOpen /></StrictMode>)
      expect(focused()).toBe(container.querySelector('h2'))
      await userEvent.keyboard('{Escape}')
      expect(container.querySelector('aside')).toBeNull()
      expect(focused()).toBe(outside)
    } finally {
      outside.remove()
    }
  })

  it('分页用方向键切换，只有当前分页在 Tab 顺序里，面板以当前分页命名', async () => {
    const container = await mount(<Harness initiallyOpen />)
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const panel = container.querySelector('[role="tabpanel"]')!
    const expectActive = (index: number) => {
      expect(focused()).toBe(tabs[index])
      expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(tabs.map((_, i) => String(i === index)))
      expect(tabs.map((tab) => tab.tabIndex)).toEqual(tabs.map((_, i) => (i === index ? 0 : -1)))
      expect(panel.getAttribute('aria-labelledby')).toBe(tabs[index].id)
      expect(tabs[index].getAttribute('aria-controls')).toBe(panel.id)
    }

    await userEvent.tab()
    await userEvent.tab()
    expect(focused()).toBe(tabs[0])
    expectFocusRing(tabs[0])
    // Tab 若走出测试文档，Shift+Tab 回到哪里取决于外层页面与浏览器，所以在侧页之后放一个可聚焦元素。
    await userEvent.tab()
    expect(focused()).toBe(page.getByRole('button', { name: '侧页之后' }).element())
    await userEvent.tab({ shift: true })
    expectActive(0)

    await userEvent.keyboard('{ArrowRight}')
    expectActive(1)
    await userEvent.keyboard('{End}')
    expectActive(2)
    await userEvent.keyboard('{ArrowRight}')
    expectActive(0)
    await userEvent.keyboard('{ArrowLeft}')
    expectActive(2)
    await userEvent.keyboard('{Home}')
    expectActive(0)
    await userEvent.keyboard('{ArrowRight}')
    await shot('rd1-sheet')
  })

  it('滑入动画只在状态变化时出现，并在减少动态效果设置下关闭', async () => {
    const container = await mount(<Harness initiallyOpen />)
    expect(getComputedStyle(container.querySelector('aside')!).animationName).toBe('pi-sheet-in')
    const reducedRules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules]
      } catch {
        return []
      }
    }).filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion: reduce'))
    const paperInkRule = reducedRules.flatMap((rule) => [...rule.cssRules] as CSSStyleRule[])
      .find((rule) => rule.selectorText?.includes('.paper-ink *'))
    expect(paperInkRule?.style.getPropertyValue('animation-name')).toBe('none')
    expect(paperInkRule?.style.getPropertyPriority('animation-name')).toBe('important')
  })
})

describe('Menu', () => {
  it('键盘打开并移动焦点，危险分组在分隔线之后且为危险色，Esc 关闭并把焦点还给触发按钮', async () => {
    const onDelete = vi.fn()
    const container = await mount(
      <div style={{ height: 300 }}>
        <Menu
          label="作品操作"
          icon={<Ellipsis size={16} aria-hidden />}
          groups={[
            { id: 'main', items: [{ id: 'rename', label: '重命名', onSelect: () => {} }, { id: 'export', label: '导出…', onSelect: () => {} }] },
            { id: 'danger', tone: 'danger', label: '危险操作', items: [{ id: 'delete', label: '删除作品…', onSelect: onDelete }] },
          ]}
        />
      </div>,
    )
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(trigger.getAttribute('aria-label')).toBe('作品操作')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await userEvent.tab()
    expect(focused()).toBe(trigger)
    expectFocusRing(trigger)
    await userEvent.keyboard('{Enter}')
    await settle()
    const menu = container.querySelector('[role="menu"]')!
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id)
    expect(focused().textContent).toBe('重命名')

    await userEvent.keyboard('{End}')
    const dangerItem = focused()
    expect(dangerItem.textContent).toBe('删除作品…')
    expect(getComputedStyle(dangerItem).color).toBe(DANGER.light)
    expect(dangerItem.closest('[role="group"]')!.previousElementSibling!.getAttribute('role')).toBe('separator')
    await shot('rd1-menu')

    await userEvent.keyboard('{ArrowDown}')
    expect(focused().textContent).toBe('重命名')
    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(focused()).toBe(trigger)

    await userEvent.keyboard('{ArrowDown}')
    await settle()
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(focused()).toBe(trigger)
  })
})

describe('侧页内的菜单', () => {
  const onRename = vi.fn()
  const groups = [
    { id: 'main', items: [{ id: 'rename', label: '重命名', onSelect: onRename }, { id: 'export', label: '导出…', onSelect: () => {} }] },
    { id: 'danger', tone: 'danger' as const, label: '危险操作', items: [{ id: 'delete', label: '删除作品…', onSelect: () => {} }] },
  ]

  function Harness() {
    return (
      <div style={{ display: 'flex', height: 360, transform: 'translateZ(0)' }}>
        <Sheet open title="第 4 章" closeLabel="关闭侧页" onClose={() => {}}>
          <div style={{ height: 230, flex: 'none' }}>蓝图</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Menu label="段落操作" icon={<Ellipsis size={16} aria-hidden />} groups={groups} align="end" />
            <Button variant="text" size="sm">下一项</Button>
          </div>
          <div style={{ height: 400, flex: 'none' }}>更多内容</div>
        </Sheet>
      </div>
    )
  }

  async function openMenu(container: HTMLElement) {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await finishAnimations(container.querySelector('aside')!)
    await act(async () => trigger.click())
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!
    await finishAnimations(menu)
    return { trigger, menu }
  }

  it('祖先带 transform 时菜单越过侧页滚动区下沿仍可见可点，且不撑出滚动条', async () => {
    const container = await mount(<Harness />)
    const body = container.querySelector<HTMLElement>('.pi-sheet-body')!
    const scrollHeight = body.scrollHeight
    const { trigger, menu } = await openMenu(container)

    const bodyRect = body.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    expect(menuRect.bottom).toBeGreaterThan(bodyRect.bottom)
    expect(menuRect.top).toBeCloseTo(triggerRect.bottom + 6, 0)
    expect(menuRect.right).toBeCloseTo(triggerRect.right, 0)
    const hit = document.elementFromPoint(menuRect.left + menuRect.width / 2, (bodyRect.bottom + menuRect.bottom) / 2)
    expect(hit?.closest('[role="menuitem"]')).not.toBeNull()
    expect(body.scrollHeight).toBe(scrollHeight)
    expect(getComputedStyle(menu).backgroundColor).toBe(tokenColor(container, '--surface'))
    await shot('rd1-menu-in-sheet')

    await userEvent.click(page.getByRole('menuitem', { name: '重命名' }))
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('Esc 只关菜单不关侧页，焦点回到触发按钮；Tab 离开菜单后焦点到触发按钮的下一项', async () => {
    const container = await mount(<Harness />)
    const { trigger } = await openMenu(container)
    ;(container.querySelector('[role="menuitem"]') as HTMLElement).focus()
    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(container.querySelector('aside')).not.toBeNull()
    expect(focused()).toBe(trigger)

    await userEvent.keyboard('{ArrowDown}')
    await settle()
    expect(focused().getAttribute('role')).toBe('menuitem')
    await userEvent.tab()
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(focused().textContent).toBe('下一项')
    await userEvent.tab({ shift: true })
    expect(focused()).toBe(trigger)
  })

  it('滚动侧页时菜单关闭，不与触发按钮脱节', async () => {
    const container = await mount(<Harness />)
    await openMenu(container)
    const body = container.querySelector<HTMLElement>('.pi-sheet-body')!
    await act(async () => {
      body.scrollTop = 80
      await new Promise((resolve) => body.addEventListener('scroll', resolve, { once: true }))
    })
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})

describe('Popover', () => {
  it('键盘打开后焦点进入弹层，Esc 关闭且焦点回到触发按钮', async () => {
    const container = await mount(
      <div style={{ height: 260 }}>
        <Popover label="版本 v3" title="草稿版本"><p>v3 修稿于今天 14:20。</p></Popover>
      </div>,
    )
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    await userEvent.tab()
    expectFocusRing(trigger)
    await userEvent.keyboard('{Enter}')
    await settle()
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h3')!.id)
    expect(focused()).toBe(dialog)
    await shot('rd1-popover')

    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(focused()).toBe(trigger)
  })

  it('弹层 Portal 到纸墨根后，Tab 顺序仍接在触发按钮之后', async () => {
    const container = await mount(
      <div style={{ display: 'flex', gap: 8 }}>
        <Popover label="版本 v3" title="草稿版本"><Button variant="text" size="sm">恢复此版本</Button></Popover>
        <Button variant="text">下一项</Button>
      </div>,
    )
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(focused().getAttribute('role')).toBe('dialog')
    await userEvent.tab()
    expect(focused().textContent).toBe('恢复此版本')
    await userEvent.tab({ shift: true })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(focused()).toBe(trigger)

    await userEvent.keyboard('{Enter}')
    await settle()
    await userEvent.tab()
    await userEvent.tab()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(focused().textContent).toBe('下一项')
  })

  it('点击弹层外部关闭', async () => {
    const container = await mount(<Popover label="版本" title="草稿版本">内容</Popover>)
    await act(async () => container.querySelector('button')!.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('SegmentedControl 与 Check', () => {
  function Harness() {
    const [scope, setScope] = useState<'chapter' | 'book'>('chapter')
    const [checked, setChecked] = useState(false)
    const [on, setOn] = useState(false)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
        <SegmentedControl label="审稿范围" options={[{ value: 'chapter', label: '本章' }, { value: 'book', label: '全书' }]} value={scope} onChange={setScope} />
        <Check checked={checked} onChange={setChecked} label="同时检查人物一致性" />
        <Check kind="switch" checked={on} onChange={setOn} label="自动保存" />
      </div>
    )
  }

  it.each(['light', 'dark'] as const)('%s 主题未选中项在凹陷底叠加到各表面后对比度不低于 3:1', async (theme) => {
    const container = await mount(<Harness />, theme)
    const seg = container.querySelector<HTMLElement>('.pi-seg')!
    const unpressed = seg.querySelector('[aria-pressed="false"]')!
    expect(getComputedStyle(seg).backgroundColor).toBe(tokenColor(container, '--sunken'))
    for (const surface of ['--frame', '--surface', '--paper']) {
      const background = composite(getComputedStyle(seg).backgroundColor, tokenColor(container, surface))
      expect(contrast(getComputedStyle(unpressed).color, background)).toBeGreaterThanOrEqual(3)
    }
  })

  it('选中态与 aria-pressed、checked 一致，全部键盘可达且焦点环可见', async () => {
    const container = await mount(<Harness />)
    const group = container.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('审稿范围')
    const segments = [...group.querySelectorAll('button')]
    expect(segments.map((s) => s.getAttribute('aria-pressed'))).toEqual(['true', 'false'])

    await userEvent.tab()
    await userEvent.tab()
    expect(focused()).toBe(segments[1])
    expectFocusRing(segments[1])
    await userEvent.keyboard(' ')
    expect(segments.map((s) => s.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(getComputedStyle(segments[1]).fontWeight).toBe('500')

    await userEvent.tab()
    const checkbox = focused() as HTMLInputElement
    expect(checkbox.type).toBe('checkbox')
    expect(checkbox.getAttribute('role')).toBeNull()
    expectFocusRing(checkbox.nextElementSibling!)
    await userEvent.keyboard(' ')
    expect(checkbox.checked).toBe(true)
    expect(getComputedStyle(checkbox.nextElementSibling!).backgroundColor).toBe(ACCENT.light)

    await userEvent.tab()
    const toggle = focused() as HTMLInputElement
    expect(toggle.getAttribute('role')).toBe('switch')
    expectFocusRing(toggle.nextElementSibling!)
    await userEvent.keyboard(' ')
    expect(toggle.checked).toBe(true)
    ;(document.activeElement as HTMLElement).blur()
    await shot('rd1-seg')
  })
})

describe('StatGrid、Notice、Lifecycle', () => {
  it('统计格是带名称的描述列表，数字为 Instrument Serif', async () => {
    const container = await mount(
      <StatGrid label="作品统计" items={[{ id: 'c', label: '已定稿章节', value: '12' }, { id: 'w', label: '总字数', value: '86,400', hint: '含草稿' }]} />,
    )
    const list = container.querySelector('dl')!
    expect(list.getAttribute('aria-label')).toBe('作品统计')
    expect([...list.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['已定稿章节', '总字数'])
    expect(getComputedStyle(list.querySelector('.pi-stat-value')!).fontFamily).toContain('Instrument Serif')
  })

  it('提示条以 status 播报，按语气取图标与底色，动作可键盘到达', async () => {
    const container = await mount(
      <Notice tone="warn" title="有 2 处与设定冲突" actions={<Button variant="secondary" size="sm">查看</Button>}>可在审稿报告中处理。</Notice>,
    )
    const notice = container.querySelector('[role="status"]')!
    expect(notice.getAttribute('data-tone')).toBe('warn')
    expect(notice.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    await userEvent.tab()
    expect(focused().textContent).toBe('查看')
    expectFocusRing(focused())
  })

  it('生命周期标出当前步骤', async () => {
    const container = await mount(<Lifecycle label="第 4 章进度" steps={['写作', '审稿', '修稿', '定稿']} current={2} />)
    const steps = [...container.querySelectorAll('li')]
    expect(container.querySelector('ol')!.getAttribute('aria-label')).toBe('第 4 章进度')
    expect(steps.map((li) => li.dataset.state)).toEqual(['done', 'done', 'current', 'todo'])
    expect(steps.map((li) => li.getAttribute('aria-current'))).toEqual([null, null, 'step', null])
    expect(getComputedStyle(steps[2]).color).toBe(ACCENT.light)
  })

  it.each(['light', 'dark'] as const)('%s 主题未开始步骤为轨道色条，标签对纸面、面板、外框对比度不低于 3:1', async (theme) => {
    const container = await mount(<Lifecycle label="第 4 章进度" steps={['写作', '审稿', '修稿', '定稿']} current={2} />, theme)
    const todo = container.querySelectorAll('li')[3]
    expect(getComputedStyle(todo.querySelector('.pi-life-bar')!).backgroundColor).toBe(tokenColor(container, '--track'))
    for (const surface of ['--paper', '--surface', '--frame']) {
      expect(contrast(getComputedStyle(todo).color, tokenColor(container, surface))).toBeGreaterThanOrEqual(3)
    }
    await shot(`rd1-lifecycle-${theme}`)
  })
})

describe('InlineConfirm', () => {
  it('出现时焦点在取消上，写明后果，Esc 取消，确认为危险描边按钮', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const container = await mount(
      <InlineConfirm message="清空后无法恢复这 12 条日志。" confirmLabel="清空" cancelLabel="取消" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const group = container.querySelector('[role="group"]')!
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe('清空后无法恢复这 12 条日志。')
    expect(focused().textContent).toBe('取消')
    await userEvent.tab()
    expect(focused().className).toContain('pi-btn--danger')
    expectFocusRing(focused())
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('DangerConfirm', () => {
  function Harness({ onConfirm }: { onConfirm: () => void }) {
    const [open, setOpen] = useState(true)
    return (
      <div style={{ minHeight: 440 }}>
        <DangerConfirm
          open={open}
          onOpenChange={setOpen}
          title="删除《灯塔》"
          consequence="将删除全部章节、蓝图与设定。"
          recoverability="删除后无法恢复。"
          confirmLabel="永久删除"
          cancelLabel="取消"
          onConfirm={onConfirm}
          typeToConfirm={{ expected: '灯塔', label: '输入作品名「灯塔」以确认' }}
        />
      </div>
    )
  }

  it('名称不符时确认按钮禁用，输入作品名后可确认', async () => {
    const onConfirm = vi.fn()
    const container = await mount(<Harness onConfirm={onConfirm} />)
    await settle()
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('删除《灯塔》')
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toContain('删除后无法恢复。')
    const input = dialog.querySelector('input')!
    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '永久删除')!
    expect(focused()).toBe(input)
    expect(confirm.className).toContain('pi-btn--danger-solid')

    await userEvent.keyboard('灯')
    expect(confirm.disabled).toBe(true)
    await shot('rd1-danger')
    await userEvent.keyboard('塔')
    expect(confirm.disabled).toBe(false)
    await userEvent.tab()
    await userEvent.tab()
    expect(focused()).toBe(confirm)
    expectFocusRing(confirm)
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each(['light', 'dark'] as const)('%s 主题祖先带 transform 时对话框仍居中于视口，并取到纸墨令牌', async (theme) => {
    const container = await mount(
      <div style={{ transform: 'translateX(0)', width: 240, height: 120, overflow: 'hidden', position: 'relative', zIndex: 0 }}>
        <Harness onConfirm={() => {}} />
      </div>,
      theme,
    )
    await settle()
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const rect = dialog.getBoundingClientRect()
    expect(rect.left + rect.width / 2).toBeCloseTo(document.documentElement.clientWidth / 2, 0)
    expect(rect.top + rect.height / 2).toBeCloseTo(document.documentElement.clientHeight / 2, 0)
    expect(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20)?.closest('[role="dialog"]')).toBe(dialog)
    expect(getComputedStyle(dialog).backgroundColor).toBe(tokenColor(container, '--surface'))
  })

  it('Esc 关闭对话框且不确认', async () => {
    const onConfirm = vi.fn()
    const container = await mount(<Harness onConfirm={onConfirm} />)
    await settle()
    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('EmptyState', () => {
  it('衬线标题、说明与一个可键盘到达的动作', async () => {
    const container = await mount(
      <EmptyState heading="还没有作品" description="从一个前提开始。" action={<Button variant="primary">新建作品</Button>} />,
    )
    const heading = container.querySelector('h3')!
    expect(getComputedStyle(heading).fontFamily).toContain('Noto Serif SC')
    expect(container.querySelectorAll('button')).toHaveLength(1)
    await userEvent.tab()
    expect(focused().textContent).toBe('新建作品')
    expectFocusRing(focused())
    ;(document.activeElement as HTMLElement).blur()
    await shot('rd1-empty')
  })
})

describe('字体', () => {
  it('Instrument Serif 与 Noto Serif SC 从本地 /fonts 加载，不请求外部字体服务', async () => {
    const container = await mount(
      <div>
        <span className="pi-num" style={{ fontSize: 56 }}>3</span>
        <h1 className="pi-display" style={{ fontSize: 30 }}>雨夜车站</h1>
      </div>,
    )
    const [italicNumber] = await document.fonts.load('italic 56px "Instrument Serif"', '3')
    const [serifTitle] = await document.fonts.load('600 30px "Noto Serif SC"', '雨夜')
    expect(italicNumber?.status).toBe('loaded')
    expect(serifTitle?.status).toBe('loaded')
    expect(getComputedStyle(container.querySelector('.pi-num')!).fontFamily).toContain('Instrument Serif')
    expect(getComputedStyle(container.querySelector('h1')!).fontFamily).toContain('Noto Serif SC')
    const fontRequests = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /\.(woff2?|ttf|otf)(\?|$)/.test(name))
    expect(fontRequests.some((name) => name.includes('/fonts/InstrumentSerif-Latin-Italic.woff2'))).toBe(true)
    expect(fontRequests.every((name) => new URL(name).origin === location.origin)).toBe(true)
    await shot('rd1-fonts')
  })
})
