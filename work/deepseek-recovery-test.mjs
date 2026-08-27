import assert from 'node:assert/strict'
import http from 'node:http'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function waitFor(check, timeoutMs = 2_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('等待 DeepSeek 自动恢复超时')
}

let completionRequests = 0
const fakeDeepSeek = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}

  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/v1/models') {
    response.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }))
    return
  }
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404)
    response.end(JSON.stringify({ error: { message: 'Not Found' } }))
    return
  }

  completionRequests += 1
  if (completionRequests === 1) {
    response.writeHead(402)
    response.end(JSON.stringify({
      error: {
        message: 'Insufficient Balance',
        type: 'unknown_error',
        code: 'invalid_request_error',
      },
    }))
    return
  }

  const isProbe = body.max_tokens === 1
  const content = isProbe
    ? '1'
    : JSON.stringify({ explanation: '自动恢复后的大白话解释', analogy: '像充值后电话自动恢复通话。' })
  response.end(JSON.stringify({ choices: [{ message: { content } }] }))
})

const fakePort = await listen(fakeDeepSeek)
process.env.DEEPSEEK_API_KEY = 'sk-isolated-recovery-test'
process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${fakePort}/v1`
process.env.DEEPSEEK_RECOVERY_DELAYS_MS = '20,40'

const { startApiServer } = await import(`../server/index.mjs?recovery-test=${Date.now()}`)
const { port, server } = await startApiServer({ port: 0 })
const apiBase = `http://127.0.0.1:${port}/api`

try {
  const failedResponse = await fetch(`${apiBase}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: 'Recovery probe', model: 'deepseek-chat' }),
  })
  const failed = await failedResponse.json()
  assert.equal(failedResponse.status, 503)
  assert.equal(failed.code, 'deepseek_insufficient_balance')
  assert.equal(failed.recoverable, true)
  assert.match(failed.error, /充值到账后.*自动恢复/)

  const recovered = await waitFor(async () => {
    const response = await fetch(`${apiBase}/health`)
    const data = await response.json()
    return data.ready ? data : null
  })
  assert.equal(recovered.providerStatus, 'ready')
  assert.equal(recovered.providerCode, 'deepseek_ready')

  const explanationResponse = await fetch(`${apiBase}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: 'Recovery probe', model: 'deepseek-chat' }),
  })
  const explanation = await explanationResponse.json()
  assert.equal(explanationResponse.status, 200)
  assert.equal(explanation.explanation, '自动恢复后的大白话解释')
  assert.ok(completionRequests >= 3)

  console.log('PASS 余额不足被识别为可恢复状态')
  console.log('PASS 充值到账后后端无需重启即可自动恢复连接')
  console.log('PASS 恢复后术语解释请求可以立即成功')
} finally {
  await close(server)
  await close(fakeDeepSeek)
}
