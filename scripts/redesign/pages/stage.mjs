// 新外壳（流程脊）。选择器用角色与可访问名称；只有正文编辑区沿用 CodeMirror 的 .cm-content。
const SHELL = '[data-shell-presentation="stage"]'

export const root = page => page.locator(SHELL)
export const spine = page => page.getByRole('navigation', { name: '创作流程' })
export const chapterList = page => spine(page).getByRole('list', { name: '章节' })
export const tabList = page => page.getByRole('tablist', { name: '已打开的页面' })
export const prose = page => page.locator(`${SHELL} .stage-content .cm-content`)

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 阶段行的可访问名称以阶段名开头，后面是状态说明。 */
export const stageButton = (page, name) => spine(page).getByRole('button', { name: new RegExp(`^${escape(name)}`) })

export async function stageStates(page) {
  return spine(page).locator('[data-stage]').evaluateAll(rows => Object.fromEntries(rows.map(row => [row.dataset.stage, row.dataset.state])))
}

export const chapterButton = (page, number) => chapterList(page).getByRole('button', { name: new RegExp(`^${number}\\D`) })

export async function chapterRows(page) {
  return chapterList(page).getByRole('button').evaluateAll(rows => rows.map(row => ({
    number: Number(row.querySelector('.stage-chapter-no')?.textContent),
    phase: row.dataset.phase,
    current: row.getAttribute('aria-current') === 'page',
  })))
}

export async function openFromLibrary(page, name) {
  await page.locator('.writer-shelf').getByRole('button', { name: `打开《${name}》` }).click()
  await spine(page).waitFor({ state: 'visible' })
}

export async function waitForProse(page, text) {
  await prose(page).getByText(text).first().waitFor({ state: 'visible', timeout: 20_000 })
}

export const tab = (page, name) => tabList(page).getByRole('tab', { name })
export const closeTabButton = (page, name) => tabList(page).getByRole('button', { name: new RegExp(`^关闭「${escape(name)}」`) })

export const saveStatus = page => root(page).getByRole('banner').getByRole('status')

export const focusToggle = page => page.getByRole('button', { name: /^(进入|退出)沉浸写作$/ })

export const palette = page => page.getByRole('dialog', { name: /^(搜索与跳转|查找章节)$/ })
export const paletteInput = page => palette(page).getByRole('combobox')

export async function findChapter(page, query) {
  await page.keyboard.press('Control+P')
  await paletteInput(page).waitFor({ state: 'visible' })
  await paletteInput(page).fill(query)
  await page.keyboard.press('Enter')
  await palette(page).waitFor({ state: 'hidden' })
}

export const capsule = page => root(page).getByRole('button', { expanded: false }).filter({ hasText: /运行中|%|等你确认/ }).first()

export async function openSettings(page) {
  await spine(page).getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '关闭设置' }).waitFor({ state: 'visible' })
}

export function removeFromLibraryButton(page, name) {
  return page.locator('.writer-shelf').getByRole('button', { name: `从最近项目移除《${name}》` })
}

export async function backToLibrary(page, name) {
  await root(page).getByRole('banner').getByRole('button', { name: `《${name}》作品菜单` }).click()
  await page.getByRole('menuitem', { name: '回到书房' }).click()
  await page.locator('.writer-shelf').waitFor({ state: 'visible' })
}

/**
 * 元素中心点上画在最上面的是否是它：被别的层盖住时为 false。
 * Radix 模态打开时 body 是 pointer-events: none，elementFromPoint 会跳过这些元素，所以临时让所有元素都参与命中测试。
 */
export function isTopmost(locator) {
  return locator.evaluate(element => {
    const probe = document.createElement('style')
    probe.textContent = '* { pointer-events: auto !important; }'
    document.head.append(probe)
    try {
      const box = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
    } finally { probe.remove() }
  })
}

/** 落点停在哪：正文章号、其他页面的位置面包屑，或空状态。 */
export async function landing(page) {
  const crumbs = await page.getByRole('navigation', { name: '位置' }).locator('span').allInnerTexts().catch(() => [])
  const empty = await root(page).getByRole('heading', { name: '从流程脊选一步开始' }).count()
  return { crumbs, empty: empty > 0 }
}

/** 正文编辑区里 CodeMirror 的搜索面板。 */
export const proseSearch = page => root(page).locator('.stage-content .cm-search')

/** 新作品首屏的版式检查：进度环半径、设定进行中时说明在名字下一行、作品资料图标跟随行文字色。 */
export function spineLayout(page) {
  return spine(page).evaluate(nav => {
    const setup = nav.querySelector('[data-stage="setup"]')
    const name = setup.querySelector('.stage-row-name').getBoundingClientRect()
    const meta = setup.querySelector('.stage-row-meta').getBoundingClientRect()
    return {
      ringRadius: setup.querySelector('.stage-ring circle')?.getAttribute('r') ?? null,
      setupMetaBelowName: meta.top >= name.bottom - 1,
      resourceIconsFollowRow: [...nav.querySelectorAll('[data-resource]')]
        .every(row => getComputedStyle(row.querySelector('svg')).color === getComputedStyle(row).color),
    }
  })
}
