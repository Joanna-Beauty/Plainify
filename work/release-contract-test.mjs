import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const readme = read('README.md')
for (const requiredStep of ['npm ci', 'npm run dev', 'npm run service:install', 'chrome://extensions', 'edge://extensions']) {
  assert.ok(readme.includes(requiredStep), `README is missing ${requiredStep}`)
}

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

assert.match(read('extension/content.js'), /closeButton\.title = '关闭解释栏'/)
assert.match(read('extension/content.js'), /archiveButton\.title = '归档术语'/)
const settingsPage = read('src/pages/SettingsPage.jsx')
assert.match(settingsPage, /https:\/\/my\.feishu\.cn\/share\/base\/form\/shrcnNIBOZIPMz8pMKyFIqZLtmb/)
assert.equal(settingsPage.includes('wechat-around-9-qr'), false)

console.log('PASS 根目录文档覆盖安装、启动和扩展安装步骤')
console.log('PASS 配置模板仅含占位符，.env.local 被 Git 排除且不进入扩展包')
console.log('PASS 扩展操作提示和需求登记入口符合发布约定')
