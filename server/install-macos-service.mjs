import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LABEL = 'com.baihuaben.local'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents')
const logsDir = path.join(root, '.logs')
const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`)
const domain = `gui/${process.getuid()}`
const stableNodePath = '/opt/homebrew/bin/node'
const nodeExecutable = fs.existsSync(stableNodePath) ? stableNodePath : process.execPath

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function run(args, options = {}) {
  return spawnSync('launchctl', args, { encoding: 'utf8', ...options })
}

fs.mkdirSync(launchAgentsDir, { recursive: true })
fs.mkdirSync(logsDir, { recursive: true })

const searchPath = [
  path.dirname(nodeExecutable),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
].filter((entry, index, entries) => entries.indexOf(entry) === index).join(':')

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodeExecutable)}</string>
    <string>--env-file-if-exists=.env.local</string>
    <string>${xml(path.join(root, 'server', 'dev.mjs'))}</string>
    <string>--port</string>
    <string>5173</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BAIHUABEN_SERVICE_MODE</key>
    <string>1</string>
    <key>PATH</key>
    <string>${xml(searchPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(path.join(logsDir, 'service.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(logsDir, 'service-error.log'))}</string>
</dict>
</plist>
`

fs.writeFileSync(plistPath, plist, { mode: 0o644 })
run(['bootout', domain, plistPath])
const bootstrap = run(['bootstrap', domain, plistPath])
if (bootstrap.status !== 0) {
  process.stderr.write(bootstrap.stderr || bootstrap.stdout || '无法安装加简大白话常驻服务\n')
  process.exit(bootstrap.status || 1)
}

const kickstart = run(['kickstart', '-k', `${domain}/${LABEL}`])
if (kickstart.status !== 0) {
  process.stderr.write(kickstart.stderr || kickstart.stdout || '无法启动加简大白话常驻服务\n')
  process.exit(kickstart.status || 1)
}

console.log(`加简大白话常驻服务已安装：${plistPath}`)
console.log('网站：http://127.0.0.1:5173/')
console.log('后端：http://127.0.0.1:8787/api/health')
