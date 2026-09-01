import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } })
const {
  explainTerm,
  fetchProviderModels,
  getBackendStatus,
  organizeLocally,
  organizeWithAi,
} = await vite.ssrLoadModule('/src/services/ai.js')

const calls = []

globalThis.fetch = async (url, options = {}) => {
  calls.push({ url, options })
  if (url.endsWith('/health')) {
    return {
      ok: true,
      async json() {
        return { ok: true, configured: true, mode: 'mock', provider: 'DeepSeek' }
      },
    }
  }
  if (url.endsWith('/models')) {
    return {
      ok: true,
      async json() {
        return { ok: true, models: ['deepseek-v4-flash', 'deepseek-reasoner', 'deepseek-chat'] }
      },
    }
  }

  if (url.endsWith('/explain')) return {
    ok: true,
    async json() {
      return {
        ok: true,
        explanation: '测试解释',
        analogy: '测试类比',
        category: '测试分组',
      }
    },
  }
  if (url.endsWith('/organize')) return {
    ok: true,
    async json() {
      return {
        ok: true,
        assignments: [
          { id: 'term-new', category: '大模型基础' },
          { id: 'term-stable', category: '不应覆盖旧分组' },
        ],
      }
    },
  }
  return { ok: true, async json() { return { ok: true, message: '连接成功' } } }
}

const status = await getBackendStatus()
assert.equal(status.configured, true)
assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/health')

const remoteModels = await fetchProviderModels({ provider: 'deepseek', apiKey: 'must-not-leave-browser' })
assert.deepEqual(remoteModels, ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash'])
assert.equal(calls[1].url, 'http://127.0.0.1:8787/api/ai/providers/deepseek/models')
assert.equal(calls[1].options.headers?.Authorization, undefined)
assert.deepEqual(JSON.parse(calls[1].options.body), {
  apiKey: 'must-not-leave-browser',
  baseUrl: 'https://api.deepseek.com/v1',
})

const explanation = await explainTerm('Context window', {
  apiKey: 'sk-test',
  provider: 'deepseek',
  baseUrl: 'https://wrong.example/v1',
  model: 'deepseek-reasoner',
})
assert.deepEqual(explanation, {
  explanation: '测试解释',
  analogy: '测试类比',
  category: '测试分组',
})
assert.equal(calls[2].url, 'http://127.0.0.1:8787/api/explain')
assert.deepEqual(JSON.parse(calls[2].options.body), {
  term: 'Context window',
  provider: 'deepseek',
  model: 'deepseek-reasoner',
})

const organized = await organizeWithAi([
  { id: 'term-new', term: 'RAG', explanation: '先检索后回答', category: '未分组' },
  { id: 'term-stable', term: 'Commit', explanation: '一次代码提交', category: '版本控制' },
], { apiKey: 'sk-test', provider: 'deepseek', model: 'deepseek-chat' }, 'incremental', ['版本控制', '空分组'])
assert.equal(organized[0].category, '大模型基础')
assert.equal(organized[1].category, '版本控制')

assert.equal(calls[3].url, 'http://127.0.0.1:8787/api/organize')
assert.deepEqual(JSON.parse(calls[3].options.body), {
  model: 'deepseek-chat',
  provider: 'deepseek',
  mode: 'incremental',
  existingCategories: ['版本控制', '空分组'],
  terms: [{ id: 'term-new', term: 'RAG', explanation: '先检索后回答' }],
})

const localOrganized = organizeLocally([
  { id: 'local-new', term: 'CORS', explanation: '浏览器跨域规则', category: '未分组' },
  { id: 'local-stable', term: 'Commit', explanation: '一次代码提交', category: '我的固定分组' },
])
assert.equal(localOrganized[0].category, 'API 与网络')
assert.equal(localOrganized[1].category, '我的固定分组')
assert.equal(calls.every((call) => call.url.startsWith('http://127.0.0.1:8787/api/')), true)
assert.equal(JSON.stringify(calls[2]).includes('sk-test'), false)
assert.equal(JSON.stringify(calls[3]).includes('sk-test'), false)

console.log('PASS website uses the localhost backend for status, models, explanation, and grouping')
console.log('PASS temporary credentials only travel to localhost provider validation endpoints')
console.log('PASS incremental grouping sends only ungrouped terms and preserves existing categories')
await vite.close()
