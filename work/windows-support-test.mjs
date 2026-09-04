import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const packageMetadata = JSON.parse(read('package.json'))
assert.equal(packageMetadata.scripts['service:install'], 'node server/install-service.mjs')
assert.equal(packageMetadata.scripts['service:status'], 'node server/status-service.mjs')

const devServer = read('server/dev.mjs')
assert.match(devServer, /createServer as createViteServer/)
assert.doesNotMatch(devServer, /node_modules.*\.bin.*vite/)
assert.match(devServer, /strictPort: true/)

const installer = read('install-windows.cmd')
assert.match(installer, /%~dp0install-windows\.ps1/)
assert.match(installer, /PLAINIFY_NONINTERACTIVE/)

const githubInstaller = read('install-from-github.ps1')
assert.match(githubInstaller, /archive\/refs\/heads\/main\.zip/)
assert.match(githubInstaller, /LOCALAPPDATA/)
assert.match(githubInstaller, /PLAINIFY_INSTALL_DIR/)
assert.match(githubInstaller, /install-windows\.ps1/)
assert.match(githubInstaller, /not a complete Plainify project/)

const serviceInstaller = read('server/install-windows-service.ps1')
assert.match(serviceInstaller, /CurrentVersion\\Run/)
assert.match(serviceInstaller, /run-windows-service\.ps1/)
assert.match(serviceInstaller, /-WindowStyle', 'Hidden'/)

const serviceRunner = read('server/run-windows-service.ps1')
assert.match(serviceRunner, /while \(\$true\)/)
assert.match(serviceRunner, /service-error\.log/)
assert.match(serviceRunner, /windows-service\.json/)

const backend = read('server/index.mjs')
assert.match(backend, /whoami\.exe/)
assert.match(backend, /icacls\.exe/)
assert.match(backend, /\/inheritance:r/)

console.log('PASS Windows installer, login auto-start, restart runner, status command, and private config ACL are present')

if (process.platform !== 'win32') {
  console.log('SKIP Windows runtime smoke test on non-Windows platform')
  process.exit(0)
}

const githubInstallerDryRun = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  'install-from-github.ps1',
  '-DryRun',
], {
  cwd: root,
  encoding: 'utf8',
})
assert.equal(githubInstallerDryRun.status, 0, githubInstallerDryRun.stderr || githubInstallerDryRun.stdout)
assert.match(githubInstallerDryRun.stdout, /PASS Windows GitHub installer dry run/)

const dryRun = spawnSync(process.execPath, ['server/install-service.mjs', '-DryRun'], {
  cwd: root,
  encoding: 'utf8',
})
assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout)
assert.match(dryRun.stdout, /PASS Windows service installer dry run/)

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForUrl(url, child, output) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Development server exited early with code ${child.exitCode}.\n${output.join('')}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // The service may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}.\n${output.join('')}`)
}

const frontendPort = await availablePort()
const backendPort = await availablePort()
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainify-windows-'))
const output = []
const child = spawn(process.execPath, ['server/dev.mjs', '--port', String(frontendPort)], {
  cwd: root,
  env: {
    ...process.env,
    BAIHUABEN_API_PORT: String(backendPort),
    BAIHUABEN_ENV_FILE: path.join(temporaryDirectory, '.env.local'),
    BAIHUABEN_SERVICE_MODE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
child.stdout.on('data', (chunk) => output.push(chunk.toString()))
child.stderr.on('data', (chunk) => output.push(chunk.toString()))

try {
  const apiResponse = await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, child, output)
  const apiHealth = await apiResponse.json()
  assert.equal(apiHealth.ok, true)

  const websiteResponse = await waitForUrl(`http://127.0.0.1:${frontendPort}/`, child, output)
  assert.match(await websiteResponse.text(), /加简大白话/)
  console.log('PASS Windows starts the backend and website through the cross-platform development server')
} finally {
  child.kill()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
