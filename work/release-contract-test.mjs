import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const readme = read('README.md')
for (const requiredStep of ['install-from-github.ps1', 'install-from-github.sh', 'npm ci', 'npm run dev', 'npm run service:install', 'npm run service:status', 'chrome://extensions', 'edge://extensions']) {
  assert.ok(readme.includes(requiredStep), `README is missing ${requiredStep}`)
}
assert.match(readme, /让 AI 帮你安装/)
assert.match(readme, /```bash\nplainify_installer="\$\(mktemp -t plainify-install\)" &&/)
assert.match(readme, /api\.github\.com\/repos\/Joanna-Beauty\/Plainify\/contents\/install-from-github\.sh/)
assert.match(readme, /Accept: application\/vnd\.github\.raw\+json/)
assert.match(readme, /\/bin\/bash "\$plainify_installer"/)
assert.doesNotMatch(readme, /请帮我在这台 Mac 上安装/)
assert.match(readme, /```powershell\n& \{\n  \$ErrorActionPreference = 'Stop'/)
assert.match(readme, /api\.github\.com\/repos\/Joanna-Beauty\/Plainify\/contents\/install-from-github\.ps1/)
assert.match(readme, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \$plainifyInstaller/)
assert.match(readme, /Remove-Item \$plainifyInstaller -Force/)
assert.doesNotMatch(readme, /双击 `install-windows\.cmd`/)
assert.doesNotMatch(readme, /双击 `install\.command`/)

const githubInstallerPath = path.join(root, 'install-from-github.sh')
const githubInstaller = read('install-from-github.sh')
assert.ok((fs.statSync(githubInstallerPath).mode & 0o111) !== 0, 'install-from-github.sh must be executable')
execFileSync('bash', ['-n', githubInstallerPath])
assert.match(githubInstaller, /github\.com\/\$\{REPOSITORY\}\/archive\/refs\/heads\/main\.zip/)
assert.match(githubInstaller, /Applications\/Plainify/)
assert.match(githubInstaller, /PLAINIFY_NONINTERACTIVE=1 \/bin\/zsh/)
assert.match(githubInstaller, /install\.command/)
assert.doesNotMatch(githubInstaller, /\/Users\//)

const installerPath = path.join(root, 'install.command')
const installer = read('install.command')
assert.ok((fs.statSync(installerPath).mode & 0o111) !== 0, 'install.command must be executable')
assert.match(installer, /dirname "\$0"/)
assert.match(installer, /npm ci/)
assert.match(installer, /npm run service:install/)
assert.match(installer, /open "http:\/\/127\.0\.0\.1:5173\/"/)
assert.match(installer, /PLAINIFY_NONINTERACTIVE/)
assert.doesNotMatch(installer, /\/Users\//)

const windowsInstaller = read('install-windows.cmd')
assert.match(windowsInstaller, /%~dp0install-windows\.ps1/)
assert.match(windowsInstaller, /PLAINIFY_NONINTERACTIVE/)
const windowsGithubInstaller = read('install-from-github.ps1')
assert.match(windowsGithubInstaller, /github\.com\/\$repository\/archive\/refs\/heads\/main\.zip/)
assert.match(windowsGithubInstaller, /LOCALAPPDATA/)
assert.match(windowsGithubInstaller, /PLAINIFY_INSTALL_DIR/)
assert.match(windowsGithubInstaller, /install-windows\.ps1/)
assert.doesNotMatch(windowsGithubInstaller, /[A-Z]:\\Users\\/i)
const windowsInstallerScript = read('install-windows.ps1')
assert.match(windowsInstallerScript, /20\.19\.0/)
assert.match(windowsInstallerScript, /server\/install-service\.mjs/)
assert.match(windowsInstallerScript, /127\.0\.0\.1:8787\/api\/health/)
assert.match(windowsInstallerScript, /127\.0\.0\.1:5173/)
assert.doesNotMatch(windowsInstallerScript, /[A-Z]:\\Users\\/i)

const envExample = read('.env.example')
assert.match(envExample, /DEEPSEEK_API_KEY=sk-your-deepseek-key/)
assert.match(envExample, /OPENAI_API_KEY=sk-your-openai-key/)
assert.equal(envExample.includes('.env.local'), false)

const packageMetadata = JSON.parse(read('package.json'))
assert.equal(packageMetadata.license, 'MIT')
for (const [dependency, version] of Object.entries({
  ...packageMetadata.dependencies,
  ...packageMetadata.devDependencies,
})) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${dependency} must use an exact version`)
}
assert.match(read('LICENSE'), /^MIT License$/m)
assert.match(read('SECURITY.md'), /Private vulnerability reporting/)
assert.match(read('.github/workflows/ci.yml'), /npm run test:release/)
assert.match(read('.github/workflows/ci.yml'), /runs-on: windows-latest/)
assert.match(read('.github/workflows/ci.yml'), /npm run test:windows/)
assert.match(read('.github/workflows/ci.yml'), /node work\/model-config-test\.mjs/)
assert.match(read('.github/dependabot.yml'), /package-ecosystem: npm/)

if (fs.existsSync(path.join(root, '.git'))) {
  const ignoredPath = execFileSync('git', ['check-ignore', '.env.local'], { cwd: root, encoding: 'utf8' }).trim()
  assert.equal(ignoredPath, '.env.local')
  const trackedFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
  assert.equal(trackedFiles.includes('.env.local'), false)
} else {
  const ignorePatterns = read('.gitignore')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  assert.ok(ignorePatterns.includes('.env.local'), 'download archive must ignore .env.local')
}

const extensionArchive = path.join(root, 'outputs', 'plainify-extension.zip')
assert.ok(fs.existsSync(extensionArchive), 'release extension archive is required')
const archiveEntries = execFileSync('unzip', ['-Z1', extensionArchive], { encoding: 'utf8' })
assert.doesNotMatch(archiveEntries, /(^|\/)\.env(?:\.local)?$/m)
assert.doesNotMatch(archiveEntries, /(^|\/)(?:\.DS_Store|__MACOSX)(?:\/|$)/m)
const archivedContentScript = execFileSync('unzip', ['-p', extensionArchive, 'extension/content.js'], { encoding: 'utf8' })
assert.match(archivedContentScript, /closeButton\.title = '关闭解释栏'/)
assert.match(archivedContentScript, /archiveButton\.title = '归档术语'/)

const extensionContent = read('extension/content.js')
assert.match(extensionContent, /closeButton\.title = '关闭解释栏'/)
assert.match(extensionContent, /archiveButton\.title = '归档术语'/)
assert.match(extensionContent, /formatModelLabel\(modelInfo\).*正在生成/)
assert.match(extensionContent, /当前模型：.*formatModelLabel/)
assert.doesNotMatch(extensionContent, /DeepSeek 正在生成/)
const extensionPopup = read('extension/popup.js')
assert.match(extensionPopup, /activeModelLabel.*正在生成/)
assert.match(extensionPopup, /data\.model/)
const extensionManifest = JSON.parse(read('extension/manifest.json'))
const expectedExtensionIcons = {
  16: 'icons/icon-16.png',
  24: 'icons/icon-24.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
}
assert.deepEqual(extensionManifest.icons, expectedExtensionIcons)
assert.deepEqual(extensionManifest.action.default_icon, {
  16: expectedExtensionIcons[16],
  24: expectedExtensionIcons[24],
  32: expectedExtensionIcons[32],
})
for (const iconPath of Object.values(expectedExtensionIcons)) {
  assert.ok(fs.existsSync(path.join(root, 'extension', iconPath)), `扩展缺少图标 ${iconPath}`)
}
assert.equal(read('extension/icons/plainify.svg'), read('public/favicon.svg'))
assert.match(read('extension/popup.html'), /class="mark" src="icons\/plainify\.svg"/)
const archivedManifest = JSON.parse(execFileSync('unzip', ['-p', extensionArchive, 'extension/manifest.json'], { encoding: 'utf8' }))
assert.deepEqual(archivedManifest, extensionManifest)
for (const iconPath of Object.values(expectedExtensionIcons)) {
  assert.match(archiveEntries, new RegExp(`^extension/${iconPath}$`, 'm'))
}
const listFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
const extensionRoot = path.join(root, 'extension')
const sourceExtensionFiles = listFiles(extensionRoot)
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .sort()
const archivedExtensionFiles = archiveEntries
  .split(/\r?\n/)
  .filter((entry) => entry && !entry.endsWith('/'))
  .sort()
assert.deepEqual(archivedExtensionFiles, sourceExtensionFiles, 'extension archive file list must match extension source')
for (const sourceFile of sourceExtensionFiles) {
  assert.deepEqual(
    execFileSync('unzip', ['-p', extensionArchive, sourceFile]),
    fs.readFileSync(path.join(root, sourceFile)),
    `${sourceFile} in release archive must match extension source`,
  )
}
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
const appHeader = read('src/components/AppHeader.jsx')
const libraryPage = read('src/pages/LibraryPage.jsx')
const appStyles = read('src/styles.css')
assert.match(read('index.html'), /加简大白话 · Plainify｜用大白话，读懂复杂术语/)
assert.match(appHeader, /加简大白话 · Plainify｜用大白话，读懂复杂术语/)
assert.match(appHeader, /<span className="brand-title">加简大白话 · Plainify<\/span>/)
assert.match(appHeader, /<span className="brand-tagline">用大白话，读懂复杂术语<\/span>/)
assert.doesNotMatch(libraryPage, /你的个人术语库/)
assert.doesNotMatch(appStyles, /\.library-title/)
assert.match(appStyles, /\.brand-title \{[\s\S]*?font-size: var\(--font-size-heading-small\)/)
assert.match(appStyles, /\.settings-dialog \{[\s\S]*?width: min\(1120px, calc\(100vw - 64px\)\)/)
assert.match(appStyles, /\.settings-dialog \{[\s\S]*?height: min\(760px, calc\(100vh - 64px\)\)/)
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
const expectedFontFamily = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif'
const expectedBrandFontFamily = '"Songti SC", "Noto Serif SC", Georgia, serif'
const expectedTypeScale = ['12', '13', '14', '15', '16', '18', '20', '24', '30', '40']
const expectedWeights = ['400', '500', '600']
const expectedLineHeights = ['1', '1.3', '1.4', '1.6', '1.75']
for (const [surface, styles] of typographyStyles) {
  const fontFamily = styles
    .match(/--(?:plainify-)?font-family-sans:\s*([^;]+);/)?.[1]
    .replace(/\s*!important$/, '')
  const typeScale = [...styles.matchAll(/--(?:plainify-)?font-size-[\w-]+:\s*(\d+)px/g)]
    .map((match) => match[1])
  const weights = [...styles.matchAll(/--(?:plainify-)?font-weight-[\w-]+:\s*(\d+)/g)]
    .map((match) => match[1])
  const lineHeights = [...styles.matchAll(/--(?:plainify-)?line-height-[\w-]+:\s*([\d.]+)/g)]
    .map((match) => match[1])
  assert.equal(fontFamily, expectedFontFamily, `${surface}应使用统一的中文无衬线字体栈`)
  assert.deepEqual(typeScale, expectedTypeScale, `${surface}应使用统一的 10 档字号`)
  assert.deepEqual(weights, expectedWeights, `${surface}应使用统一的 3 档字重`)
  assert.deepEqual(lineHeights, expectedLineHeights, `${surface}应使用统一的 5 档行高`)
  assert.doesNotMatch(styles, /--(?:plainify-)?font-family-(?:serif|latin)/, `${surface}不应引入额外界面字体`)
  assert.doesNotMatch(styles, /--(?:plainify-)?font-weight-bold/, `${surface}不应使用 700 字重`)
  assert.doesNotMatch(styles, /^\s*font-size:\s*\d/gm, `${surface}不应绕过字号 token`)
  assert.doesNotMatch(styles, /^\s*font-weight:\s*\d/gm, `${surface}不应绕过字重 token`)
  assert.doesNotMatch(styles, /^\s*line-height:\s*[\d.]+/gm, `${surface}不应绕过行高 token`)
  assert.doesNotMatch(styles, /^\s*font:\s*\d/gm, `${surface}不应通过 font 简写绕过排版 token`)
}
for (const [surface, styles] of typographyStyles.slice(0, 2)) {
  const brandFontFamily = styles.match(/--font-family-brand:\s*([^;]+);/)?.[1]
  assert.equal(brandFontFamily, expectedBrandFontFamily, `${surface}产品名应使用统一的品牌字体`)
}
const extensionContentStyles = typographyStyles[2][1]
assert.match(
  extensionContentStyles,
  /#baihuaben-tooltip \{[\s\S]*?font-size: var\(--plainify-font-size-body\)/,
  '网页悬停解释应使用正文级字号',
)
assert.match(
  extensionContentStyles,
  /#baihuaben-preview \{\n  position:[\s\S]*?font-size: var\(--plainify-font-size-body\)/,
  '网页选词解释预览应使用正文级字号',
)
assert.match(appStyles, /\.term-explanation \{[\s\S]*?font-size: var\(--font-size-body\)/)
assert.match(appStyles, /\.term-analogy \{[\s\S]*?font-size: var\(--font-size-body\)/)
assert.match(appStyles, /h1,[\s\S]*?strong,[\s\S]*?font-weight: var\(--font-weight-semibold\)/)
assert.match(appStyles, /\.app-identity \{[\s\S]*?font-family: var\(--font-family-brand\)/)
assert.match(appStyles, /\.brand-title \{[\s\S]*?font-size: var\(--font-size-heading-small\)/)
assert.match(appStyles, /\.brand-tagline \{[\s\S]*?font-size: var\(--font-size-heading-small\)/)
assert.match(appStyles, /@media \(max-width: 350px\) \{[\s\S]*?\.social-compact-label \{[\s\S]*?display: none/)
assert.match(read('extension/popup.css'), /body > header strong \{[\s\S]*?font-family: var\(--font-family-brand\)/)

console.log('PASS 根目录文档覆盖安装、启动和扩展安装步骤')
console.log('PASS macOS 一键安装从仓库位置解析路径并自动打开网站')
console.log('PASS GitHub 提供可复制给 AI 的安装指令并支持自动下载项目')
console.log('PASS 配置模板仅含占位符，.env.local 被 Git 排除且不进入扩展包')
console.log('PASS 扩展生成提示显示后端当前提供方与具体模型，不再硬编码 DeepSeek')
console.log('PASS 扩展工具栏、管理页和弹窗标题使用与网站一致的 Logo')
console.log('PASS 首次上手动作、扩展说明、设置自动同步和需求登记入口符合发布约定')
console.log('PASS 首页品牌文案、简洁术语输入区和紧凑设置弹窗符合界面约定')
console.log('PASS 主站、扩展弹窗与网页解释层共享统一的字体、字号、字重和行高层级')
