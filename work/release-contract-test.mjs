import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const readme = read('README.md')
for (const requiredStep of ['install.command', 'npm ci', 'npm run dev', 'npm run service:install', 'chrome://extensions', 'edge://extensions']) {
  assert.ok(readme.includes(requiredStep), `README is missing ${requiredStep}`)
}

const installerPath = path.join(root, 'install.command')
const installer = read('install.command')
assert.ok((fs.statSync(installerPath).mode & 0o111) !== 0, 'install.command must be executable')
assert.match(installer, /dirname "\$0"/)
assert.match(installer, /npm ci/)
assert.match(installer, /npm run service:install/)
assert.match(installer, /open "http:\/\/127\.0\.0\.1:5173\/"/)
assert.doesNotMatch(installer, /\/Users\//)

const envExample = read('.env.example')
assert.match(envExample, /DEEPSEEK_API_KEY=sk-your-deepseek-key/)
assert.match(envExample, /OPENAI_API_KEY=sk-your-openai-key/)
assert.equal(envExample.includes('.env.local'), false)

const ignoredPath = execFileSync('git', ['check-ignore', '.env.local'], { cwd: root, encoding: 'utf8' }).trim()
assert.equal(ignoredPath, '.env.local')
const trackedFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
assert.equal(trackedFiles.includes('.env.local'), false)

const extensionArchive = path.join(root, 'outputs', 'baihuaben-extension.zip')
if (fs.existsSync(extensionArchive)) {
  const archiveEntries = execFileSync('unzip', ['-Z1', extensionArchive], { encoding: 'utf8' })
  assert.doesNotMatch(archiveEntries, /(^|\/)\.env(?:\.local)?$/m)
  const archivedContentScript = execFileSync('unzip', ['-p', extensionArchive, 'extension/content.js'], { encoding: 'utf8' })
  assert.match(archivedContentScript, /closeButton\.title = '关闭解释栏'/)
  assert.match(archivedContentScript, /archiveButton\.title = '归档术语'/)
}

const extensionContent = read('extension/content.js')
assert.match(extensionContent, /closeButton\.title = '关闭解释栏'/)
assert.match(extensionContent, /archiveButton\.title = '归档术语'/)
assert.match(extensionContent, /formatModelLabel\(modelInfo\).*正在生成/)
assert.match(extensionContent, /当前模型：.*formatModelLabel/)
assert.doesNotMatch(extensionContent, /DeepSeek 正在生成/)
const extensionPopup = read('extension/popup.js')
assert.match(extensionPopup, /activeModelLabel.*正在生成/)
assert.match(extensionPopup, /data\.model/)
const settingsPage = read('src/pages/SettingsPage.jsx')
assert.match(settingsPage, /https:\/\/my\.feishu\.cn\/share\/base\/form\/shrcnNIBOZIPMz8pMKyFIqZLtmb/)
assert.equal(settingsPage.includes('wechat-around-9-qr'), false)
assert.equal(settingsPage.includes('同步到扩展'), false)
assert.equal(settingsPage.includes('onSyncExtension'), false)
assert.equal(settingsPage.includes('打开配置文件'), false)
assert.equal(settingsPage.includes('openLocalConfigFile'), false)
assert.equal(settingsPage.includes('segmented-control'), false)
assert.match(settingsPage, /name="hoverExplanationMode"/)
assert.match(settingsPage, /网页悬停卡片/)
const hoverModePositions = ['both', 'explanation', 'analogy']
  .map((mode) => settingsPage.indexOf(`value: '${mode}'`))
assert.deepEqual(
  [...hoverModePositions].sort((left, right) => left - right),
  hoverModePositions,
  '解释和类比应作为第一个网页悬停选项',
)
const generalSettingPositions = ['extension', 'capture', 'hover']
  .map((setting) => settingsPage.indexOf(`data-general-setting="${setting}"`))
assert.ok(generalSettingPositions.every((position) => position >= 0), '通用设置应包含三个独立卡片')
assert.deepEqual(
  [...generalSettingPositions].sort((left, right) => left - right),
  generalSettingPositions,
  '通用设置应按浏览器扩展、收录方式、网页悬停卡片排列',
)
assert.match(settingsPage, /获取 API Key/)
assert.match(settingsPage, /API Key 不会进入扩展/)
const app = read('src/App.jsx')
assert.match(app, /去连接模型/)
assert.match(app, /isModelSetupError/)
assert.equal(app.includes('onSyncExtension'), false)
assert.doesNotMatch(app, /设置已保存.*扩展/)
assert.doesNotMatch(app, /可以随时撤销/)
const aiService = read('src/services/ai.js')
const server = read('server/index.mjs')
assert.equal(aiService.includes('openLocalConfigFile'), false)
assert.equal(server.includes('/api/settings/open-config'), false)
assert.equal(server.includes('openConfigFile'), false)

const typographyStyles = [
  ['主站', read('src/styles.css')],
  ['扩展弹窗', read('extension/popup.css')],
  ['网页解释层', read('extension/content.css')],
]
const expectedTypeScale = ['11', '12', '13', '14', '16', '18', '20', '24', '30', '40']
const expectedWeights = ['400', '500', '600', '700']
const expectedLineHeights = ['1', '1.3', '1.4', '1.6', '1.75']
for (const [surface, styles] of typographyStyles) {
  const typeScale = [...styles.matchAll(/--(?:plainify-)?font-size-[\w-]+:\s*(\d+)px/g)]
    .map((match) => match[1])
  const weights = [...styles.matchAll(/--(?:plainify-)?font-weight-[\w-]+:\s*(\d+)/g)]
    .map((match) => match[1])
  const lineHeights = [...styles.matchAll(/--(?:plainify-)?line-height-[\w-]+:\s*([\d.]+)/g)]
    .map((match) => match[1])
  assert.deepEqual(typeScale, expectedTypeScale, `${surface}应使用统一的 10 档字号`)
  assert.deepEqual(weights, expectedWeights, `${surface}应使用统一的 4 档字重`)
  assert.deepEqual(lineHeights, expectedLineHeights, `${surface}应使用统一的 5 档行高`)
  assert.doesNotMatch(styles, /^\s*font-size:\s*\d/gm, `${surface}不应绕过字号 token`)
  assert.doesNotMatch(styles, /^\s*font-weight:\s*\d/gm, `${surface}不应绕过字重 token`)
  assert.doesNotMatch(styles, /^\s*line-height:\s*[\d.]+/gm, `${surface}不应绕过行高 token`)
  assert.doesNotMatch(styles, /^\s*font:\s*\d/gm, `${surface}不应通过 font 简写绕过排版 token`)
}

console.log('PASS 根目录文档覆盖安装、启动和扩展安装步骤')
console.log('PASS macOS 一键安装从仓库位置解析路径并自动打开网站')
console.log('PASS 配置模板仅含占位符，.env.local 被 Git 排除且不进入扩展包')
console.log('PASS 扩展生成提示显示后端当前提供方与具体模型，不再硬编码 DeepSeek')
console.log('PASS 首次上手动作、扩展说明、设置自动同步和需求登记入口符合发布约定')
console.log('PASS 主站与扩展共享统一的字号、字重和行高层级')
