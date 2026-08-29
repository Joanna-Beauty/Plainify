import { getProvider } from '../data/modelProviders'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787/api').replace(/\/$/, '')

const localGlossary = {
  webhook: {
    explanation: '一个系统发生某件事后，主动把消息发给另一个系统的地址。接收方不用一直追问“有新消息吗”。',
    analogy: '像快递到了以后主动给你发短信，而不是你每分钟查一次物流。',
    category: 'API 与网络',
  },
  sdk: {
    explanation: '某个平台为开发者准备好的一套代码工具，让你不用从最底层开始写，就能调用它的能力。',
    analogy: '像装家具时附带的专用工具包和说明书。',
    category: '开发工具',
  },
  'pull request': {
    explanation: '你完成一批代码修改后，请团队检查并把它合并进主分支的一次正式申请。',
    analogy: '像把改好的稿子交给编辑审阅，通过后才进入正式版本。',
    category: 'Git 与协作',
  },
}

export class ApiClientError extends Error {
  constructor(message, code = 'request_failed', options = {}) {
    super(message)
    this.code = code
    this.recoverable = Boolean(options.recoverable)
    this.retryAfterMs = Number(options.retryAfterMs || 0)
  }
}

async function requestApi(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiClientError('无法连接加简大白话的本地服务，请检查常驻服务是否运行', 'backend_unreachable')
  }

  let data
  try { data = await response.json() } catch { data = {} }
  if (!response.ok || data.ok === false) {
    throw new ApiClientError(
      data.error || `本机后端请求失败（${response.status}）`,
      data.code,
      { recoverable: data.recoverable, retryAfterMs: data.retryAfterMs },
    )
  }
  return data
}

export function getLocalExplanation(term) {
  return localGlossary[term.trim().toLowerCase()] ?? null
}

export async function getBackendStatus(signal, probe = false) {
  return requestApi(`/health${probe ? '?probe=1' : ''}`, { signal })
}

export async function getAiProviders(signal) {
  return requestApi('/ai/providers', { signal })
}

export async function saveProviderCredential(providerId, apiKey, model = '', baseUrl = '') {
  return requestApi(`/ai/providers/${encodeURIComponent(providerId)}/credentials`, {
    method: 'POST',
    body: JSON.stringify({ apiKey, model, baseUrl }),
  })
}

export async function deleteProviderCredential(providerId) {
  return requestApi(`/ai/providers/${encodeURIComponent(providerId)}/credentials`, {
    method: 'DELETE',
  })
}

export async function activateProvider(providerId, model) {
  return requestApi('/ai/active', {
    method: 'PUT',
    body: JSON.stringify({ provider: providerId, model }),
  })
}

export async function fetchProviderModels(settings = {}, signal) {
  const provider = getProvider(settings.provider)
  const data = await requestApi(`/ai/providers/${encodeURIComponent(provider.id)}/models`, {
    method: 'POST',
    body: JSON.stringify({
      apiKey: String(settings.apiKey || '').trim(),
      baseUrl: String(settings.baseUrl || provider.baseUrl).trim(),
    }),
    signal,
  })
  const modelIds = Array.isArray(data.models)
    ? data.models.map((model) => String(model || '')).filter(Boolean)
    : []
  const uniqueModels = [...new Set(modelIds.length ? modelIds : provider.fallbackModels)]
  return uniqueModels.sort((a, b) => {
    if (a === provider.defaultModel) return -1
    if (b === provider.defaultModel) return 1
    return a.localeCompare(b)
  })
}

export async function openLocalConfigFile() {
  return requestApi('/settings/open-config', { method: 'POST' })
}

export async function explainTerm(term, settings) {
  const data = await requestApi('/explain', {
    method: 'POST',
    body: JSON.stringify({ term, provider: settings.provider, model: settings.model }),
  })
  return {
    explanation: String(data.explanation || ''),
    analogy: String(data.analogy || ''),
    category: String(data.category || '未分组'),
  }
}

function localCategory(term) {
  const text = `${term.term} ${term.explanation}`.toLowerCase()
  if (/(git|commit|branch|merge|pull request|cherry)/.test(text)) return 'Git 与协作'
  if (/(model|token|rag|embedding|prompt|llm|大模型|幻觉)/.test(text)) return '大模型基础'
  if (/(api|http|cors|webhook|rate limit|接口|请求)/.test(text)) return 'API 与网络'
  if (/(database|vector|sql|数据|检索)/.test(text)) return '数据与检索'
  if (/(react|html|css|javascript|浏览器|web)/.test(text)) return 'Web 开发'
  return term.category === '未分组' ? '其他技术概念' : term.category
}

export function organizeLocally(terms, mode = 'incremental') {
  return terms.map((term) => (
    mode === 'all' || term.category === '未分组'
      ? { ...term, category: localCategory({ ...term, category: '未分组' }) }
      : term
  ))
}

export async function organizeWithAi(terms, settings, mode = 'incremental', groups = []) {
  const candidates = mode === 'all'
    ? terms
    : terms.filter((term) => term.category === '未分组')
  if (!candidates.length) return terms
  const existingCategories = [...new Set([
    ...groups,
    ...terms.map((term) => term.category),
  ].filter((category) => category && category !== '未分组'))]
  const data = await requestApi('/organize', {
    method: 'POST',
    body: JSON.stringify({
      model: settings.model,
      provider: settings.provider,
      mode,
      existingCategories,
      terms: candidates.map(({ id, term, explanation }) => ({ id, term, explanation })),
    }),
  })
  const candidateIds = new Set(candidates.map((term) => term.id))
  const assignments = new Map((data.assignments || [])
    .filter((item) => candidateIds.has(item.id) && item.category)
    .map((item) => [item.id, String(item.category)]))
  return terms.map((term) => ({ ...term, category: assignments.get(term.id) || term.category }))
}

export async function testAiConnection(settings) {
  const provider = getProvider(settings.provider)
  const data = await requestApi(`/ai/providers/${encodeURIComponent(provider.id)}/test`, {
    method: 'POST',
    body: JSON.stringify({ model: settings.model }),
  })
  return String(data.message || '')
}
