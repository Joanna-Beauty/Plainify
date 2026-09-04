import { spawnSync } from 'node:child_process'

let command
let args

if (process.platform === 'darwin') {
  command = 'launchctl'
  args = ['print', `gui/${process.getuid()}/com.baihuaben.local`]
} else if (process.platform === 'win32') {
  command = 'powershell.exe'
  args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'server/status-windows-service.ps1',
  ]
} else {
  console.error('常驻服务状态检查目前支持 macOS 和 Windows；Linux 请检查 npm run dev 所在终端。')
  process.exit(1)
}

const result = spawnSync(command, args, { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
