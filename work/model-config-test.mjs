import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { getProvider, modelProviders, normalizeProviderSettings } from '../src/data/providers.js'

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

function reservePort() {
  const server = http.createServer()
  return listen(server).then(async (port) => {
    await close(server)
    return port
  })
}

function waitForServer(child, expectedText) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for restarted server: ${output}`)), 10_000)
    const collect = (chunk) => {
      output += chunk.toString()
      if (!output.includes(expectedText)) return
      clearTimeout(timer)
      resolve()
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Restarted server exited with ${code}: ${output}`))
    })
  })
}

let providerRequestCount = 0
const completionModels = []
const completionBodies = []
const fakeProvider = http.createServer(async (request, response) => {
  providerRequestCount += 1
  const authorized = new Set([
    'Bearer sk-isolated-openai-test',
    'Bearer sk-replacement-openai-next',
  ]).has(request.headers.authorization)
  response.setHeader('Content-Type', 'application/json')
  if (!authorized) {
    response.writeHead(401)
    response.end(JSON.stringify({ error: { message: 'invalid key' } }))
    return
  }
  if (request.url === '/v1/models') {
    response.end(JSON.stringify({
      data: [
        { id: 'text-embedding-3-small' },
        { id: 'gpt-4o-mini' },
        { id: 'gpt-4.1-mini' },
        { id: 'gpt-5.2' },
      ],
    }))
    return
  }
  if (request.url === '/v1/chat/completions') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    completionModels.push(body.model)
    completionBodies.push(body)
    response.end(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }))
    return
  }
  response.writeHead(404)
  response.end(JSON.stringify({ error: { message: 'not found' } }))
})

const providerPort = await listen(fakeProvider)
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'plainify-config-test-'))
const configPath = path.join(temporaryDirectory, '.env.local')
await fs.writeFile(configPath, '# keep this comment\nUNKNOWN_SETTING="keep-me"\n', { mode: 0o600 })

delete process.env.OPENAI_API_KEY
delete process.env.DEEPSEEK_API_KEY
process.env.PLAINIFY_AI_PROVIDER = 'deepseek'
process.env.PLAINIFY_AI_MODEL = 'deepseek-reasoner'
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1'

const { startApiServer } = await import(`../server/index.mjs?model-config-test=${Date.now()}`)
const { port, server } = await startApiServer({ port: 0, configPath })
const baseUrl = `http://127.0.0.1:${port}/api`
const websiteHeaders = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' }

assert.deepEqual(modelProviders.map((provider) => provider.id), ['deepseek', 'openai'])
const normalizedCatalogs = normalizeProviderSettings({
  provider: 'deepseek',
  model: 'deepseek-reasoner',
  modelCatalogs: { deepseek: ['deepseek-reasoner'] },
})
assert.deepEqual(normalizedCatalogs.modelCatalogs.deepseek, ['deepseek-reasoner'])
assert.deepEqual(normalizedCatalogs.modelCatalogs.openai, [])

try {
  const initial = await (await fetch(`${baseUrl}/ai/providers`, { headers: websiteHeaders })).json()
  assert.equal(initial.activeProvider, 'deepseek')
  assert.equal(initial.providers.find((provider) => provider.id === 'openai').configured, false)
  assert.equal(initial.providers.find((provider) => provider.id === 'openai').defaultBaseUrl, 'https://api.openai.com/v1')

  const requestsBeforePublicCatalog = providerRequestCount
  const publicCatalogResponse = await fetch(`${baseUrl}/ai/providers/openai/models`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({ baseUrl: 'https://api.openai.com/v1' }),
  })
  const publicCatalog = await publicCatalogResponse.json()
  assert.equal(publicCatalogResponse.status, 200)
  assert.equal(publicCatalog.configured, false)
  assert.equal(publicCatalog.models[0], 'gpt-4o-mini')
  assert.ok(publicCatalog.models.includes('gpt-4.1-mini'))
  assert.equal(providerRequestCount, requestsBeforePublicCatalog)

  const missingKeyResponse = await fetch(`${baseUrl}/ai/providers/openai/credentials`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${providerPort}/v1` }),
  })
  assert.equal(missingKeyResponse.status, 400)
  assert.equal((await missingKeyResponse.json()).code, 'invalid_api_key')

  const discoveredResponse = await fetch(`${baseUrl}/ai/providers/openai/models`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({
      apiKey: 'sk-isolated-openai-test',
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
    }),
  })
  const discovered = await discoveredResponse.json()
  assert.equal(discoveredResponse.status, 200)
  assert.deepEqual(discovered.models, ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5.2'])
  assert.equal(discovered.baseUrl, `http://127.0.0.1:${providerPort}/v1`)

  const savedResponse = await fetch(`${baseUrl}/ai/providers/openai/credentials`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({
      apiKey: 'sk-isolated-openai-test',
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
    }),
  })
  const saved = await savedResponse.json()
  assert.equal(savedResponse.status, 200)
  assert.equal(saved.provider.configured, true)
  assert.equal(saved.provider.keyLastFour, 'test')
  assert.equal(saved.provider.customBaseUrl, `http://127.0.0.1:${providerPort}/v1`)
  assert.equal(saved.activeModel, 'gpt-4o-mini')
  assert.deepEqual(saved.models, ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5.2'])
  assert.equal(JSON.stringify(saved).includes('sk-isolated-openai-test'), false)
  assert.equal(completionModels.at(-1), 'gpt-4o-mini')

  const rejectedModelResponse = await fetch(`${baseUrl}/ai/providers/openai/credentials`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({
      apiKey: 'sk-replacement-openai-next',
      model: 'gpt-not-returned',
    }),
  })
  const rejectedModel = await rejectedModelResponse.json()
  assert.equal(rejectedModelResponse.status, 400)
  assert.equal(rejectedModel.code, 'openai_model_not_available')
  assert.equal((await fs.readFile(configPath, 'utf8')).includes('sk-replacement-openai-next'), false)

  const replacedResponse = await fetch(`${baseUrl}/ai/providers/openai/credentials`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({ apiKey: 'sk-replacement-openai-next' }),
  })
  const replaced = await replacedResponse.json()
  assert.equal(replacedResponse.status, 200)
  assert.equal(replaced.provider.keyLastFour, 'next')
  assert.equal(JSON.stringify(replaced).includes('sk-replacement-openai-next'), false)

  const activated = await (await fetch(`${baseUrl}/ai/active`, {
    method: 'PUT',
    headers: websiteHeaders,
    body: JSON.stringify({ provider: 'openai', model: 'gpt-5.2' }),
  })).json()
  assert.equal(activated.activeModel, 'gpt-5.2')
  assert.equal(completionModels.at(-1), 'gpt-5.2')
  assert.equal(Object.hasOwn(completionBodies.at(-1), 'temperature'), false)

  const activeModelHealth = await (await fetch(`${baseUrl}/health?probe=1`)).json()
  assert.equal(activeModelHealth.ready, true)
  assert.equal(completionModels.at(-1), 'gpt-5.2')
  assert.equal(Object.hasOwn(completionBodies.at(-1), 'temperature'), false)

  const restored = await (await fetch(`${baseUrl}/ai/active`, {
    method: 'PUT',
    headers: websiteHeaders,
    body: JSON.stringify({ provider: 'openai', model: getProvider('openai').defaultModel }),
  })).json()
  assert.equal(restored.activeModel, 'gpt-4o-mini')

  const configAfterSave = await fs.readFile(configPath, 'utf8')
  assert.match(configAfterSave, /# keep this comment/)
  assert.match(configAfterSave, /UNKNOWN_SETTING="keep-me"/)
  assert.equal(configAfterSave.includes('sk-isolated-openai-test'), false)
  assert.match(configAfterSave, /OPENAI_API_KEY="sk-replacement-openai-next"/)
  assert.match(configAfterSave, new RegExp(`OPENAI_BASE_URL="http://127\\.0\\.0\\.1:${providerPort}/v1"`))
  assert.match(configAfterSave, /PLAINIFY_AI_PROVIDER="openai"/)
  assert.match(configAfterSave, /PLAINIFY_AI_MODEL="gpt-4o-mini"/)
  assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600)

  const restartedPort = await reservePort()
  const restarted = spawn(process.execPath, ['--env-file', configPath, 'server/index.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, BAIHUABEN_API_PORT: String(restartedPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForServer(restarted, `http://127.0.0.1:${restartedPort}`)
    const restartedOverview = await (await fetch(`http://127.0.0.1:${restartedPort}/api/ai/providers`, {
      headers: websiteHeaders,
    })).json()
    assert.equal(restartedOverview.activeProvider, 'openai')
    assert.equal(restartedOverview.providers.find((provider) => provider.id === 'openai').configured, true)
    assert.equal(restartedOverview.providers.find((provider) => provider.id === 'openai').keyLastFour, 'next')
    assert.equal(
      restartedOverview.providers.find((provider) => provider.id === 'openai').customBaseUrl,
      `http://127.0.0.1:${providerPort}/v1`,
    )
  } finally {
    restarted.kill('SIGTERM')
    await new Promise((resolve) => restarted.once('exit', resolve))
  }

  const testResponse = await fetch(`${baseUrl}/ai/providers/openai/test`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({ model: 'gpt-4o-mini' }),
  })
  assert.equal(testResponse.status, 200)

  const forbidden = await fetch(`${baseUrl}/ai/providers/openai/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    body: JSON.stringify({ apiKey: 'sk-should-not-be-written' }),
  })
  assert.equal(forbidden.status, 403)
  assert.equal((await fs.readFile(configPath, 'utf8')).includes('sk-should-not-be-written'), false)

  const deletedResponse = await fetch(`${baseUrl}/ai/providers/openai/credentials`, {
    method: 'DELETE',
    headers: websiteHeaders,
  })
  assert.equal(deletedResponse.status, 200)
  const configAfterDelete = await fs.readFile(configPath, 'utf8')
  assert.equal(configAfterDelete.includes('OPENAI_API_KEY'), false)
  assert.equal(configAfterDelete.includes('OPENAI_BASE_URL'), false)
  assert.match(configAfterDelete, /UNKNOWN_SETTING="keep-me"/)
  const overviewAfterDelete = await (await fetch(`${baseUrl}/ai/providers`, { headers: websiteHeaders })).json()
  assert.equal(overviewAfterDelete.providers.find((provider) => provider.id === 'openai').configured, false)
  const providerRequestsBeforeDeletedTest = providerRequestCount
  const testAfterDelete = await fetch(`${baseUrl}/ai/providers/openai/test`, {
    method: 'POST',
    headers: websiteHeaders,
    body: JSON.stringify({ model: 'gpt-4o-mini' }),
  })
  assert.equal(testAfterDelete.status, 503)
  assert.equal((await testAfterDelete.json()).code, 'backend_not_configured')
  assert.equal(providerRequestCount, providerRequestsBeforeDeletedTest)

  console.log('PASS 新增提供方必须填写 API Key，验证后原子写入隔离配置文件')
  console.log('PASS 未填写 Key 可读取官方预置模型，自定义地址与临时 Key 优先用于动态发现')
  console.log('PASS OpenAI 模型列表动态获取并过滤非对话模型')
  console.log('PASS 保存、切换和健康检查都验证当前选定模型')
  console.log('PASS 提供方仅保留 DeepSeek/OpenAI，恢复模型使用适配器默认值')
  console.log('PASS API 响应不回传完整 Key，扩展来源不能修改配置')
  console.log('PASS Key 可替换、按 0600 权限保存并在后端重启后恢复')
  console.log('PASS 删除 Key 时同步移除自定义地址，保留未知字段并停止调用对应提供方')
} finally {
  await close(server)
  await close(fakeProvider)
  await fs.rm(temporaryDirectory, { recursive: true })
}
