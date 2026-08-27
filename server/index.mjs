import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')
const DEFAULT_MODEL = 'deepseek-chat'
const FALLBACK_MODELS = ['deepseek-chat', 'deepseek-reasoner']
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

let providerState = {
  status: 'unknown',
  code: 'deepseek_not_checked',
  message: '正在检查 DeepSeek 真实连接状态',
  checkedAt: null,
  recoverable: true,
}
let recoveryTimer = null
let recoveryAttempt = 0
let nextRecoveryAt = 0
let providerProbePromise = null

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

function setProviderReady(message = 'DeepSeek 已连接，可以正常生成解释') {
  clearRecoverySchedule()
  providerState = {
    status: 'ready',
    code: 'deepseek_ready',
    message,
    checkedAt: new Date().toISOString(),
    recoverable: false,
  }
}

function setProviderFailure(error) {
  providerState = {
    status: error.code === 'deepseek_insufficient_balance'
      ? 'insufficient_balance'
      : error.code === 'deepseek_rate_limited'
        ? 'rate_limited'
        : error.code === 'deepseek_auth_failed'
          ? 'auth_failed'
          : 'temporarily_unavailable',
    code: error.code,
    message: error.message,
    checkedAt: new Date().toISOString(),
    recoverable: Boolean(error.recoverable),
  }
  if (error.recoverable) scheduleRecoveryProbe()
  else clearRecoverySchedule()
}

function deepSeekErrorDetails(text) {
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
  const detail = deepSeekErrorDetails(text)
  const fingerprint = `${detail.message} ${detail.code} ${detail.type}`.toLowerCase()
  if (status === 402 || /(insufficient[ _-]*balance|balance[^a-z\u4e00-\u9fff]*insufficient|余额不足|账户余额)/i.test(fingerprint)) {
    return new ApiError(
      503,
      'DeepSeek 账户余额不足；充值到账后加简大白话会自动恢复连接',
      'deepseek_insufficient_balance',
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
  }
  if (status === 401 || status === 403) {
    return new ApiError(502, 'DeepSeek API Key 无效或没有权限', 'deepseek_auth_failed')
  }
  if (status === 429) {
    return new ApiError(
      503,
      'DeepSeek 请求过于频繁，加简大白话会稍后自动重试',
      'deepseek_rate_limited',
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
  }
  if (status >= 500 || status === 408) {
    return new ApiError(
      502,
      `DeepSeek 暂时不可用（${status}），加简大白话会自动重试`,
      'deepseek_temporarily_unavailable',
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
  }
  return new ApiError(502, `DeepSeek 请求失败（${status}）`, 'deepseek_request_failed')
}

function normalizeModel(model) {
  const value = String(model || '')
  return FALLBACK_MODELS.includes(value) ? value : DEFAULT_MODEL
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
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
  if (start === -1 || end === -1) throw new ApiError(502, 'DeepSeek 返回格式无法识别', 'invalid_model_response')
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new ApiError(502, 'DeepSeek 返回的 JSON 无法解析', 'invalid_model_response')
  }
}

function requireTerm(value) {
  const term = String(value || '').trim().replace(/\s+/g, ' ')
  if (!term) throw new ApiError(400, '请提供要解释的术语', 'missing_term')
  if (term.length > 120) throw new ApiError(400, '术语不能超过 120 个字符', 'term_too_long')
  return term
}

function getConfig() {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim()
  const mock = process.env.BAIHUABEN_MOCK_AI === '1'
  return { apiKey, configured: Boolean(apiKey) || mock, mock }
}

function requireConfig() {
  const config = getConfig()
  if (!config.configured) {
    throw new ApiError(503, '本机后端还没有配置 DeepSeek API Key', 'backend_not_configured')
  }
  return config
}

function currentProviderState(config = getConfig()) {
  if (!config.configured) {
    return {
      status: 'not_configured',
      code: 'backend_not_configured',
      message: '本机后端还没有配置 DeepSeek API Key',
      checkedAt: null,
      recoverable: false,
    }
  }
  if (config.mock) {
    return {
      status: 'ready',
      code: 'deepseek_ready',
      message: '隔离测试服务已就绪',
      checkedAt: providerState.checkedAt,
      recoverable: false,
    }
  }
  return providerState
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

function scheduleRecoveryProbe() {
  if (recoveryTimer || providerProbePromise || !providerState.recoverable) return
  const delays = recoveryDelays()
  const delay = delays[Math.min(recoveryAttempt, delays.length - 1)]
  recoveryAttempt += 1
  nextRecoveryAt = Date.now() + delay
  recoveryTimer = setTimeout(async () => {
    recoveryTimer = null
    nextRecoveryAt = 0
    await probeDeepSeek({ force: true })
    if (providerState.recoverable) scheduleRecoveryProbe()
  }, delay)
  recoveryTimer.unref?.()
}

async function requestDeepSeek(pathname, init, config = requireConfig()) {
  if (config.mock) return null
  let response
  try {
    response = await fetch(`${DEEPSEEK_BASE_URL}${pathname}`, {
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
      timedOut ? 'DeepSeek 请求超时，加简大白话会自动重试' : '无法连接 DeepSeek，加简大白话会自动重试',
      timedOut ? 'deepseek_timeout' : 'deepseek_unreachable',
      { recoverable: true, retryAfterMs: recoveryDelays()[0] },
    )
    setProviderFailure(apiError)
    throw apiError
  }

  const text = await response.text()
  if (!response.ok) {
    const apiError = classifyDeepSeekFailure(response.status, text)
    setProviderFailure(apiError)
    throw apiError
  }

  if (pathname === '/chat/completions') setProviderReady()

  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(502, 'DeepSeek 返回内容无法解析', 'invalid_model_response')
  }
}

async function probeDeepSeek({ force = false } = {}) {
  const config = getConfig()
  if (!config.configured) return currentProviderState(config)
  if (config.mock) {
    setProviderReady('隔离测试服务已就绪')
    return currentProviderState(config)
  }
  if (providerProbePromise) return providerProbePromise

  const checkedAt = Date.parse(providerState.checkedAt || '')
  const cacheMs = providerState.status === 'ready' ? PROBE_READY_CACHE_MS : PROBE_FAILURE_CACHE_MS
  if (!force && Number.isFinite(checkedAt) && Date.now() - checkedAt < cacheMs) return providerState
  if (!force && providerState.status === 'auth_failed') return providerState

  providerProbePromise = (async () => {
    try {
      await requestDeepSeek('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [{ role: 'user', content: '只回复 1' }],
          temperature: 0,
          max_tokens: 1,
        }),
      }, config)
    } catch {
      // requestDeepSeek records the detailed recoverable state.
    }
    return currentProviderState(config)
  })().finally(() => {
    providerProbePromise = null
    if (providerState.recoverable) scheduleRecoveryProbe()
  })
  return providerProbePromise
}

async function requestCompletion(messages, model, maxTokens = 900) {
  const config = requireConfig()
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

  const data = await requestDeepSeek('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: normalizeModel(model),
      messages,
      temperature: 0.25,
      max_tokens: maxTokens,
    }),
  }, config)
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new ApiError(502, 'DeepSeek 没有返回内容', 'empty_model_response')
  return content
}

async function routeRequest(request, response, origin) {
  const url = new URL(request.url || '/', `http://${HOST}`)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const config = getConfig()
    if (url.searchParams.get('probe') === '1' && config.configured) await probeDeepSeek()
    sendJson(response, 200, {
      ok: true,
      ...providerHealth(config),
      mode: config.mock ? 'mock' : 'deepseek',
      provider: 'DeepSeek',
    }, origin)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/models') {
    const config = getConfig()
    if (!config.configured || config.mock) {
      sendJson(response, 200, { ok: true, configured: config.configured, models: FALLBACK_MODELS }, origin)
      return
    }
    const data = await requestDeepSeek('/models', { method: 'GET', headers: {} }, config)
    const models = Array.isArray(data.data)
      ? [...new Set(data.data.map((item) => String(item.id || '')).filter((id) => FALLBACK_MODELS.includes(id)))]
      : []
    sendJson(response, 200, { ok: true, configured: true, models: models.length ? models : FALLBACK_MODELS }, origin)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/explain') {
    const body = await readJson(request)
    const term = requireTerm(body.term)
    const content = await requestCompletion([
      {
        role: 'system',
        content: '你是技术术语翻译员。面向刚接触技术的中文读者，用准确、口语化的大白话解释，不要堆砌新术语。只返回 JSON。',
      },
      {
        role: 'user',
        content: `解释术语“${term}”。返回：{"explanation":"2到3句大白话解释","analogy":"一句生活化类比"}`,
      },
    ], body.model, 450)
    const result = extractJson(content)
    if (!result.explanation) throw new ApiError(502, 'DeepSeek 没有给出解释', 'empty_explanation')
    sendJson(response, 200, {
      ok: true,
      term,
      explanation: String(result.explanation),
      analogy: String(result.analogy || ''),
      category: '未分组',
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
    ], body.model, 1400)
    const result = extractJson(content)
    sendJson(response, 200, { ok: true, assignments: Array.isArray(result.assignments) ? result.assignments : [] }, origin)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/test') {
    await readJson(request)
    const content = await requestCompletion([
      { role: 'system', content: '只回复“连接成功”。' },
      { role: 'user', content: '测试连接' },
    ], DEFAULT_MODEL, 20)
    sendJson(response, 200, { ok: true, message: content.trim() }, origin)
    return
  }

  throw new ApiError(404, '接口不存在', 'not_found')
}

export function startApiServer(options = {}) {
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
  console.log(`加简大白话后端：http://${host}:${port}（${config.configured ? 'DeepSeek 已配置' : '等待配置 DeepSeek Key'}）`)
}
