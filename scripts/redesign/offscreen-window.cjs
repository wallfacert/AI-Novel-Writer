// drive.mjs 以 `electron -r` 预加载本文件，先于应用主进程脚本运行，每个窗口创建时监听都已就位。
const { app, screen } = require('electron')

const timing = globalThis.__driveTiming = { readyToShow: null }

app.on('browser-window-created', (_, window) => {
  window.once('ready-to-show', () => { timing.readyToShow ??= Date.now() })
  // 应用用默认 show: true 建窗，构造时已显示并可能已激活：移出全部显示器、去掉任务栏按钮、禁止再激活并交还焦点。
  const right = Math.max(...screen.getAllDisplays().map(({ bounds }) => bounds.x + bounds.width))
  window.setSkipTaskbar(true)
  window.setPosition(right + 200, 0)
  window.setFocusable(false)
  window.blur()
})
