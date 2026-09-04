import http from 'node:http'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrlEnvKey: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrlEnvKey: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    fallbackModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  },
  qwen: {
    id: 'qwen',
    name: '阿里云百炼',
    envKey: 'DASHSCOPE_API_KEY',
    baseUrlEnvKey: 'DASHSCOPE_BASE_URL',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    fallbackModels: ['qwen-plus', 'qwen3.8-max', 'qwen3.7-plus'],
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot AI',
    envKey: 'MOONSHOT_API_KEY',
    baseUrlEnvKey: 'MOONSHOT_BASE_URL',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    fallbackModels: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.5'],
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 AI',
    envKey: 'ZHIPU_API_KEY',
    baseUrlEnvKey: 'ZHIPU_BASE_URL',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3-flash',
    fallbackModels: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2'],
  },
}
const DEFAULT_PROVIDER = 'deepseek'
const MAX_BODY_BYTES = 128 * 1024
const LOCAL_WEB_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/i
const DEFAULT_RECOVERY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]
const PROBE_READY_CACHE_MS = 60_000
const PROBE_FAILURE_CACHE_MS = 2_000

function recoveryDelays() {
  const configured = String(process.env.DEEPSEEK_RECOVERY_DELAYS_MS || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 10)
  return configured.length ? configured : DEFAULT_RECOVERY_DELAYS_MS
}

const providerStates = Object.fromEntries(Object.values(PROVIDERS).map((provider) => [provider.id, {
  status: 'unknown',
  code: `${provider.id}_not_checked`,
  message: `正在检查 ${provider.name} 真实连接状态`,
  checkedAt: null,
  recoverable: true,
}]))
let recoveryTimer = null
let recoveryAttempt = 0
let nextRecoveryAt = 0
let providerProbePromise = null
let recoveryProviderId = DEFAULT_PROVIDER
let configFilePath = path.resolve(process.env.BAIHUABEN_ENV_FILE || '.env.local')
let configWriteQueue = Promise.resolve()

class ApiError extends Error {
  constructor(status, message, code = 'request_failed', options = {}) {
    super(message)
    this.status = status
    this.code = code
    this.recoverable = Boolean(options.recoverable)
    this.retryAfterMs = Number(options.retryAfterMs || 0)
  }
}

function remainingRecoveryDelay() {
  return nextRecoveryAt ? Math.max(0, nextRecoveryAt - Date.now()) : 0
}

function clearRecoverySchedule() {
  if (recoveryTimer) clearTimeout(recoveryTimer)
  recoveryTimer = null
  recoveryAttempt = 0
  nextRecoveryAt = 0
}

function providerDefinition(providerId) {
  const provider = PROVIDERS[String(providerId || '').toLowerCase()]
  if (!provider) throw new ApiError(400, '不支持这个模型服务商', 'unsupported_provider')
  return provider
}

function normalizeBaseUrl(value, fallback) {
  const rawValue = String(value || fallback || '').trim()
  let url
  try {
    url = new URL(rawValue)
  } catch {
    throw new ApiError(400, '请输入有效的 API 地址', 'invalid_base_url')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, 'API 地址必须是有效的 HTTP 或 HTTPS 地址', 'invalid_base_url')
  }
  return url.toString().replace(/\/$/, '')
}

function resolveBaseUrl(provider, override, hasOverride = false) {
  const configured = String(process.env[provider.baseUrlEnvKey] || '').trim()
  return normalizeBaseUrl(hasOverride ? override : configured, provider.defaultBaseUrl)
}

function activeProviderId() {
  const preferred = String(process.env.PLAINIFY_AI_PROVIDER || '').toLowerCase()
  if (PROVIDERS[preferred] && String(process.env[PROVIDERS[preferred].envKey] || '').trim()) return preferred
  const configured = Object.values(PROVIDERS).find((provider) => String(process.env[provider.envKey] || '').trim())
  return configured?.id || (PROVIDERS[preferred]?.id || DEFAULT_PROVIDER)
}

function setProviderReady(providerId, message = '') {
  const provider = providerDefinition(providerId)
  clearRecoverySchedule()
  providerStates[provider.id] = {
    status: 'ready',
    code: `${provider.id}_ready`,
    message: message || `${provider.name} 已连接，可以正常生成解释`,
    checkedAt: new Date().toISOString(),
    recoverable: false,
  }
}

function setProviderFailure(providerId, error) {
  const provider = providerDefinition(providerId)
  providerStates[provider.id] = {
    status: error.code === `${provider.id}_insufficient_balance`
      ? 'insufficient_balance'
      : error.code === `${provider.id}_rate_limited`
        ? 'rate_limited'
        : error.code === `${provider.id}_auth_failed`
          ? 'auth_failed'
          : 'temporarily_unavailable',
    code: error.code,
    message: error.message,
    checkedAt: new Date().toISOString(),
    recoverable: Boolean(error.recoverable),
  }
  if (error.recoverable) scheduleRecoveryProbe(provider.id)
  else clearRecoverySchedule()
}

function providerErrorDetails(text) {
  try {
    const parsed = JSON.parse(text)
    const detail = parsed?.error || parsed
    return {
      message: String(detail?.message || ''),
      code: String(detail?.code || ''),
      type: String(detail?.type || ''),
    }
  } catch {
    return { message: String(text || ''), code: '', type: '' }
  }
}

export function classifyDeepSeekFailure(status, text = '') {
  return classifyProviderFailure(PROVIDERS.deepseek, status, text)
}

function classifyProviderFailure(provider, status, text = '') {
  const detail = providerErrorDetails(text)
  const fingerprint = `${detail.message} ${detail.code} ${detail.type}`.toLowerCase()
  if (status === 402 || /(insufficient[ _-]*balance|balance[^a-z\u4e00-\u9fff]*insufficient|余额不足|账户余额)/i.test(fingerprint)) {
    return new ApiError(
      503,
      `${provider.name} 账户余额不足；充值到账后加简大白话会自动恢复连接`,
      `${provider.id}_insufficient_balance`,
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
  }
  if (status === 401 || status === 403) {
    return new ApiError(502, `${provider.name} API Key 无效或没有权限`, `${provider.id}_auth_failed`)
  }
  if (status === 429) {
    return new ApiError(
      503,
      `${provider.name} 请求过于频繁，加简大白话会稍后自动重试`,
      `${provider.id}_rate_limited`,
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
  }
  if (status >= 500 || status === 408) {
    return new ApiError(
      502,
      `${provider.name} 暂时不可用（${status}），加简大白话会自动重试`,
      `${provider.id}_temporarily_unavailable`,
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
  }
  return new ApiError(502, `${provider.name} 请求失败（${status}）`, `${provider.id}_request_failed`)
}

function normalizeModel(providerId, model) {
  const provider = providerDefinition(providerId)
  const value = String(model || '').trim().slice(0, 160)
  return value || provider.defaultModel
}

function allowedOrigin(request) {
  const origin = String(request.headers.origin || '')
  if (!origin) return ''
  return LOCAL_WEB_ORIGIN.test(origin) || EXTENSION_ORIGIN.test(origin) ? origin : null
}

function setCorsHeaders(response, origin) {
  if (!origin) return
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
}

function sendJson(response, status, payload, origin = '') {
  setCorsHeaders(response, origin)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new ApiError(413, '请求内容太大', 'body_too_large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiError(400, '请求不是有效的 JSON', 'invalid_json')
  }
}

function extractJson(content) {
  const cleaned = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new ApiError(502, '模型返回格式无法识别', 'invalid_model_response')
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new ApiError(502, '模型返回的 JSON 无法解析', 'invalid_model_response')
  }
}

function requireTerm(value) {
  const term = String(value || '').trim().replace(/\s+/g, ' ')
  if (!term) throw new ApiError(400, '请提供要解释的术语', 'missing_term')
  if (term.length > 120) throw new ApiError(400, '术语不能超过 120 个字符', 'term_too_long')
  return term
}

function getConfig(providerId = activeProviderId(), overrides = {}) {
  const provider = providerDefinition(providerId)
  const apiKey = String(overrides.apiKey || process.env[provider.envKey] || '').trim()
  const hasBaseUrlOverride = Object.hasOwn(overrides, 'baseUrl')
  const baseUrl = resolveBaseUrl(provider, overrides.baseUrl, hasBaseUrlOverride)
  const mock = process.env.BAIHUABEN_MOCK_AI === '1'
  return {
    provider,
    providerId: provider.id,
    apiKey,
    baseUrl,
    configured: Boolean(apiKey) || mock,
    mock,
  }
}

function requireConfig(providerId = activeProviderId()) {
  const config = getConfig(providerId)
  if (!config.configured) {
    throw new ApiError(503, `本机后端还没有配置 ${config.provider.name} API Key`, 'backend_not_configured')
  }
  return config
}

function currentProviderState(config = getConfig()) {
  if (!config.configured) {
    return {
      status: 'not_configured',
      code: 'backend_not_configured',
      message: `本机后端还没有配置 ${config.provider.name} API Key`,
      checkedAt: null,
      recoverable: false,
    }
  }
  if (config.mock) {
    return {
      status: 'ready',
      code: `${config.providerId}_ready`,
      message: '隔离测试服务已就绪',
      checkedAt: providerStates[config.providerId].checkedAt,
      recoverable: false,
    }
  }
  return providerStates[config.providerId]
}

function providerHealth(config = getConfig()) {
  const state = currentProviderState(config)
  return {
    configured: config.configured,
    ready: state.status === 'ready',
    providerStatus: state.status,
    providerCode: state.code,
    statusMessage: state.message,
    checkedAt: state.checkedAt,
    recoverable: state.recoverable,
    retryAfterMs: remainingRecoveryDelay(),
  }
}

function scheduleRecoveryProbe(providerId = activeProviderId()) {
  const state = providerStates[providerId]
  if (recoveryTimer || providerProbePromise || !state?.recoverable) return
  recoveryProviderId = providerId
  const delays = recoveryDelays()
  const delay = delays[Math.min(recoveryAttempt, delays.length - 1)]
  recoveryAttempt += 1
  nextRecoveryAt = Date.now() + delay
  recoveryTimer = setTimeout(async () => {
    recoveryTimer = null
    nextRecoveryAt = 0
    await probeProvider(recoveryProviderId, { force: true })
    if (providerStates[recoveryProviderId].recoverable) scheduleRecoveryProbe(recoveryProviderId)
  }, delay)
  recoveryTimer.unref?.()
}

async function requestProvider(pathname, init, config = requireConfig(), options = {}) {
  const updateState = options.updateState !== false
  if (config.mock) return null
  let response
  try {
    response = await fetch(`${config.baseUrl}${pathname}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(45000),
    })
  } catch (error) {
    const timedOut = error.name === 'TimeoutError'
    const apiError = new ApiError(
      502,
      timedOut ? `${config.provider.name} 请求超时，加简大白话会自动重试` : `无法连接 ${config.provider.name}，加简大白话会自动重试`,
      timedOut ? `${config.providerId}_timeout` : `${config.providerId}_unreachable`,
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
    if (updateState) setProviderFailure(config.providerId, apiError)
    throw apiError
  }

  const text = await response.text()
  if (!response.ok) {
    const apiError = classifyProviderFailure(config.provider, response.status, text)
    if (updateState) setProviderFailure(config.providerId, apiError)
    throw apiError
  }

  if (pathname === '/chat/completions' && updateState) setProviderReady(config.providerId)

  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(502, `${config.provider.name} 返回内容无法解析`, 'invalid_model_response')
  }
}

async function probeProvider(providerId = activeProviderId(), { force = false } = {}) {
  const config = getConfig(providerId)
  if (!config.configured) return currentProviderState(config)
  if (config.mock) {
    setProviderReady(providerId, '隔离测试服务已就绪')
    return currentProviderState(config)
  }
  if (providerProbePromise) return providerProbePromise

  const state = providerStates[providerId]
  const checkedAt = Date.parse(state.checkedAt || '')
  const cacheMs = state.status === 'ready' ? PROBE_READY_CACHE_MS : PROBE_FAILURE_CACHE_MS
  if (!force && Number.isFinite(checkedAt) && Date.now() - checkedAt < cacheMs) return state
  if (!force && state.status === 'auth_failed') return state

  providerProbePromise = (async () => {
    try {
      const model = providerId === activeProviderId()
        ? normalizeModel(providerId, process.env.PLAINIFY_AI_MODEL)
        : config.provider.defaultModel
      const body = {
        model,
        messages: [{ role: 'user', content: '只回复 1' }],
        max_tokens: 1,
      }
      if (!/^(?:o[134](?:-|$)|gpt-5)/i.test(model)) body.temperature = 0
      await requestProvider('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, config)
    } catch {
      // requestProvider records the detailed recoverable state.
    }
    return currentProviderState(config)
  })().finally(() => {
    providerProbePromise = null
    if (providerStates[providerId].recoverable) scheduleRecoveryProbe(providerId)
  })
  return providerProbePromise
}

async function requestCompletion(messages, model, maxTokens = 900, providerId = activeProviderId()) {
  const config = requireConfig(providerId)
  if (config.mock) {
    const prompt = String(messages.at(-1)?.content || '')
    if (prompt.includes('重新分组') || prompt.includes('增量归类')) {
      const match = prompt.match(/术语：(.+?)。返回格式/s)
      let items = []
      try { items = JSON.parse(match?.[1] || '[]') } catch { items = [] }
      return JSON.stringify({ assignments: items.map((item) => ({ id: item.id, category: '测试分组' })) })
    }
    if (prompt.includes('测试连接')) return '连接成功'
    return JSON.stringify({
      explanation: '这是隔离测试环境生成的大白话解释。',
      analogy: '像先看懂说明，再决定要不要记进笔记本。',
    })
  }

  const body = {
    model: normalizeModel(config.providerId, model),
    messages,
    max_tokens: maxTokens,
  }
  if (!/^(?:o[134](?:-|$)|gpt-5)/i.test(body.model)) body.temperature = 0.25
  const data = await requestProvider('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, config)
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new ApiError(502, `${config.provider.name} 没有返回内容`, 'empty_model_response')
  return content
}

function isUsableModel(providerId, modelId) {
  const blockedCapability = /(?:realtime|audio|transcribe|tts|image|vision|ocr|search|embedding|rerank|moderation|video|wan-|cosyvoice)/i
  if (blockedCapability.test(modelId)) return false
  if (providerId === 'openai') return /^(?:gpt-|chatgpt-|o[134](?:-|$))/i.test(modelId)
  if (providerId === 'qwen') return /^(?:qwen|deepseek|kimi|glm|minimax|baichuan|llama|mistral)/i.test(modelId)
  if (providerId === 'moonshot') return /^(?:kimi-|moonshot-)/i.test(modelId)
  if (providerId === 'zhipu') return /^glm-/i.test(modelId)
  return true
}

async function listProviderModels(config, options = {}) {
  if (!config.configured || config.mock) return config.provider.fallbackModels
  const data = await requestProvider('/models', { method: 'GET', headers: {} }, config, options)
  const models = Array.isArray(data.data)
    ? [...new Set(data.data
      .map((item) => String(item.id || '').trim())
      .filter((id) => id && isUsableModel(config.providerId, id)))]
    : []
  return models.sort((a, b) => {
    if (a === config.provider.defaultModel) return -1
    if (b === config.provider.defaultModel) return 1
    return a.localeCompare(b)
  })
}

function providerSummary(provider) {
  const apiKey = String(process.env[provider.envKey] || '').trim()
  const baseUrl = resolveBaseUrl(provider)
  return {
    id: provider.id,
    name: provider.name,
    configured: Boolean(apiKey) || process.env.BAIHUABEN_MOCK_AI === '1',
    keyLastFour: apiKey ? apiKey.slice(-4) : '',
    baseUrl,
    customBaseUrl: baseUrl === provider.defaultBaseUrl ? '' : baseUrl,
    defaultBaseUrl: provider.defaultBaseUrl,
    defaultModel: provider.defaultModel,
  }
}

function requireSettingsOrigin(origin) {
  if (origin && !LOCAL_WEB_ORIGIN.test(origin)) {
    throw new ApiError(403, '只有本机网站可以修改模型配置', 'settings_origin_not_allowed')
  }
}

function envLine(key, value) {
  if (/\r|\n/.test(value)) throw new ApiError(400, 'API Key 格式不正确', 'invalid_api_key')
  return `${key}=${JSON.stringify(value)}`
}

async function secureConfigFile(filePath) {
  if (process.platform !== 'win32') {
    await fs.chmod(filePath, 0o600)
    return
  }

  const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'ascii',
    windowsHide: true,
  }).match(/S-\d(?:-\d+)+/)?.[0]
  if (!identity) throw new Error('无法确认当前 Windows 用户，配置文件权限未修改')
  execFileSync('icacls.exe', [
    filePath,
    '/inheritance:r',
    '/grant:r',
    `*${identity}:(F)`,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
  })
}

async function persistConfigValues(updates) {
  const operation = async () => {
    let source = ''
    try {
      source = await fs.readFile(configFilePath, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }

    const pending = new Map(Object.entries(updates))
    const seen = new Set()
    const lines = source.split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line)
    const nextLines = []
    for (const line of lines) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)
      const key = match?.[1]
      if (!key || !pending.has(key)) {
        nextLines.push(line)
        continue
      }
      if (seen.has(key)) continue
      seen.add(key)
      const value = pending.get(key)
      if (value !== null) nextLines.push(envLine(key, String(value)))
    }
    for (const [key, value] of pending) {
      if (!seen.has(key) && value !== null) nextLines.push(envLine(key, String(value)))
    }

    const temporaryPath = `${configFilePath}.tmp-${process.pid}-${Date.now()}`
    try {
      await fs.writeFile(temporaryPath, `${nextLines.join('\n')}\n`, { mode: 0o600 })
      await secureConfigFile(temporaryPath)
      await fs.rename(temporaryPath, configFilePath)
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
      throw error
    }
    for (const [key, value] of pending) {
      if (value === null) delete process.env[key]
      else process.env[key] = String(value)
    }
  }
  const pending = configWriteQueue.then(operation, operation)
  configWriteQueue = pending.catch(() => {})
  return pending
}

async function saveCredential(providerId, input = {}) {
  const provider = providerDefinition(providerId)
  const secret = String(input.apiKey || process.env[provider.envKey] || '').trim()
  if (secret.length < 8 || secret.length > 512) {
    throw new ApiError(400, '请输入有效的 API Key', 'invalid_api_key')
  }
  const hasBaseUrl = Object.hasOwn(input, 'baseUrl')
  const candidate = getConfig(provider.id, {
    apiKey: secret,
    ...(hasBaseUrl ? { baseUrl: input.baseUrl } : {}),
  })
  const models = await listProviderModels(candidate, { updateState: false })
  const currentProviderModel = activeProviderId() === provider.id ? process.env.PLAINIFY_AI_MODEL : ''
  const selectedModel = normalizeModel(provider.id, input.model || currentProviderModel || provider.defaultModel)
  if (!models.includes(selectedModel)) {
    throw new ApiError(
      400,
      `当前 API 地址没有返回模型 ${selectedModel}，请先获取可用模型并选择一个`,
      `${provider.id}_model_not_available`,
    )
  }
  const hasOtherConfiguredProvider = Object.values(PROVIDERS).some((item) => (
    item.id !== provider.id && String(process.env[item.envKey] || '').trim()
  ))
  const shouldActivate = input.activate !== false || !hasOtherConfiguredProvider
  const updates = {
    [provider.envKey]: secret,
    ...(shouldActivate ? {
      PLAINIFY_AI_PROVIDER: provider.id,
      PLAINIFY_AI_MODEL: selectedModel,
    } : {}),
  }
  if (hasBaseUrl) {
    updates[provider.baseUrlEnvKey] = candidate.baseUrl === provider.defaultBaseUrl
      ? null
      : candidate.baseUrl
  }
  await persistConfigValues(updates)
  setProviderReady(provider.id, `${provider.name} 凭据与模型目录已验证`)
  const activeProvider = activeProviderId()
  const activeModel = activeProvider === provider.id
    ? selectedModel
    : normalizeModel(activeProvider, process.env.PLAINIFY_AI_MODEL)
  return {
    provider: providerSummary(provider),
    models,
    savedModel: selectedModel,
    activeProvider,
    activeModel,
  }
}

async function routeRequest(request, response, origin) {
  const url = new URL(request.url || '/', `http://${HOST}`)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const config = getConfig()
    if (url.searchParams.get('probe') === '1' && config.configured) {
      await probeProvider(config.providerId, { force: true })
    }
    sendJson(response, 200, {
      ok: true,
      ...providerHealth(config),
      mode: config.mock ? 'mock' : config.providerId,
      provider: config.provider.name,
      providerId: config.providerId,
      model: normalizeModel(config.providerId, process.env.PLAINIFY_AI_MODEL),
    }, origin)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/models') {
    const config = getConfig()
    const models = await listProviderModels(config)
    sendJson(response, 200, { ok: true, configured: config.configured, models }, origin)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/ai/providers') {
    requireSettingsOrigin(origin)
    const providerId = activeProviderId()
    sendJson(response, 200, {
      ok: true,
      activeProvider: providerId,
      activeModel: normalizeModel(providerId, process.env.PLAINIFY_AI_MODEL),
      providers: Object.values(PROVIDERS).map(providerSummary),
    }, origin)
    return
  }

  const providerRoute = url.pathname.match(/^\/api\/ai\/providers\/([^/]+)\/(credentials|models)$/)
  if (providerRoute) {
    requireSettingsOrigin(origin)
    const provider = providerDefinition(decodeURIComponent(providerRoute[1]))
    const action = providerRoute[2]
    if (['GET', 'POST'].includes(request.method) && action === 'models') {
      const body = request.method === 'POST' ? await readJson(request) : {}
      const config = getConfig(provider.id, {
        ...(String(body.apiKey || '').trim() ? { apiKey: body.apiKey } : {}),
        ...(Object.hasOwn(body, 'baseUrl') ? { baseUrl: body.baseUrl } : {}),
      })
      const models = await listProviderModels(config, { updateState: false })
      sendJson(response, 200, {
        ok: true,
        configured: config.configured,
        baseUrl: config.baseUrl,
        models,
      }, origin)
      return
    }
    if (request.method === 'POST' && action === 'credentials') {
      const body = await readJson(request)
      const result = await saveCredential(provider.id, body)
      sendJson(response, 200, { ok: true, ...result }, origin)
      return
    }
    if (request.method === 'DELETE' && action === 'credentials') {
      const wasActive = activeProviderId() === provider.id
      await persistConfigValues({
        [provider.envKey]: null,
        [provider.baseUrlEnvKey]: null,
      })
      if (wasActive) {
        const nextProviderId = activeProviderId()
        const nextProvider = providerDefinition(nextProviderId)
        await persistConfigValues({
          PLAINIFY_AI_PROVIDER: nextProvider.id,
          PLAINIFY_AI_MODEL: nextProvider.defaultModel,
        })
      }
      providerStates[provider.id] = {
        status: 'not_configured',
        code: 'backend_not_configured',
        message: `本机后端还没有配置 ${provider.name} API Key`,
        checkedAt: null,
        recoverable: false,
      }
      sendJson(response, 200, { ok: true, provider: providerSummary(provider) }, origin)
      return
    }
  }

  if (request.method === 'PUT' && url.pathname === '/api/ai/active') {
    requireSettingsOrigin(origin)
    const body = await readJson(request)
    const provider = providerDefinition(body.provider)
    const config = requireConfig(provider.id)
    const model = normalizeModel(provider.id, body.model)
    const models = await listProviderModels(config, { updateState: false })
    if (!models.includes(model)) {
      throw new ApiError(
        400,
        `当前 API 地址没有返回模型 ${model}，请先获取可用模型并选择一个`,
        `${provider.id}_model_not_available`,
      )
    }
    await persistConfigValues({ PLAINIFY_AI_PROVIDER: provider.id, PLAINIFY_AI_MODEL: model })
    setProviderReady(provider.id, `${provider.name} · ${model} 已选中`)
    sendJson(response, 200, { ok: true, activeProvider: provider.id, activeModel: model }, origin)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/explain') {
    const body = await readJson(request)
    const term = requireTerm(body.term)
    const providerId = activeProviderId()
    const provider = providerDefinition(providerId)
    const model = normalizeModel(providerId, process.env.PLAINIFY_AI_MODEL)
    const content = await requestCompletion([
      {
        role: 'system',
        content: '你是技术术语翻译员。面向刚接触技术的中文读者，用准确、口语化的大白话解释，不要堆砌新术语。只返回 JSON。',
      },
      {
        role: 'user',
        content: `解释术语“${term}”。返回：{"explanation":"2到3句大白话解释","analogy":"一句生活化类比"}`,
      },
    ], model, 450, providerId)
    const result = extractJson(content)
    if (!result.explanation) throw new ApiError(502, '模型没有给出解释', 'empty_explanation')
    sendJson(response, 200, {
      ok: true,
      term,
      explanation: String(result.explanation),
      analogy: String(result.analogy || ''),
      category: '未分组',
      provider: provider.name,
      providerId,
      model,
    }, origin)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/organize') {
    const body = await readJson(request)
    const mode = body.mode === 'all' ? 'all' : 'incremental'
    const existingCategories = [...new Set((Array.isArray(body.existingCategories) ? body.existingCategories : [])
      .slice(0, 100)
      .map((category) => String(category || '').trim().slice(0, 40))
      .filter((category) => category && category !== '未分组'))]
    const terms = (Array.isArray(body.terms) ? body.terms : []).slice(0, 500).map((item) => ({
      id: String(item.id || ''),
      term: String(item.term || '').slice(0, 120),
      explanation: String(item.explanation || '').slice(0, 1200),
    })).filter((item) => item.id && item.term)
    if (!terms.length) throw new ApiError(400, '没有可以分组的术语', 'missing_terms')
    const maxGroups = Math.max(1, Math.min(5, Math.floor(terms.length / 3)))
    const content = await requestCompletion([
      {
        role: 'system',
        content: mode === 'all'
          ? `你负责重新整理个人技术术语库。只能使用宽泛、长期稳定的技术大类，最多 ${maxGroups} 个分组；术语总数不少于 3 时，每组至少 3 个词，绝不创建只有 1 到 2 个词的分组。禁止用具体工具、框架、功能或单个机制命名分组，应使用类似“大模型与数据”“软件开发与协作”“Web 与网络”“系统与基础设施”这样的上位类别。放不下的少量词并入最接近的大类或“其他技术概念”。只返回 JSON。`
          : '你负责给个人技术术语库里的新词做增量归类。分组必须是能长期容纳多个术语的宽泛大类，禁止按具体工具、框架、功能或单个机制创建细分类。必须优先使用已有大类；只有至少 3 个新词都适合时才创建新分组，否则放入最接近的已有大类或“其他技术概念”。不要重命名、合并或删除已有分组。只返回 JSON。',
      },
      {
        role: 'user',
        content: mode === 'all'
          ? `请把这些术语归入不超过 ${maxGroups} 个技术大类，确保每个 id 都出现一次。术语：${JSON.stringify(terms)}。返回格式：{"assignments":[{"id":"原 id","category":"宽泛大类名"}]}`
          : `已有分组：${JSON.stringify(existingCategories)}。请只给以下新术语增量归类，优先选择已有大类，不要为 1 到 2 个词新建细分组，确保每个 id 都出现一次。术语：${JSON.stringify(terms)}。返回格式：{"assignments":[{"id":"原 id","category":"宽泛大类名"}]}`,
      },
    ], body.model, 1400, body.provider)
    const result = extractJson(content)
    sendJson(response, 200, { ok: true, assignments: Array.isArray(result.assignments) ? result.assignments : [] }, origin)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/test') {
    const body = await readJson(request)
    const content = await requestCompletion([
      { role: 'system', content: '只回复“连接成功”。' },
      { role: 'user', content: '测试连接' },
    ], body.model, 20, body.provider)
    sendJson(response, 200, { ok: true, message: content.trim() }, origin)
    return
  }

  throw new ApiError(404, '接口不存在', 'not_found')
}

export function startApiServer(options = {}) {
  configFilePath = path.resolve(options.configPath ?? process.env.BAIHUABEN_ENV_FILE ?? '.env.local')
  const port = Number(options.port ?? process.env.BAIHUABEN_API_PORT ?? DEFAULT_PORT)
  const server = http.createServer(async (request, response) => {
    const origin = allowedOrigin(request)
    if (origin === null) {
      sendJson(response, 403, { ok: false, error: '不允许的请求来源', code: 'origin_not_allowed' })
      return
    }
    if (request.method === 'OPTIONS') {
      setCorsHeaders(response, origin)
      response.writeHead(204)
      response.end()
      return
    }
    try {
      await routeRequest(request, response, origin)
    } catch (error) {
      const status = Number(error.status || 500)
      sendJson(response, status, {
        ok: false,
        error: status === 500 ? '本机后端发生错误' : error.message,
        code: error.code || 'internal_error',
        recoverable: Boolean(error.recoverable),
        retryAfterMs: Number(error.retryAfterMs || remainingRecoveryDelay()),
      }, origin)
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, HOST, () => {
      server.off('error', reject)
      resolve({ host: HOST, port: server.address().port, server })
    })
  })
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  const { host, port } = await startApiServer()
  const config = getConfig()
  console.log(`加简大白话后端：http://${host}:${port}（${config.configured ? `${config.provider.name} 已配置` : `等待配置 ${config.provider.name} Key`}）`)
}
