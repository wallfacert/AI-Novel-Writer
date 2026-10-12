import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { chooseProjectDirectoryGrant } from '../project-directory-grant.mjs'
import { FAKE_MODEL, FIXTURE_PROSE } from './fake-model.mjs'
import * as bookshelf from './pages/bookshelf.mjs'
import * as chapter from './pages/chapter.mjs'
import * as materials from './pages/materials.mjs'
import * as project from './pages/project.mjs'
import * as runPanel from './pages/run-panel.mjs'
import * as settings from './pages/settings.mjs'
import * as shell from './pages/shell.mjs'
import * as stage from './pages/stage.mjs'
import { countUnits, STAGE_SAMPLE, stageChapterTitle } from './stage-sample.mjs'

const SAMPLE = Object.freeze({ name: '灯塔', chapterNumber: 1, blueprints: [[1, '旧港'], [2, '北堤']] })

/** 系统打开对话框直接返回 selected，文件夹与文件通用。 */
async function stubOpenDialog(app, selected) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, selected)
}

/** 用公开 IPC 预置示例作品，然后重载，让界面从书房重新打开它。 */
async function seedSample({ app, page, roots, invoke, reload }, { withDraft }) {
  const created = await invoke(page, 'project:create', { parentGrantId: (await chooseProjectDirectoryGrant(app, page, roots.projects)).grantId,
    name: SAMPLE.name, genre: '悬疑', targetAudience: '成年读者', writingLanguage: 'zh-CN' }, randomUUID(), null)
  assert.equal(created.success, true, created.error)
  const opened = await invoke(page, 'project:open', created.projectPath, randomUUID(), null)
  assert.equal(opened.success, true, opened.error)
  const session = { projectId: created.projectId, projectPath: created.projectPath, leaseId: opened.project.sessionLease }
  assert.equal((await invoke(page, 'llm:save-model', FAKE_MODEL)).success, true)
  assert.equal((await invoke(page, 'llm:set-default-model', FAKE_MODEL.id)).success, true)
  const roster = await invoke(page, 'db:character-roster-read', created.projectPath, session)
  assert.equal((await invoke(page, 'db:character-roster-commit', { operationId: randomUUID(), expectedRevision: roster.revision,
    expectedIdentityRevision: roster.identityRevision, schemaVersion: 1, intent: 'manual_edit',
    entries: [{ characterId: `draft:${randomUUID()}`, name: '林岚', role: 'protagonist', gender: '', age: '', appearance: '',
      personality: '', background: '旧港潮汐记录的测绘师。', abilities: '', motivation: '查明失踪地图的来源。',
      relationships: [], arc: '', notes: '' }] }, created.projectPath, session)).success, true)
  for (const [chapterNumber, title] of SAMPLE.blueprints) {
    assert.equal((await invoke(page, 'db:blueprint-upsert', { chapterNumber, title, role: '发展', purpose: '核对地图与潮位',
      keyEvents: '林岚在灯塔下见到守塔人', characters: [] }, created.projectPath, session)).success, true)
  }
  if (withDraft) {
    const draft = await invoke(page, 'db:draft-create', { chapterNumber: SAMPLE.chapterNumber, version: 1, source: 'write',
      content: FIXTURE_PROSE, wordCount: FIXTURE_PROSE.length }, created.projectPath, session)
    assert.equal(draft.success, true, draft.error)
  }
  await reload()
  await openSample(page)
}

/** 从书房打开示例作品，等项目树的统一刷新结束；之前的画面随刷新进度变化。 */
async function openSample(page) {
  await bookshelf.openProject(page, SAMPLE.name)
  await project.waitForTreeRefreshed(page, SAMPLE.blueprints.length)
}

const seedWithDraft = context => seedSample(context, { withDraft: true })
const seedWithoutDraft = context => seedSample(context, { withDraft: false })

async function openLatestDraft(page) {
  await project.openLatestDraft(page)
  await chapter.editor(page).getByText(FIXTURE_PROSE.slice(0, 12)).waitFor({ state: 'visible' })
}

async function writeChapter({ page }) {
  await project.openBlueprints(page)
  await chapter.writeThisChapter(page, 100)
  await runPanel.waitForWorkflowDone(page)
  await chapter.editor(page).getByText(FIXTURE_PROSE.slice(0, 12)).waitFor({ state: 'visible' })
}

async function reviewLatestDraft({ page }) {
  await openLatestDraft(page)
  await chapter.review(page)
  await runPanel.waitForWorkflowDone(page)
}

/**
 * setup 是单跑该场景时的前置；run 从前置状态走到截图状态；after 在截图后执行。
 * baseline-all 按 BASELINE_SESSIONS 串联：只跑首个场景的 setup，之后每个场景的 run 接着上一个截图点的状态。
 */
export const SCENARIOS = {
  'new-project': { model: false, run: async ({ app, page, roots }) => {
    await stubOpenDialog(app, roots.projects)
    await bookshelf.createProject(page, SAMPLE.name)
    await page.getByText('小说配置', { exact: true }).first().waitFor({ state: 'visible' })
  } },
  'open-sample': { model: false, setup: seedWithDraft, run: async ({ page }) => {
    await project.tree(page).getByText('草稿_v1', { exact: true }).waitFor({ state: 'visible' })
  } },
  'write-chapter': { model: true, setup: seedWithoutDraft, run: writeChapter },
  review: { model: true, setup: seedWithDraft, run: reviewLatestDraft },
  'revise-merge': { model: true,
    setup: async context => { await seedWithDraft(context); await reviewLatestDraft(context) },
    run: async ({ page }) => {
      await chapter.reviseFromReview(page, FAKE_MODEL.id)
      await chapter.mergeDialog(page).waitFor({ state: 'visible', timeout: 60_000 })
    },
    after: ({ page }) => chapter.completeMerge(page) },
  finalize: { model: true, setup: seedWithDraft, run: async ({ page }) => {
    await openLatestDraft(page)
    await chapter.finalize(page, SAMPLE.chapterNumber)
    await runPanel.waitForWorkflowDone(page)
  } },
  'run-panel': { model: true,
    setup: async context => { await seedWithoutDraft(context); await writeChapter(context) },
    run: async ({ page, reload }) => {
      await reload()
      await openSample(page)
      await runPanel.open(page)
      await runPanel.waitForPersistedRun(page, `第${SAMPLE.chapterNumber}章候选`)
    } },
  settings: { model: false, run: ({ page }) => settings.open(page), after: ({ page }) => settings.close(page) },
}

async function assertRunPanelHiddenThenOpens(page, open) {
  await shell.showAssistant(page)
  assert.equal(await runPanel.isOpen(page), false, '切到写作助手后 AI 输出应隐藏')
  await open()
  await runPanel.waitUntilOpen(page)
}

async function assertBottomOpensOn(page, start) {
  await shell.closeBottomPanel(page)
  await start()
  await page.waitForFunction(() => !document.querySelector('#writer-bottom')?.hasAttribute('hidden'))
  await shell.bottomTabLabel(page, '任务').waitFor({ state: 'visible', timeout: 5_000 })
}

/**
 * 不进 baseline-all 的场景：性能测量，以及 RD-2 导航意图在旧外壳上的回归。run 的返回值写进结果的 measured。
 * nav- 场景对 trunk 与 head 各跑一次（--app-root 指向 trunk），两边都通过即行为一致。
 */
export const EXTRA_SCENARIOS = {
  'write-latency': { model: true, setup: seedWithoutDraft, run: async ({ page }) => {
    await project.openBlueprints(page)
    const writeToOutputMs = await runPanel.msFromClickToOpen(page, '开始创作', () => chapter.writeThisChapter(page, 100))
    await runPanel.waitForWorkflowDone(page)
    return { writeToOutputMs }
  } },
  'nav-switch-project': { model: false, setup: seedWithDraft, run: async ({ app, page, roots, invoke }) => {
    const other = await invoke(page, 'project:create', { parentGrantId: (await chooseProjectDirectoryGrant(app, page, roots.projects)).grantId,
      name: '雾岛', genre: '悬疑', targetAudience: '成年读者', writingLanguage: 'zh-CN' }, randomUUID(), null)
    assert.equal(other.success, true, other.error)
    await shell.clickRail(page, '角色')
    await shell.toggleImmersion(page)
    assert.equal(await shell.isImmersive(page), true)
    await stubOpenDialog(app, other.projectPath)
    await shell.switchProject(page)
    await project.tree(page).getByText('雾岛', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await shell.isImmersive(page), false, '切换项目后应退出沉浸')
    assert.equal((await shell.panels(page)).sidebar, true, '切换项目后侧栏应显示')
    await project.tree(page).waitFor({ state: 'visible' })
  } },
  'nav-toast-open': { model: true, setup: seedWithoutDraft, run: async ({ page }) => {
    await project.openBlueprints(page)
    await chapter.writeThisChapter(page, 100)
    await runPanel.waitForWorkflowDone(page)
    await assertRunPanelHiddenThenOpens(page, () => runPanel.openFromCompletionToast(page))
    await runPanel.waitForPersistedRun(page, `第${SAMPLE.chapterNumber}章候选`)
  } },
  'nav-status-capsule': { model: true, setup: seedWithoutDraft, run: async ({ page, fake }) => {
    fake.gate.hold()
    await project.openBlueprints(page)
    await chapter.writeThisChapter(page, 100)
    await runPanel.waitForStatusCapsule(page)
    await assertRunPanelHiddenThenOpens(page, () => runPanel.openFromStatusCapsule(page))
  }, after: async ({ page, fake }) => {
    fake.gate.release()
    await runPanel.waitForWorkflowDone(page)
  } },
  'nav-settings-model': { model: true, setup: seedWithoutDraft, run: async ({ page }) => {
    await shell.openBackupSettings(page)
    await settings.waitForSection(page, '项目备份')
    await settings.close(page)
    await shell.clickStatusBarModel(page)
    await settings.waitForSection(page, 'AI 生成模型')
  }, after: ({ page }) => settings.close(page) },
  'nav-kb-import': { model: true, setup: seedWithoutDraft, run: async ({ app, page, roots }) => {
    const file = path.join(roots.temp, '灯塔资料.txt')
    fs.writeFileSync(file, '林岚：旧港潮汐记录的测绘师，追查失踪地图的来源。')
    await stubOpenDialog(app, file)
    await shell.clickRail(page, '小说')
    await assertBottomOpensOn(page, () => materials.importPlanningMaterial(page))
  }, after: ({ page }) => runPanel.cancelActiveRuns(page) },
  'nav-card-import': { model: true, setup: seedWithoutDraft, run: async ({ page }) => {
    await shell.clickRail(page, '角色')
    await assertBottomOpensOn(page, () => materials.importCharacterCards(page, '姓名：守塔人\n身份：灯塔看守，记得每一次钟声。'))
  }, after: ({ page }) => runPanel.cancelActiveRuns(page) },
  'nav-batch': { model: true, setup: seedWithoutDraft, run: async ({ page }) => {
    await project.openBlueprints(page)
    await assertBottomOpensOn(page, () => chapter.startBatch(page, FAKE_MODEL.id, 100))
  }, after: ({ page }) => runPanel.waitForWorkflowDone(page) },
  'nav-home-import': { model: true, setup: seedWithoutDraft, run: async ({ app, page, roots, fake }) => {
    const file = path.join(roots.temp, '参考小说.txt')
    fs.writeFileSync(file, `第1章 旧港\n${FIXTURE_PROSE}\n\n第2章 北堤\n${FIXTURE_PROSE}\n`)
    await stubOpenDialog(app, file)
    await shell.clickRail(page, '首页')
    await shell.shelf(page).waitFor({ state: 'visible' })
    assert.equal(await project.tree(page).isVisible(), false, '首页不显示项目树')
    assert.equal(await runPanel.isOpen(page), false, '首页不显示 AI 输出')
    fake.gate.hold({ embeddings: true })
    await materials.importReferenceNovelIntoCurrentProject(page, 2)
    await project.tree(page).waitFor({ state: 'visible' })
    await runPanel.waitUntilOpen(page)
    assert.equal(await shell.shelf(page).isVisible(), false, '启动导入后应离开首页')
    await project.waitForTreeRefreshed(page, SAMPLE.blueprints.length)
    await untilGateHolds(fake.gate)
  }, after: async ({ page, fake }) => {
    fake.gate.release()
    await runPanel.waitForStatusCapsuleGone(page)
  } },
  'settings-appearance': { model: false, run: async ({ page }) => {
    await settings.open(page)
    await settings.showSection(page, '外观')
  }, after: ({ page }) => settings.close(page) },
  'nav-immersive-twice': { model: false, setup: seedWithDraft, run: async ({ page }) => {
    await shell.closeBottomPanel(page)
    const before = await shell.panels(page)
    await shell.toggleImmersion(page)
    assert.deepEqual(await shell.panels(page), { sidebar: false, assistant: false, bottom: false })
    await shell.toggleImmersion(page)
    assert.deepEqual(await shell.panels(page), before, '两次切换后面板应恢复到切换前')
    assert.equal(await shell.isImmersive(page), false)
  } },
  'nav-plot-blueprint-source': { model: true, setup: seedWithoutDraft, run: async ({ page }) => {
    const title = page.getByPlaceholder('引人入胜的章节标题')
    const selectedChapter = () => page.locator('input[type="number"][aria-readonly="true"]').inputValue()
    const openSourceOf = async chapterNumber => {
      await project.openNode(page, '伏笔与叙事线索')
      await page.getByRole('tab', { name: '剧情树' }).click()
      await page.getByRole('button', { name: /^已计划/ }).nth(chapterNumber - 1).click()
      await page.getByText(`第 ${chapterNumber} 章 · 已计划`).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: `第 ${chapterNumber} 章蓝图` }).click()
      await title.waitFor({ state: 'visible' })
    }
    await project.openNode(page, '伏笔与叙事线索')
    await page.getByRole('tab', { name: '剧情树' }).click()
    await page.getByRole('button', { name: '生成剧情树' }).click()
    await page.getByRole('button', { name: /^已计划/ }).nth(SAMPLE.blueprints.length - 1).waitFor({ state: 'visible', timeout: 60_000 })

    await openSourceOf(1)
    assert.equal(await selectedChapter(), '1')
    await title.fill('旧港（未保存的改动）')
    await openSourceOf(2)
    assert.equal(await selectedChapter(), '2', '从剧情树打开第 2 章蓝图应选中第 2 章')
    await openSourceOf(1)
    assert.equal(await selectedChapter(), '1')
    assert.equal(await title.inputValue(), '旧港（未保存的改动）', '切换选中后第 1 章未保存的改动仍在')
    await page.getByText('北堤', { exact: true }).click()
    assert.equal(await selectedChapter(), '2')
    await openSourceOf(1)
    assert.equal(await selectedChapter(), '1', '再次打开同一来源应重新选中第 1 章')
    assert.equal(await title.inputValue(), '旧港（未保存的改动）')
  } },
}

const firstLine = text => text.split('\n')[0].slice(0, 16)

/** 等到有请求卡在假模型的门上：截图停在运行卡住的那一步，而不是它前后某个随机时刻。 */
async function untilGateHolds(gate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (gate.waiting === 0) {
    assert.ok(Date.now() < deadline, `${timeoutMs} ms 内没有请求卡在假模型的门上`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * 用公开 IPC 预置新外壳示例作品：12 章蓝图，1、2 章定稿，3 章已审稿，4 章草稿；架构四节齐全。
 * totalChapters 改规划总章数；beforeReload 在重载前再写入数据；landOnChapter3 为 false 时只等流程脊，落点由场景自己断言。
 */
async function seedStageSample({ app, page, roots, invoke, reload },
  { totalChapters = STAGE_SAMPLE.totalChapters, beforeReload, landOnChapter3 = true } = {}) {
  const created = await invoke(page, 'project:create', { parentGrantId: (await chooseProjectDirectoryGrant(app, page, roots.projects)).grantId,
    name: STAGE_SAMPLE.name, genre: '悬疑', targetAudience: '成年读者', writingLanguage: 'zh-CN' }, randomUUID(), null)
  assert.equal(created.success, true, created.error)
  const opened = await invoke(page, 'project:open', created.projectPath, randomUUID(), null)
  assert.equal(opened.success, true, opened.error)
  const path = created.projectPath
  const session = { projectId: created.projectId, projectPath: path, leaseId: opened.project.sessionLease }
  assert.equal((await invoke(page, 'llm:save-model', FAKE_MODEL)).success, true)
  assert.equal((await invoke(page, 'llm:set-default-model', FAKE_MODEL.id)).success, true)
  const roster = await invoke(page, 'db:character-roster-read', path, session)
  assert.equal((await invoke(page, 'db:character-roster-commit', { operationId: randomUUID(), expectedRevision: roster.revision,
    expectedIdentityRevision: roster.identityRevision, schemaVersion: 1, intent: 'manual_edit',
    entries: [{ characterId: `draft:${randomUUID()}`, name: '林岚', role: 'protagonist', gender: '', age: '', appearance: '',
      personality: '', background: '旧港潮汐记录的测绘师。', abilities: '', motivation: '查明失踪地图的来源。',
      relationships: [], arc: '', notes: '' }] }, path, session)).success, true)
  const core = await invoke(page, 'db:project-core-update', { ...STAGE_SAMPLE.core, totalChapters,
    wordsPerChapter: STAGE_SAMPLE.wordsPerChapter }, path, session)
  assert.equal(core.success, true, core.error)
  for (const [index, title] of STAGE_SAMPLE.titles.entries()) {
    assert.equal((await invoke(page, 'db:blueprint-upsert', { chapterNumber: index + 1, title, role: '发展', purpose: '推进灯塔与沉船的线索',
      keyEvents: '林岚在灯塔里找到新的线索', characters: [] }, path, session)).success, true)
  }
  const imported = await invoke(page, 'db:draft-import-finalized-batch', { operationId: randomUUID(),
    chapters: Object.entries(STAGE_SAMPLE.finalized).map(([number, content]) => ({ chapterNumber: Number(number),
      title: stageChapterTitle(Number(number)), content, wordCount: countUnits(content) })) }, path, session)
  assert.equal(imported.success, true, imported.error)
  for (const [number, { status, text }] of Object.entries(STAGE_SAMPLE.drafts)) {
    const draft = await invoke(page, 'db:draft-create', { chapterNumber: Number(number), version: 1, source: 'write',
      content: text, wordCount: countUnits(text) }, path, session)
    assert.equal(draft.success, true, draft.error)
    if (status !== 'draft') assert.equal((await invoke(page, 'db:draft-update-status', draft.id, status, undefined, path, session)).success, true)
  }
  await beforeReload?.({ page, invoke, path, session })
  await reload()
  if (await stage.root(page).count() > 0) {
    await stage.openFromLibrary(page, STAGE_SAMPLE.name)
    if (landOnChapter3) await stage.waitForProse(page, firstLine(STAGE_SAMPLE.drafts[3].text))
    return
  }
  await bookshelf.openProject(page, STAGE_SAMPLE.name)
  await project.waitForTreeRefreshed(page, STAGE_SAMPLE.titles.length)
  await project.draftOfChapter(page, 3).click()
  await chapter.editor(page).getByText(firstLine(STAGE_SAMPLE.drafts[3].text)).waitFor({ state: 'visible' })
}

/** 在渲染进程里计时：从点击 trigger 指向的元素到正文编辑区出现 text，单位毫秒，帧粒度。 */
async function msFromClickToProse(page, target, proseSelector, text, deadlineMs = 20_000) {
  const handle = await target.elementHandle()
  await page.evaluate(({ element, proseSelector, text, deadlineMs }) => {
    let clickedAt = null
    element.addEventListener('click', () => { clickedAt ??= performance.now() }, { capture: true, once: true })
    window.__driveProseLatency = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`正文在 ${deadlineMs} ms 内未出现`)), deadlineMs)
      const tick = () => {
        const shown = [...document.querySelectorAll(proseSelector)].some(node => node.textContent.includes(text) && node.getClientRects().length > 0)
        if (clickedAt !== null && shown) {
          clearTimeout(deadline)
          resolve(Math.round(performance.now() - clickedAt))
        } else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, { element: handle, proseSelector, text, deadlineMs })
  await target.click()
  return page.evaluate(() => window.__driveProseLatency)
}

/**
 * 外壳文字与它实际落在的底色之间的对比度：名称与正文类文字至少 4.5:1，说明文字至少 3:1。
 * 底色沿祖先逐层叠加半透明背景求出，与画面上的颜色一致。
 */
async function chromeContrastFailures(page) {
  return page.evaluate(() => {
    // color-mix 的结果以 color(srgb r g b / a) 给出，通道是 0–1；rgb()/rgba() 是 0–255
    const parse = value => {
      const numbers = value.match(/[\d.]+/g).map(Number)
      const [r, g, b] = value.startsWith('color(') ? numbers.slice(0, 3).map(channel => channel * 255) : numbers.slice(0, 3)
      return { r, g, b, a: numbers[3] ?? 1 }
    }
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a), a: 1 })
    const backdrop = element => {
      const layers = []
      for (let node = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor)
        if (color.a > 0) layers.push(color)
        if (color.a === 1) break
      }
      return layers.reverse().reduce((bottom, top) => over(top, bottom), { r: 255, g: 255, b: 255, a: 1 })
    }
    const luminance = ({ r, g, b }) => [r, g, b].map(value => value / 255)
      .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const ratio = (a, b) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (high + 0.05) / (low + 0.05)
    }
    const checks = [
      ['.stage-row-name', 4.5], ['.stage-row-label', 4.5], ['.stage-chapter:not([data-phase="todo"]) .stage-chapter-title', 4.5],
      ['.stage-work-title', 4.5], ['.stage-row-meta', 3], ['.stage-chapter-status', 3], ['.stage-chapter[data-phase="todo"] .stage-chapter-title', 3],
      ['.stage-crumb', 3], ['.stage-search-hint', 3], ['.stage-saved', 3], ['.stage-spine-label', 3], ['.stage-chapter-no', 3],
      ['.writer-shelf li > button', 4.5],
    ]
    return checks.flatMap(([selector, minimum]) => [...document.querySelectorAll(`[data-shell-presentation="stage"] ${selector}`)].map(element => {
      const value = ratio(parse(getComputedStyle(element).color), backdrop(element))
      return { selector, text: element.textContent, ratio: Math.round(value * 100) / 100, minimum }
    }).filter(result => result.ratio < result.minimum))
  })
}

async function assertSpineMatchesSample(page) {
  assert.deepEqual(await stage.stageStates(page), { setup: 'done', architecture: 'done', blueprint: 'done', manuscript: 'active' })
  const rows = await stage.chapterRows(page)
  assert.deepEqual(rows.map(row => row.number), STAGE_SAMPLE.titles.map((_, index) => index + 1))
  assert.deepEqual(rows.slice(0, 5).map(row => row.phase), ['final', 'final', 'reviewed', 'draft', 'todo'])
  assert.deepEqual(rows.filter(row => row.current).map(row => row.number), [3], '落点应是第一章写到一半的第 3 章')
}

/** 新外壳场景只在 head 上跑（trunk 没有新外壳）；chapter-switch 两种外壳都能跑，用于性能对照。 */
export const STAGE_SCENARIOS = {
  'stage-open-sample': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await assertSpineMatchesSample(page)
    assert.equal(await stage.tabList(page).count(), 0, '只有一个标签时标签条收起')
    assert.deepEqual(await chromeContrastFailures(page), [], '外壳文字对比度不足')
  } },
  'stage-tabs': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.stageButton(page, '设定').click()
    await stage.tabList(page).waitFor({ state: 'visible' })
    await stage.stageButton(page, '蓝图').click()
    await stage.tab(page, '蓝图').waitFor({ state: 'visible' })
    assert.equal(await stage.tabList(page).getByRole('tab').count(), 3)
    await stage.closeTabButton(page, '设定').click()
    await stage.tab(page, '设定').waitFor({ state: 'detached' })
    assert.equal(await stage.tabList(page).getByRole('tab').count(), 2, '关掉一个后还剩两个，标签条仍在')
  }, after: async ({ page }) => {
    await stage.closeTabButton(page, '蓝图').click()
    await stage.tabList(page).waitFor({ state: 'detached' })
  } },
  'stage-dirty-close': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.stageButton(page, '设定').click()
    const field = page.getByPlaceholder('如：修仙/重生/末世')
    await field.fill('海港悬疑')
    await stage.saveStatus(page).filter({ hasText: '未保存' }).waitFor({ state: 'visible' })
    await stage.closeTabButton(page, '设定').click()
    await page.getByRole('dialog', { name: '放弃未保存的修改？' }).waitFor({ state: 'visible' })
  }, after: async ({ page }) => {
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await page.getByRole('dialog', { name: '放弃未保存的修改？' }).waitFor({ state: 'hidden' })
    assert.equal(await stage.tab(page, '设定').getAttribute('aria-selected'), 'true', '取消后标签仍在')
    assert.equal(await page.getByPlaceholder('如：修仙/重生/末世').inputValue(), '海港悬疑', '取消后修改保留')
  } },
  'stage-save': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.stageButton(page, '设定').click()
    await page.getByPlaceholder('如：修仙/重生/末世').fill('海港悬疑')
    await stage.saveStatus(page).filter({ hasText: '未保存' }).waitFor({ state: 'visible' })
    await page.keyboard.press('Control+S')
    await stage.saveStatus(page).filter({ hasText: '已保存' }).waitFor({ state: 'visible' })
  } },
  'stage-find-chapter': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.stageButton(page, '蓝图').click()
    await stage.tab(page, '蓝图').waitFor({ state: 'visible' })
    await stage.stageButton(page, '设定').click()
    await stage.findChapter(page, '4')
    await stage.waitForProse(page, firstLine(STAGE_SAMPLE.drafts[4].text))
    assert.deepEqual((await stage.chapterRows(page)).filter(row => row.current).map(row => row.number), [4])
    await stage.findChapter(page, '第3章')
    await stage.waitForProse(page, firstLine(STAGE_SAMPLE.drafts[3].text))
    assert.deepEqual((await stage.chapterRows(page)).filter(row => row.current).map(row => row.number), [3])
  } },
  'stage-focus': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.focusToggle(page).click()
    await stage.spine(page).waitFor({ state: 'detached' })
    assert.equal(await stage.tabList(page).count(), 0)
    await stage.waitForProse(page, firstLine(STAGE_SAMPLE.drafts[3].text))
    await page.getByRole('button', { name: 'AI 审稿', exact: true }).waitFor({ state: 'visible' })
  }, after: async ({ page }) => {
    await page.keyboard.press('Escape')
    await stage.spine(page).waitFor({ state: 'visible' })
  } },
  'stage-1280': { model: false, shell: 'stage', setup: async context => {
    await context.page.setViewportSize({ width: 1280, height: 900 })
    await seedStageSample(context)
  }, run: async ({ page }) => {
    const overflow = await page.evaluate(() => {
      const scroller = document.scrollingElement
      const clipped = [...document.querySelectorAll('.stage-row-name, .stage-chapter-title, .stage-crumb, .stage-work-title, .stage-search-hint, .stage-saved')]
        .filter(node => node.scrollWidth > node.clientWidth + 1 || node.getClientRects().length > 1)
        .map(node => node.textContent)
      return { horizontal: scroller.scrollWidth - scroller.clientWidth, clipped }
    })
    assert.deepEqual(overflow, { horizontal: 0, clipped: [] })
  } },
  'stage-palette': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await page.keyboard.press('Control+K')
    await stage.paletteInput(page).fill('灯')
    await stage.palette(page).getByRole('option', { name: /第二盏灯/ }).waitFor({ state: 'visible' })
  }, after: async ({ page }) => {
    await page.keyboard.press('Escape')
    await stage.palette(page).waitFor({ state: 'hidden' })
  } },
  'stage-library': { model: false, shell: 'stage', run: async ({ page }) => {
    await shell.firstInteractiveControl(page).waitFor({ state: 'visible' })
    assert.equal(await stage.spine(page).count(), 0, '书房没有流程脊')
  } },
  'stage-library-recent': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.backToLibrary(page, STAGE_SAMPLE.name)
    await stage.removeFromLibraryButton(page, STAGE_SAMPLE.name).scrollIntoViewIfNeeded()
    assert.deepEqual(await chromeContrastFailures(page), [], '书房书架按钮文字对比度不足')
  }, after: async ({ page }) => {
    await stage.removeFromLibraryButton(page, STAGE_SAMPLE.name).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '这只会移除列表记录' })
    await dialog.getByRole('button', { name: '移除记录', exact: true }).click()
    await stage.removeFromLibraryButton(page, STAGE_SAMPLE.name).waitFor({ state: 'detached' })
  } },
  'stage-run': { model: true, shell: 'stage', setup: seedStageSample, run: async ({ page, fake }) => {
    fake.gate.hold()
    await stage.stageButton(page, '蓝图').click()
    await chapter.writeNextChapter(page, 100)
    await page.getByRole('heading', { name: '运行', exact: true }).waitFor({ state: 'visible' })
    await stage.root(page).getByRole('button', { expanded: true }).filter({ hasText: '%' }).waitFor({ state: 'visible' })
  }, after: async ({ page, fake }) => {
    await page.keyboard.press('Control+K')
    await stage.paletteInput(page).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await stage.palette(page).waitFor({ state: 'hidden' })
    fake.gate.release()
    await runPanel.waitForWorkflowDone(page)
    await stage.waitForProse(page, firstLine(FIXTURE_PROSE))
  } },
  'stage-settings-switch': { model: false, setup: seedWithDraft, run: async ({ page }) => {
    await openLatestDraft(page)
    await settings.open(page)
    await settings.chooseShell(page, '创作流程（预览）')
    await stage.root(page).waitFor({ state: 'visible' })
    assert.equal(await settings.currentSection(page), '外观', '切换外壳后设置仍停在外观')
    await settings.close(page)
    await stage.spine(page).waitFor({ state: 'visible' })
    await stage.waitForProse(page, FIXTURE_PROSE.slice(0, 12))
    assert.deepEqual(await page.getByRole('navigation', { name: '位置' }).locator('span').allInnerTexts(), ['正文', '第 1 章'],
      '切换外壳后停在原来打开的草稿，不跳到落点页')
  } },
  'stage-migrate': { model: false, run: async ({ page, reload }) => {
    const key = 'ai-novel-writer-appearance'
    const current = JSON.parse(await page.evaluate(storageKey => localStorage.getItem(storageKey), key))
    const v1 = JSON.stringify({ schemaVersion: 1, revision: current.revision + 1, shellPreference: 'writer', colorTheme: 'paper', zoom: 1.1,
      writingFont: 'noto-serif-sc', uiFont: 'inter', origin: 'author', legacyImportCompleted: true, legacyFontDefaultsVersion: 1 })
    await page.evaluate(([storageKey, raw]) => localStorage.setItem(storageKey, raw), [key, v1])
    await reload()
    await shell.firstInteractiveControl(page).waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(storageKey => localStorage.getItem(storageKey), key), v1, '启动不改写 v1 配置，旧版本仍能读')
  } },
  'stage-modal-layers': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ app, page }) => {
    await stage.stageButton(page, '设定').click()
    await page.getByPlaceholder('如：修仙/重生/末世').fill('海港悬疑')
    await stage.saveStatus(page).filter({ hasText: '未保存' }).waitFor({ state: 'visible' })
    await stage.openSettings(page)
    const discard = page.getByRole('dialog', { name: '放弃未保存的修改？' })
    const observed = {}
    await page.keyboard.press('Control+K')
    await page.waitForTimeout(300)
    observed.paletteUnderSettings = await stage.palette(page).count() > 0
    if (observed.paletteUnderSettings) await page.keyboard.press('Escape')
    await page.keyboard.press('Control+W')
    await page.waitForTimeout(300)
    observed.discardUnderSettings = await discard.count() > 0
    if (observed.discardUnderSettings) await page.keyboard.press('Escape')
    await shell.requestWindowClose(app)
    const exit = page.getByRole('dialog', { name: '退出前处理未保存的内容' })
    await exit.waitFor({ state: 'visible' })
    observed.exitOnTop = await stage.isTopmost(exit)
    assert.deepEqual(observed, { paletteUnderSettings: false, discardUnderSettings: false, exitOnTop: true },
      '设置开着时 Ctrl K、Ctrl W 不在设置下面开层，关窗时退出确认盖在设置之上')
  }, after: async ({ page }) => {
    await page.getByRole('dialog', { name: '退出前处理未保存的内容' }).getByRole('button', { name: '取消', exact: true }).click()
    await settings.close(page)
  } },
  /**
   * 应用菜单里有 CommandOrControl+W 的「关闭」，页面没拦下的 Ctrl W 会关窗。驱动注入的按键到不了菜单快捷键，
   * 所以这里断言页面把 Ctrl W 拦下了（defaultPrevented），并确认应用仍在。
   */
  'stage-close-key': { model: false, shell: 'stage', run: async ({ app, page }) => {
    await shell.firstInteractiveControl(page).waitFor({ state: 'visible' })
    await page.evaluate(() => {
      window.__driveCloseKey = []
      window.addEventListener('keydown', event => { if (event.code === 'KeyW') window.__driveCloseKey.push(event.defaultPrevented) })
    })
    const pressCloseKey = async () => {
      await page.keyboard.press('Control+W')
      return page.evaluate(() => window.__driveCloseKey.at(-1))
    }
    const observed = { library: await pressCloseKey() }
    await page.keyboard.press('Control+K')
    await stage.paletteInput(page).waitFor({ state: 'visible' })
    observed.palette = await pressCloseKey()
    observed.alive = !page.isClosed() && app.windows().length > 0
    assert.deepEqual(observed, { library: true, palette: true, alive: true }, 'Ctrl W 在书房与对话框里都由页面拦下，不落到菜单的「关闭」')
  }, after: async ({ page }) => {
    await page.keyboard.press('Escape')
    await stage.palette(page).waitFor({ state: 'hidden' })
  } },
  'stage-reopen': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.backToLibrary(page, STAGE_SAMPLE.name)
    await stage.openFromLibrary(page, STAGE_SAMPLE.name)
    await stage.prose(page).getByText(firstLine(STAGE_SAMPLE.drafts[3].text)).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    assert.deepEqual(await stage.landing(page), { crumbs: ['正文', '第 3 章'], empty: false }, '重开同一部作品再次落到第 3 章')
  } },
  'stage-partial-blueprint': { model: false, shell: 'stage',
    setup: context => seedStageSample(context, { totalChapters: 100, landOnChapter3: false }),
    run: async ({ page }) => {
      await stage.prose(page).getByText(firstLine(STAGE_SAMPLE.drafts[3].text)).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
      assert.deepEqual({ ...(await stage.landing(page)), blueprint: (await stage.stageStates(page)).blueprint },
        { crumbs: ['正文', '第 3 章'], empty: false, blueprint: 'done' }, '规划 100 章只写了 12 章蓝图时，蓝图已完成，落点仍是正文第 3 章')
    } },
  /** 第 1 章回到了草稿，成了最早一章写到一半的，所以打开作品就落在它上面；再从章节列表点它仍是这份草稿。 */
  'stage-revert-after-final': { model: false, shell: 'stage',
    setup: context => seedStageSample(context, { landOnChapter3: false, beforeReload: async ({ page, invoke, path, session }) => {
      const version = await invoke(page, 'db:draft-next-version', 1, path, session)
      const created = await invoke(page, 'db:draft-create', { chapterNumber: 1, version, source: 'rewrite',
        content: STAGE_SAMPLE.reverted, wordCount: countUnits(STAGE_SAMPLE.reverted) }, path, session)
      assert.equal(created.success, true, created.error)
    } }),
    run: async ({ page }) => {
      await stage.chapterList(page).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
      await stage.chapterButton(page, 1).click()
      const reverted = stage.prose(page).getByText(firstLine(STAGE_SAMPLE.reverted)).first()
      await reverted.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
      const row = (await stage.chapterRows(page)).find(candidate => candidate.number === 1)
      assert.deepEqual({ phase: row.phase, opened: await reverted.isVisible() }, { phase: 'draft', opened: true },
        '定稿后回退出的新草稿按草稿显示，打开的是这份草稿')
    } },
  'stage-new-project': { model: false, shell: 'stage', run: async ({ app, page, roots }) => {
    await stubOpenDialog(app, roots.projects)
    await bookshelf.createProject(page, '雾岛')
    await stage.stageButton(page, '正文').waitFor({ state: 'visible' })
    assert.deepEqual(await stage.stageStates(page), { setup: 'active', architecture: 'todo', blueprint: 'todo', manuscript: 'todo' })
    assert.deepEqual(await chromeContrastFailures(page), [], '新作品首屏外壳文字对比度不足')
    assert.deepEqual(await stage.spineLayout(page), { ringRadius: '8.5', setupMetaBelowName: true, resourceIconsFollowRow: true })
  } },
  'stage-focus-search': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page }) => {
    await stage.focusToggle(page).click()
    await stage.spine(page).waitFor({ state: 'detached' })
    await stage.prose(page).click()
    await page.keyboard.press('Control+F')
    await stage.proseSearch(page).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert.deepEqual({ searchOpen: await stage.proseSearch(page).count() > 0, focus: await stage.spine(page).count() === 0 },
      { searchOpen: false, focus: true }, '沉浸写作里 Esc 先关正文搜索框，不退出沉浸')
  }, after: async ({ page }) => {
    await page.keyboard.press('Escape')
    await stage.spine(page).waitFor({ state: 'visible' })
  } },
  'stage-tour': { model: true, shell: 'stage', setup: seedStageSample, run: async ({ page, fake }) => {
    const pause = ms => page.waitForTimeout(ms)
    await pause(1500)
    for (const name of ['设定', '架构', '蓝图']) {
      await stage.stageButton(page, name).click()
      await pause(1500)
    }
    await stage.stageButton(page, '正文').click()
    await stage.waitForProse(page, firstLine(STAGE_SAMPLE.drafts[3].text))
    await pause(1500)
    await page.keyboard.press('Control+K')
    await stage.paletteInput(page).waitFor({ state: 'visible' })
    await pause(700)
    await stage.paletteInput(page).pressSequentially('守塔', { delay: 220 })
    await pause(900)
    await page.keyboard.press('Enter')
    await stage.waitForProse(page, firstLine(STAGE_SAMPLE.drafts[4].text))
    await pause(1500)
    await page.keyboard.press('Control+P')
    await stage.paletteInput(page).waitFor({ state: 'visible' })
    await pause(500)
    await stage.paletteInput(page).pressSequentially('1', { delay: 200 })
    await pause(700)
    await page.keyboard.press('Enter')
    await stage.waitForProse(page, firstLine(STAGE_SAMPLE.finalized[1]))
    await pause(1500)
    await stage.closeTabButton(page, `第 1 章 · ${stageChapterTitle(1)}`).click()
    await pause(1000)
    await stage.focusToggle(page).click()
    await pause(2500)
    await page.keyboard.press('Escape')
    await pause(1200)
    fake.gate.hold()
    await stage.stageButton(page, '蓝图').click()
    await pause(1200)
    await chapter.writeNextChapter(page, 100)
    await page.getByRole('heading', { name: '运行', exact: true }).waitFor({ state: 'visible' })
    await pause(3000)
    fake.gate.release()
    await runPanel.waitForWorkflowDone(page)
    await pause(2000)
  } },
  'chapter-switch': { model: false, setup: seedStageSample, run: async ({ page }) => {
    const target = firstLine(STAGE_SAMPLE.drafts[4].text)
    if (await stage.root(page).count() > 0) {
      return { chapterSwitchMs: await msFromClickToProse(page, stage.chapterButton(page, 4), '.stage-content .cm-content', target) }
    }
    return { chapterSwitchMs: await msFromClickToProse(page, project.draftOfChapter(page, 4), chapter.EDITOR, target) }
  } },
}

/** new-project 与示例作品都建「灯塔」，同一项目目录里不能共存，所以分两个会话。 */
export const BASELINE_SESSIONS = {
  shelf: ['settings', 'new-project'],
  sample: ['open-sample', 'write-chapter', 'run-panel', 'review', 'revise-merge', 'finalize'],
}
