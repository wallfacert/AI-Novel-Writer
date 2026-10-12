import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, it, vi } from 'vitest'
vi.mock('playwright', () => ({ _electron: { launch: () => { throw new Error('UNIT_TEST_MUST_NOT_LAUNCH_ELECTRON') } } }))
import { createIsolatedRoots, isolatedEnvironment, parseArgs } from '../drive.mjs'
import { BASELINE_SESSIONS, SCENARIOS } from '../scenarios.mjs'

const parents = []
afterEach(() => { for (const parent of parents.splice(0)) fs.rmSync(parent, { recursive: true, force: true }) })
const tempParent = () => { const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-args-')); parents.push(parent); return parent }

it('pnpm 透传的 -- 与全部参数都能解析', () => {
  const options = parseArgs(['--', '--scenario', 'baseline-all', '--theme', 'dark', '--out', 'shots/x', '--dump-dom', '--console', '--app-root', '../trunk'])
  assert.equal(options.scenario, 'baseline-all')
  assert.equal(options.theme, 'dark')
  assert.equal(options.out, path.resolve('shots/x'))
  assert.equal(options.appRoot, path.resolve('../trunk'))
  assert.equal(options.dumpDom, true)
  assert.equal(options.console, true)
})

it('默认浅色、诊断关闭、输出到 .runtime/redesign-baseline', () => {
  const options = parseArgs(['--scenario', 'settings'])
  assert.equal(options.theme, 'light')
  assert.equal(options.dumpDom, false)
  assert.equal(options.console, false)
  assert.equal(path.basename(path.dirname(options.out)), '.runtime')
  assert.equal(path.basename(options.out), 'redesign-baseline')
})

it('拒绝缺失或未知的场景、主题与参数', () => {
  assert.throws(() => parseArgs([]), /未知或缺少场景/)
  assert.throws(() => parseArgs(['--scenario', 'nope']), /未知或缺少场景 nope/)
  assert.throws(() => parseArgs(['--scenario', 'settings', '--theme', 'paper']), /--theme 只接受 light\|dark/)
  assert.throws(() => parseArgs(['--scenario', '--theme', 'dark']), /--scenario 缺少取值/)
  assert.throws(() => parseArgs(['--scenario', 'settings', '--headless']), /未知参数 --headless/)
})

it('每次运行得到 parent 下全新的隔离根，canonical 留给应用自己创建', () => {
  const parent = tempParent()
  const first = createIsolatedRoots(parent)
  const second = createIsolatedRoots(parent)
  assert.notEqual(first.root, second.root)
  assert.equal(path.dirname(first.root), parent)
  for (const [name, directory] of Object.entries(first)) {
    if (name === 'root') continue
    assert.equal(path.dirname(directory), first.root, `${name} 不在隔离根内`)
    assert.equal(fs.existsSync(directory), name !== 'canonical', `${name} 创建状态不对`)
  }
})

it('子进程环境的全部可写根都指向隔离目录', () => {
  const roots = createIsolatedRoots(tempParent())
  const env = isolatedEnvironment(roots, { PATH: 'p', APPDATA: 'C:/real', ELECTRON_RUN_AS_NODE: '1',
    VITE_DEV_SERVER_URL: 'http://x', AI_NOVEL_SMOKE_OPEN_PROJECT: 'C:/real/project' })
  for (const name of ['AI_NOVEL_APP_DATA_HOME', 'AI_NOVEL_LEGACY_SOURCE_HOME', 'AI_NOVEL_VELA_HOME', 'HOME', 'USERPROFILE',
    'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
    assert.ok(env[name].startsWith(roots.root + path.sep), `${name} 越出隔离根: ${env[name]}`)
  }
  assert.equal(env.PATH, 'p')
  for (const name of ['ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL', 'AI_NOVEL_SMOKE_OPEN_PROJECT']) assert.equal(env[name], undefined)
})

it('baseline-all 的会话恰好覆盖每个场景一次', () => {
  assert.deepEqual(Object.values(BASELINE_SESSIONS).flat().sort(), Object.keys(SCENARIOS).sort())
})
