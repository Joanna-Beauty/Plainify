import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'
const FALLBACK_MODELS = ['deepseek-chat', 'deepseek-reasoner']
const MAX_BODY_BYTES = 128 * 1024
const LOCAL_WEB_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/i

class ApiError extends Error {
  constructor(status, message, code = 'request_failed') {
    super(message)
    this.status = status
    this.code = code
  }
}

function normalizeModel(model) {
  const value = String(model || '')
  return /^deepseek(?:-|$)/i.test(value) ? value : DEFAULT_MODEL
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
    throw new ApiError(502, timedOut ? 'DeepSeek 请求超时' : '无法连接 DeepSeek', timedOut ? 'deepseek_timeout' : 'deepseek_unreachable')
  }

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(502, 'DeepSeek API Key 无效或没有权限', 'deepseek_auth_failed')
    }
    if (response.status === 429) {
      throw new ApiError(502, 'DeepSeek 请求过于频繁或额度不足', 'deepseek_rate_limited')
    }
    throw new ApiError(502, `DeepSeek 请求失败（${response.status}）`, 'deepseek_request_failed')
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(502, 'DeepSeek 返回内容无法解析', 'invalid_model_response')
  }
}

async function requestCompletion(messages, model, maxTokens = 900) {
  const config = requireConfig()
  if (config.mock) {
    const prompt = String(messages.at(-1)?.content || '')
    if (prompt.includes('重新分组')) {
      const match = prompt.match(/术语：(.+?)。返回格式/s)
      let items = []
      try { items = JSON.parse(match?.[1] || '[]') } catch { items = [] }
      return JSON.stringify({ assignments: items.map((item) => ({ id: item.id, category: '测试分组' })) })
    }
    if (prompt.includes('测试连接')) return '连接成功'
    return JSON.stringify({
      explanation: '这是隔离测试环境生成的大白话解释。',
      analogy: '像先看懂说明，再决定要不要记进笔记本。',
      category: '测试分组',
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
    sendJson(response, 200, {
      ok: true,
      configured: config.configured,
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
      ? [...new Set(data.data.map((item) => String(item.id || '')).filter((id) => /^deepseek(?:-|$)/i.test(id)))]
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
        content: `解释术语“${term}”。返回：{"explanation":"2到3句大白话解释","analogy":"一句生活化类比","category":"简短技术分组"}`,
      },
    ], body.model)
    const result = extractJson(content)
    if (!result.explanation) throw new ApiError(502, 'DeepSeek 没有给出解释', 'empty_explanation')
    sendJson(response, 200, {
      ok: true,
      term,
      explanation: String(result.explanation),
      analogy: String(result.analogy || ''),
      category: String(result.category || '未分组'),
    }, origin)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/organize') {
    const body = await readJson(request)
    const terms = (Array.isArray(body.terms) ? body.terms : []).slice(0, 500).map((item) => ({
      id: String(item.id || ''),
      term: String(item.term || '').slice(0, 120),
      explanation: String(item.explanation || '').slice(0, 1200),
    })).filter((item) => item.id && item.term)
    if (!terms.length) throw new ApiError(400, '没有可以分组的术语', 'missing_terms')
    const content = await requestCompletion([
      {
        role: 'system',
        content: '你负责整理个人技术术语库。分组要少而清楚，每组名字用简短中文，不要建立只有一个词的过细分组。只返回 JSON。',
      },
      {
        role: 'user',
        content: `请把这些术语重新分组，术语：${JSON.stringify(terms)}。返回格式：{"assignments":[{"id":"原 id","category":"分组名"}]}`,
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
  const port = Number(options.port || process.env.BAIHUABEN_API_PORT || DEFAULT_PORT)
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
      }, origin)
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, HOST, () => {
      server.off('error', reject)
      resolve({ host: HOST, port, server })
    })
  })
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  const { host, port } = await startApiServer()
  const config = getConfig()
  console.log(`白话本后端：http://${host}:${port}（${config.configured ? 'DeepSeek 已配置' : '等待配置 DeepSeek Key'}）`)
}
