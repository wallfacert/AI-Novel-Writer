---
name: verify
description: 在真实 Electron 中驱动 AI 小说作家，按场景截图、记录启动耗时并读取只读诊断。前端重设计 RD-0 至 RD-10 每个 PR 的实机验证都走这里。用于「实机验证」「截图对比」「跑一下界面场景」。
---

# verify

驱动脚本是 `scripts/redesign/drive.mjs`。它用 Playwright 的 `_electron` 启动当前工作树的构建产物（`electron .`），每个会话（一次冷启动）一个全新的隔离目录，模型调用全部走本机假服务，不调用真实模型。单跑一个场景就是只含这个场景的会话。

应用窗口不出现在屏幕上。驱动用 `electron -r scripts/redesign/offscreen-window.cjs` 在应用主进程脚本之前挂上 `browser-window-created` 监听：窗口一创建就移到所有显示器右侧之外，去掉任务栏按钮，设为不可激活并交还焦点，不打扰正在用电脑的人。截图走页面视口，与窗口位置无关；页面焦点由 Playwright 的焦点模拟提供，`document.hasFocus()` 仍为 true。每次截图前断言 `document.visibilityState` 为 `visible`，防止屏幕外窗口被当作隐藏而停帧。

## 启动前

在要验证的工作树根目录依次运行：

```bash
pnpm install --frozen-lockfile
pnpm rebuild:electron
pnpm build
```

驱动加载的是 `dist/` 与 `dist-electron/`，改了 `src/` 或 `electron/` 必须重新 `pnpm build`。`better-sqlite3` 刚为 vitest 切到 Node ABI（`pnpm prepare:native-node`）时，先 `pnpm rebuild:electron` 再驱动。

## 命令

```bash
pnpm verify:drive -- --scenario <名称> [--theme light|dark] [--shell writer|stage] [--out <目录>] [--dump-dom] [--console] [--video] [--app-root <目录>]
# 等价于
node scripts/redesign/drive.mjs --scenario <名称> ...
```

- `--theme` 默认 `light`，即外观里的「浅色」；`dark` 为「深色」。
- `--shell` 不给时不碰外观里的外壳偏好（旧外壳）；`stage` 为 RD-3 起的新外壳（流程脊）。与主题在同一次写入里改，只重载一次。新外壳场景自己声明 `shell: 'stage'`，不必再传；`startup-timing` 与 `chapter-switch` 两种外壳都能跑，用 `--shell stage` 选新外壳。trunk（RD-2 及以前）不认识 `stage`，对 trunk 不要传。
- `--video` 在每个截图点的 `run` 期间录屏：CDP `Page.startScreencast` 收帧，按帧时间戳交给本机 `ffmpeg` 编成 H.264 mp4，写到 `<场景>-<主题>.mp4`。不需要 Playwright 自带的 ffmpeg。
- `--out` 默认 `.runtime/redesign-baseline/`（已被 git 忽略）。
- `--app-root` 默认当前工作树。性能对照时指向 trunk 的工作树，用同一个驱动测两边；目标工作树也要先跑完上面三条命令，它加载的是自己的 `dist-electron/` 和 `better-sqlite3`。
- 退出码：0 全部通过；1 有场景失败、残留进程或隔离目录外写入；2 参数错误。

## 场景

| 名称 | 对应流程 | 单跑时截图停在 | `baseline-all` 里的不同 | 用夹具模型 |
|---|---|---|---|---|
| `new-project` | 新建作品 | 新作品的小说配置页 | 无 | 否 |
| `open-sample` | 打开示例作品 | 项目树刷新完成（蓝图 2/100 章、角色图谱已生成），显示第 1 章与草稿_v1 | 无 | 否 |
| `write-chapter` | 写作此章 | 草稿标签已打开，正文非空 | 已有预置的草稿_v1，写出的是草稿_v2 | 是 |
| `review` | AI 审稿 | 审稿报告标签 | 审的是最新一稿草稿_v2 | 是 |
| `revise-merge` | 按确认意见修稿并合并 | 修稿合并对话框；截图后点完成合并，等对话框关闭 | 修的是草稿_v2 | 是 |
| `finalize` | 定稿 | 已定稿（只读），AI 输出显示后处理完成 | 定稿的是合并后的草稿_v2，不是草稿_v1 | 是 |
| `run-panel` | 打开运行面板（现为 AI 输出） | 重开作品后从右侧栏打开 AI 输出，显示一条持久运行「第1章候选」 | 无；它排在审稿之前，因为草稿被修稿改动后这条记录变成「第1章生成记录」 | 是 |
| `settings` | 打开设置 | 设置弹窗 | 截图后关闭设置，接着跑 new-project | 否 |
| `baseline-all` | 按共享前置串成 2 个会话跑上面 8 个场景 | 8 张截图 | | |
| `startup-timing` | 只启动 | 不截图，输出启动耗时 | | 否 |

示例作品名为「灯塔」，第 1 章「旧港」，由公开 IPC 预置后从书房打开；打开后等项目树统一刷新结束再继续，之前的画面随刷新进度变化。

`scripts/redesign/scenarios.mjs` 里每个场景分三段：`setup` 是单跑时的前置（预置作品、写一章、审稿等），`run` 从前置状态走到截图状态，`after` 在截图后执行。一个会话只跑首个场景的 `setup`，然后依次 `run`、截图、`after`。`baseline-all` 的会话在 `BASELINE_SESSIONS`：

- `baseline-shelf`：`settings` → `new-project`。不预置作品，`new-project` 要在空项目目录里建「灯塔」，与示例作品不能共存。
- `baseline-sample`：`open-sample` → `write-chapter` → `run-panel` → `review` → `revise-merge` → `finalize`。预置一次带草稿_v1 的示例作品，后面每步接着上一步的状态。

改动前 `baseline-all` 每个场景各冷启动一次（8 次）；现在 2 次。

## 输出

在 `--out` 目录下：

- `<场景>-<主题>.png`：场景截图，1440×900（`stage-1280` 为 1280×900）。
- `--video` 时另有 `<场景>-<主题>.mp4`，结果项的 `video` 字段指向它。
- `<场景>-<主题>.json`：本次运行的结果数组，每个截图点一项。`scenario`、`screenshot` 属于这个截图点；`session`（会话名，单跑时等于场景名）、`timing`、`shell`（外壳的 `data-shell-presentation`，`writer` 或 `stage`：`startup-timing` 取计时那次启动显示的外壳，其余场景取写好外观、重载之后的外壳，用来确认测的就是要测的外壳）、`externalRequests`、`residualProcesses`、`externalWrites`、`quit`、`isolationRoot` 属于整个会话，会话里每一项都抄一份；会话用了夹具模型时另含 `modelRequests`（整个会话里假服务收到的全部请求数，嵌入请求也计入，与 `--console` 里的 `[fake-model]` 行一一对应）。失败时含 `error`：截图点自己的失败写在该项；同一会话里排在失败点之后的截图点不再运行，`error` 写明是被哪个场景拖住；会话级失败（启动、外部请求、退出、进程枚举）写进该会话的每一项。
- 失败时额外写 `<失败场景>-<主题>.failure.png`、`.dom.html`、`.aria.yml` 和 `<会话>-<主题>.console.log`，隔离目录保留以便排查。

每个会话结束后，驱动检查三件事，任一不满足即退出码 1：

- `externalRequests` 为空。每个会话都在 Electron 启动后替换主进程的 `globalThis.fetch`：用夹具模型的会话只放行 `https://api.openai.com/v1/*` 并改道到本机假服务，其余会话一律不放行。被拒的请求记下来源并抛错。检查范围只有主进程 `fetch`，且从 `electron.launch` 返回后才生效；更早的请求、渲染进程的请求和 Electron `net` 模块的请求都不在内。
- `residualProcesses` 为空：应用关闭后，以 `--user-data-dir` 匹配不到存活进程。子进程退出需要时间，驱动最多查 10 次、间隔 300 ms。
- `externalWrites` 为空：`~/.vela`、`%APPDATA%\ai-novel-writer`、`%APPDATA%\AI小说作家` 的最新修改时间不变。

枚举或结束进程本身失败时，原因写进该会话每一项的 `error`，结果 JSON 照常写出。

## 只读诊断

```bash
node scripts/redesign/drive.mjs --scenario open-sample --dump-dom --console --out <目录>
```

- `--dump-dom` 在每个截图点截图后写 `<场景>-<主题>.dom.html`（`page.content()`）和 `.aria.yml`（Playwright 无障碍快照）。改页面对象前先看 `.aria.yml`，选择器优先用其中的角色与可访问名称。
- `--console` 每个会话写一份 `<会话>-<主题>.console.log`（单跑时会话名就是场景名，`baseline-all` 为 `baseline-shelf`、`baseline-sample`）：渲染进程控制台、页面异常、主进程 stdout/stderr，以及假模型每次请求的分类（`[fake-model] prose|review|revision|character-state|embedding`）。

## 截图可重复性

同一场景连续跑三次再比较：

```bash
for i in 1 2 3; do node scripts/redesign/drive.mjs --scenario review --out shots/r$i; done
node scripts/redesign/pixel-diff.mjs shots/r1/review-light.png shots/r2/review-light.png shots/r3/review-light.png
```

`pixel-diff.mjs` 输出各张相对第一张的不同像素占比，`maxRatio` 小于 0.005 时退出码 0，否则 1。尺寸与第一张不同的图记为全部不同（`ratio` 为 1），`reason` 写明两边尺寸。任一通道差值超过 2 级才算不同像素（`ratio`），因为同一状态连续截图时，渲染器在背景模糊和渐变上偶发全屏 ±1～2 级抖动；逐字节比较的结果另列为 `strictRatio`，供判断差异是不是这种抖动。

## 启动耗时

`startup-timing` 的 `timing` 字段：`readyToShowToInteractiveMs`（主窗口 `ready-to-show` 到书房「新建作品」按钮可见，计划里的性能指标）、`launchToInteractiveMs`、`navigationToInteractiveMs`。`ready-to-show` 监听在预加载脚本里、先于移窗挂上，窗口创建前就已就位，所以每次都有值。trunk 与 head 交替各跑 5 次取中位数：

```bash
node scripts/redesign/drive.mjs --scenario startup-timing --app-root <trunk 工作树> --out <目录>
node scripts/redesign/drive.mjs --scenario startup-timing --out <目录>
```

## 不进 baseline-all 的场景

`scenarios.mjs` 的 `EXTRA_SCENARIOS` 只能单跑，不进 `baseline-all`。`run` 的返回值写进结果的 `measured`。需要卡住模型调用时，场景从上下文的 `fake.gate` 调 `hold()`，在 `after` 里 `release()`。`hold()` 只卡对话请求；只走嵌入的步骤（参考文本入库）用 `hold({ embeddings: true })` 连嵌入一起卡。`fake.gate.waiting` 是正卡在门上的请求数，截图前等它大于 0，画面才停在确定的那一步。

| 名称 | 检查 | 单跑时截图停在 | 用夹具模型 |
|---|---|---|---|
| `write-latency` | 在渲染进程里计时：点击写作此章弹窗的「开始创作」到 AI 输出标题可见，写进 `measured.writeToOutputMs` | 写作完成 | 是 |
| `nav-switch-project` | 角色视图加沉浸写作时从标题栏切换到另一部作品，断言退出沉浸、侧栏显示项目树 | 新作品的小说配置页 | 否 |
| `nav-toast-open` | 写作完成后把右侧切到写作助手，点完成提示「打开查看」，断言 AI 输出重新出现 | AI 输出里的「第1章候选」 | 是 |
| `nav-status-capsule` | 卡住模型让写作停在运行中，切到写作助手后点状态栏任务胶囊，断言 AI 输出出现 | 运行中的 AI 输出 | 是 |
| `nav-settings-model` | 先从标题栏「备份」打开设置并关闭，再点状态栏模型，断言落在「AI 生成模型」 | 设置弹窗的模型分组 | 是 |
| `nav-kb-import` | 关掉底部面板后在「小说」视图导入创作资料并确认发送，断言底部面板打开且停在「任务」 | 知识库页与任务面板 | 是 |
| `nav-card-import` | 关掉底部面板后在「角色」视图粘贴角色卡并确认发送，断言底部面板打开且停在「任务」 | 角色页与任务面板 | 是 |
| `nav-batch` | 关掉底部面板后从章节蓝图启动 1 章批量创作，断言底部面板打开且停在「任务」 | 批量创作运行中 | 是 |
| `nav-home-import` | 回到首页，点「小说拆解」把参考小说导入当前作品，连嵌入一起卡住模型，断言离开首页、项目树与 AI 输出出现 | 项目树刷新完成，第 1 步「导入参考文本与构建知识库」卡在第一个嵌入请求上 | 是 |
| `settings-appearance` | 旧外壳打开设置并切到「外观」。head 比 trunk 多「界面布局」一组，两边截图不同是预期 | 设置的外观分区 | 否 |
| `nav-immersive-twice` | 关掉底部面板后两次切换沉浸写作，断言三块面板恢复到切换前 | 恢复后的工作台 | 否 |
| `nav-plot-blueprint-source` | 生成剧情树（假模型回复不是 JSON，落到按蓝图的确定性剧情树），从事件来源打开第 1、2 章蓝图；第 1 章标题改了不保存，断言切换选中后改动仍在，手动选第 2 章后再点第 1 章来源会重新选中第 1 章 | 章节蓝图选中第 1 章、标题有未保存改动 | 是 |

`nav-` 场景对 trunk（`--app-root`）与 head 各跑一次，两边都通过即行为一致。`write-latency` 与 `startup-timing` 一样交替各跑 5 次取中位数。

## 新外壳（RD-3 起）

页面对象在 `scripts/redesign/pages/stage.mjs`，选择器用角色与可访问名称（流程脊是 `navigation`「创作流程」，章节是其中的列表「章节」，标签条是 `tablist`「已打开的页面」，顶栏是 `banner`）。示例作品在 `scripts/redesign/stage-sample.mjs`：「灯塔」12 章全有蓝图，架构四节齐全，1、2 章定稿，3 章已审稿，4 章草稿，其余待写；与旧外壳基线的 SAMPLE 分开，基线截图不受影响。打开后落在第 3 章（第一章写到一半的）。两种外壳都能用这份示例：新外壳从书房打开，旧外壳从项目树打开第 3 章草稿。

| 名称 | 检查 | 截图停在 | 夹具模型 | 对应计划 |
|---|---|---|---|---|
| `stage-open-sample` | 流程脊四个阶段的状态（设定、架构、蓝图完成，正文进行中）、章节阶段、当前章为 3、只有一个标签时标签条收起、外壳文字对比度（名称 4.5:1，说明 3:1，底色沿祖先叠加求出） | 第 3 章正文 | 否 | lane 1 的新外壳部分、lane 2（浅色）、lane 3（`--theme dark`） |
| `stage-tabs` | 依次打开设定与蓝图共三个标签，关掉一个后还剩两个且标签条仍在；`after` 再关一个，标签条收起 | 两个标签 | 否 | lane 4 |
| `stage-dirty-close` | 改设定页后关「设定」标签，出现危险确认；`after` 点「继续编辑」，标签与修改都在 | 危险确认对话框 | 否 | lane 5 |
| `stage-save` | 改小说配置，顶栏变「未保存」，Ctrl S 后变「已保存」 | 已保存 | 否 | lane 6 |
| `stage-find-chapter` | Ctrl P 输入「4」回车打开第 4 章，再输入「第3章」打开第 3 章，流程脊当前章随之变化 | 第 3 章正文 | 否 | lane 7 |
| `stage-focus` | 沉浸写作后流程脊与标签条消失，正文与章节动作条（AI 审稿等）在；`after` 按 Esc 恢复 | 沉浸写作 | 否 | lane 8 |
| `stage-1280` | 视口 1280×900：页面无横向滚动，外壳里的名称、章名、位置、搜索提示、保存状态都没有被截断或折行 | 1280 宽 | 否 | lane 9 |
| `stage-migrate` | 写入一份 v1 外观配置后重载：进入工作台、不出现启动阻塞，存储逐字节不变（只有选新外壳时才写成 v2） | 工作台（旧外壳，v1 没有 stage） | 否 | lane 10 |
| `stage-settings-switch` | 从旧外壳打开设置 → 外观 → 界面布局选「创作流程（预览）」，新外壳出现，设置仍停在「外观」 | 新外壳 | 否 | You see |
| `stage-palette` | Ctrl K 输入「灯」，结果里有第 6 章；`after` 按 Esc 关闭 | Ctrl K 结果 | 否 | |
| `stage-run` | 卡住模型后从章节蓝图写下一章：运行侧页自动打开，顶栏胶囊展开并显示进度；`after` 先确认侧页开着时 Ctrl K 仍能打开搜索（侧页不是模态层），再放行、等工作流完成、新草稿打开 | 运行侧页与胶囊 | 是 | |
| `stage-library` | 没有打开作品时是书房，没有流程脊 | 书房 | 否 | |
| `stage-modal-layers` | 改小说配置后打开设置：Ctrl K 不开搜索、Ctrl W 不弹放弃确认；从主进程关窗，退出确认画在设置之上（`isTopmost` 让所有元素参与命中测试后取中心点最上层元素）；`after` 取消退出并关设置 | 退出确认 | 否 | 第 3 条 |
| `stage-close-key` | 书房里、搜索框里各按一次 Ctrl W，页面都拦下（`defaultPrevented`），应用仍在。应用菜单有 CommandOrControl+W 的「关闭」，但驱动注入的按键到不了菜单快捷键，所以断言的是拦截 | 搜索框 | 否 | 第 4 条 |
| `stage-reopen` | 从作品菜单回到书房再打开同一部作品，再次落到第 3 章 | 第 3 章正文 | 否 | 第 8 条 |
| `stage-partial-blueprint` | 规划 100 章、只有 12 章蓝图：蓝图算完成，落点仍是第 3 章 | 第 3 章正文 | 否 | 第 6 条 |
| `stage-revert-after-final` | 第 1 章定稿后再建一份新草稿（版本历史「回退到此版本」的效果）：第 1 章成了最早写到一半的章，打开作品即落在它上面；章节列表按草稿显示，点它打开的是新草稿 | 第 1 章新草稿 | 否 | 第 7 条 |
| `stage-new-project` | 新外壳里新建作品：设定进行中、其余未开始；外壳文字对比度、进度环半径 8.5、设定说明在名字下一行、作品资料图标跟随行文字色 | 新作品首屏 | 否 | 第 20、23、24 条 |
| `stage-focus-search` | 沉浸写作里 Ctrl F 打开正文搜索，Esc 只关搜索框、不退出沉浸；`after` 再按 Esc 退出沉浸 | 沉浸写作 | 否 | 第 10 条 |
| `stage-tour` | 30–60 秒的导览：四个阶段、Ctrl K、Ctrl P、关标签、沉浸写作、写一章看运行胶囊与侧页。配 `--video` 录评审视频 | 写完一章 | 是 | Review gate |
| `chapter-switch` | 打开第 3 章后，从点击第 4 章到它的正文在编辑器里可见，渲染进程内按帧计时，写进 `measured.chapterSwitchMs`。旧外壳点草稿箱里的草稿，新外壳点流程脊里的章 | 第 4 章正文 | 否 | perf |

lane 1 的旧外壳部分：head 与 trunk 各跑一次 `baseline-all`，逐张 `pixel-diff.mjs`，`maxRatio` 小于 0.005。

perf：三组交替，各预热 2 次不计，再各计 5 次：trunk 旧外壳、head 旧外壳、head 新外壳。head 旧外壳对 trunk 旧外壳量的是新外壳模块被 `App.tsx` 静态引入后旧外壳用户付出的启动代价。

```bash
node scripts/redesign/drive.mjs --scenario startup-timing --app-root <trunk 工作树> --out <目录>
node scripts/redesign/drive.mjs --scenario startup-timing --out <目录>
node scripts/redesign/drive.mjs --scenario startup-timing --shell stage --out <目录>
node scripts/redesign/drive.mjs --scenario chapter-switch --app-root <trunk 工作树> --out <目录>
node scripts/redesign/drive.mjs --scenario chapter-switch --shell stage --out <目录>
```

`startup-timing` 三组都先在同一隔离目录启动一次写好主题（新外壳另写外壳偏好）再退出，计时的是之后那次冷启动；首次启动还要迁移旧配置、建库，与之后的启动不可比，所以两侧都不计首次。启动计时以驱动发现「新建作品」可见为准，Playwright 的轮询间隔随等待时间变长，所以晚出现的界面会被多计一些。

## 改外壳时

类名选择器只出现在 `scripts/redesign/pages/`，按任务域分文件：`shell`（启动、外壳就绪、标题栏、状态栏、左右栏与可收起面板）、`bookshelf`（书房）、`project`（项目树）、`chapter`（单章写作、审稿、修稿合并、定稿）、`run-panel`（运行面板）、`settings`（设置，含外观里切换界面布局）、`materials`（知识库与角色卡导入）、`stage`（新外壳：流程脊、章节列表、标签条、Ctrl K 与 Ctrl P、保存状态、沉浸写作）。`shell.waitForShell` 对两种外壳都成立。外壳替换后只改这些页面对象，场景 `scripts/redesign/scenarios.mjs` 不动。

`/.claude/` 在 `.gitignore` 里，提交本文件的改动要用 `git add -f .claude/skills/verify/SKILL.md`（或 `git add -u`）。假模型在 `scripts/redesign/fake-model.mjs`，按提示词特征返回正文、审稿 JSON、修稿正文或角色状态 JSON。
