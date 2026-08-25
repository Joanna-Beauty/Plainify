import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startApiServer } from './index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { host, port, server } = await startApiServer()
console.log(`白话本后端：http://${host}:${port}`)

const vite = spawn(path.join(root, 'node_modules', '.bin', 'vite'), [
  '--host',
  '127.0.0.1',
  ...process.argv.slice(2),
], {
  cwd: root,
  stdio: 'inherit',
})

function shutdown(signal) {
  vite.kill(signal)
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
vite.on('exit', (code) => server.close(() => process.exit(code ?? 0)))
