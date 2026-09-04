import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { startApiServer } from './index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const portArgumentIndex = process.argv.findIndex((argument) => argument === '--port')
const inlinePortArgument = process.argv.find((argument) => argument.startsWith('--port='))
const requestedPort = portArgumentIndex >= 0
  ? process.argv[portArgumentIndex + 1]
  : inlinePortArgument?.slice('--port='.length)
const frontendPort = requestedPort === undefined ? 5173 : Number(requestedPort)

if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
  throw new Error(`无效的网站端口：${requestedPort}`)
}

const { host, port, server: apiServer } = await startApiServer()
let viteServer

try {
  viteServer = await createViteServer({
    root,
    server: {
      host: '127.0.0.1',
      port: frontendPort,
      strictPort: true,
    },
  })
  await viteServer.listen()
} catch (error) {
  apiServer.close()
  throw error
}

console.log(`加简大白话后端：http://${host}:${port}`)
viteServer.printUrls()

let isShuttingDown = false
async function shutdown(exitCode = 0) {
  if (isShuttingDown) return
  isShuttingDown = true

  await Promise.allSettled([
    viteServer.close(),
    new Promise((resolve) => apiServer.close(resolve)),
  ])
  process.exit(exitCode)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
