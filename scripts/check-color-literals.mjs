/* global process, console */
// 颜色只能来自一层令牌（design-system.md 第 6 条）。扫描 src/components 与纸墨样式目录里的十六进制、rgb、hsl 字面量。
// 旧外壳文件按精确路径记入允许清单，RD-10 删除旧外壳时清单随之清空；清单里的文件不再含字面量或已删除时检查也失败，逼清单只减不增。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCAN_ROOTS = Object.freeze(['src/components', 'src/styles/paper-ink'])
export const TOKEN_FILE = 'src/styles/paper-ink/tokens.css'
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])

export const COLOR_LITERAL_ALLOWLIST = Object.freeze([
  'src/components/dialogs/ArchitectureConfirmDialog.tsx',
  'src/components/dialogs/ChapterCreationDialog.tsx',
  'src/components/dialogs/ImportNovelDialog.tsx',
  'src/components/editor/ChapterCardEditor.tsx',
  'src/components/editor/CodeMirrorEditor.tsx',
  'src/components/editor/DraftEditor.tsx',
  'src/components/editor/NovelConfigEditor.tsx',
  'src/components/editor/RelationshipGraph.tsx',
  'src/components/editor/three-way-merge.css',
  'src/components/editor/WorldBuildingEditor.tsx',
  'src/components/layout/StatusBar.tsx',
  'src/components/pages/WelcomePage.tsx',
  'src/components/panels/agent/AgentHeader.tsx',
  'src/components/panels/agent/AgentInputBox.tsx',
  'src/components/panels/agent/AgentMessage.tsx',
  'src/components/panels/agent/MentionMenu.tsx',
  'src/components/panels/agent/SlashCommandMenu.tsx',
  'src/components/panels/AIOutputPanel.tsx',
  'src/components/panels/BottomPanel.tsx',
  'src/components/panels/sidebar/ProjectTree.tsx',
  'src/components/panels/WorkflowConfirmationPanel.tsx',
  'src/components/settings/SettingsModal.tsx',
  'src/components/ui/ActionToast.tsx',
  'src/components/ui/Dialog.tsx',
  'src/components/ui/MarkdownContent.tsx',
  'src/components/ui/PostProcessStatusPanel.tsx',
])

const COLOR_LITERAL = /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(/gi

const isTestFile = (relative) => relative.split('/').includes('__tests__') || relative.endsWith('.browser.tsx')

/** 去掉注释但保留换行，使行号不变；行注释只认行首或空白后的 //，以免误伤 URL。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

export function findColorLiterals(source) {
  return stripComments(source).split('\n').flatMap((text, index) =>
    [...text.matchAll(COLOR_LITERAL)].map((match) => ({ line: index + 1, literal: match[0] })))
}

function listScannedFiles(rootDir) {
  const files = []
  const walk = (relativeDir) => {
    const absolute = path.join(rootDir, relativeDir)
    if (!fs.existsSync(absolute)) return
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const relative = `${relativeDir}/${entry.name}`
      if (entry.isDirectory()) walk(relative)
      else if (SCANNED_EXTENSIONS.has(path.extname(entry.name)) && !isTestFile(relative) && relative !== TOKEN_FILE) files.push(relative)
    }
  }
  SCAN_ROOTS.forEach(walk)
  return files
}

export function checkColorLiterals(rootDir, allowlist = COLOR_LITERAL_ALLOWLIST) {
  const allowed = new Set(allowlist)
  const violations = []
  const withLiterals = new Set()
  for (const file of listScannedFiles(rootDir)) {
    const hits = findColorLiterals(fs.readFileSync(path.join(rootDir, file), 'utf8'))
    if (hits.length === 0) continue
    withLiterals.add(file)
    if (!allowed.has(file)) violations.push(...hits.map((hit) => ({ file, ...hit })))
  }
  const stale = allowlist.filter((file) => !withLiterals.has(file))
  return { violations, stale }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { violations, stale } = checkColorLiterals(rootDir)
  for (const { file, line, literal } of violations) {
    console.error(`${file}:${line} 颜色字面量 ${literal}：改用 ${TOKEN_FILE} 里的令牌（如 var(--ink)、var(--accent)）`)
  }
  for (const file of stale) {
    console.error(`${file} 已不含颜色字面量或已删除：从 scripts/check-color-literals.mjs 的允许清单里移除`)
  }
  if (violations.length > 0 || stale.length > 0) process.exit(1)
  console.log('check-color-literals: 通过')
}
