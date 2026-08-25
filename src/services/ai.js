import { getProvider } from '../data/modelProviders'

const API_BASE_URL = 'http://127.0.0.1:8787/api'

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
  constructor(message, code = 'request_failed') {
    super(message)
    this.code = code
  }
}

async function requestApi(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
    })
  } catch {
    throw new ApiClientError('无法连接白话本本机后端，请确认 npm run dev 正在运行', 'backend_unreachable')
  }

  let data
  try { data = await response.json() } catch { data = {} }
  if (!response.ok || data.ok === false) {
    throw new ApiClientError(data.error || `本机后端请求失败（${response.status}）`, data.code)
  }
  return data
}

export function getLocalExplanation(term) {
  return localGlossary[term.trim().toLowerCase()] ?? null
}

export async function getBackendStatus(signal) {
  return requestApi('/health', { signal })
}

export async function fetchProviderModels(_settings, signal) {
  const provider = getProvider()
  const data = await requestApi('/models', { signal })
  const modelIds = Array.isArray(data.models)
    ? data.models.map((model) => String(model || '')).filter((model) => /^deepseek(?:-|$)/i.test(model))
    : []
  const uniqueModels = [...new Set(modelIds.length ? modelIds : provider.fallbackModels)]
  return uniqueModels.sort((a, b) => {
    if (a === provider.defaultModel) return -1
    if (b === provider.defaultModel) return 1
    return a.localeCompare(b)
  })
}

export async function explainTerm(term, settings) {
  const data = await requestApi('/explain', {
    method: 'POST',
    body: JSON.stringify({ term, model: settings.model }),
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

export function organizeLocally(terms) {
  return terms.map((term) => ({ ...term, category: localCategory(term) }))
}

export async function organizeWithAi(terms, settings) {
  const data = await requestApi('/organize', {
    method: 'POST',
    body: JSON.stringify({
      model: settings.model,
      terms: terms.map(({ id, term, explanation }) => ({ id, term, explanation })),
    }),
  })
  const assignments = new Map((data.assignments || []).map((item) => [item.id, item.category]))
  return terms.map((term) => ({ ...term, category: assignments.get(term.id) || term.category }))
}

export async function testAiConnection(settings) {
  const data = await requestApi('/test', {
    method: 'POST',
    body: JSON.stringify({ model: settings.model }),
  })
  return String(data.message || '')
}
