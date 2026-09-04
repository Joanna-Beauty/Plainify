import { spawnSync } from 'node:child_process'

if (process.platform === 'darwin') {
  await import('./install-macos-service.mjs')
} else if (process.platform === 'win32') {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'server/install-windows-service.ps1',
    ...process.argv.slice(2),
  ], { stdio: 'inherit' })

  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} else {
  console.error('常驻服务安装目前支持 macOS 和 Windows；Linux 请运行 npm run dev。')
  process.exit(1)
}
