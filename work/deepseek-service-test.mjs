import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } })
const {
  explainTerm,
  fetchProviderModels,
  getBackendStatus,
  organizeWithAi,
  testAiConnection,
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
        return { ok: true, models: ['deepseek-reasoner', 'deepseek-chat'] }
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
      return { ok: true, assignments: [{ id: 'term-1', category: '大模型基础' }] }
    },
  }
  return { ok: true, async json() { return { ok: true, message: '连接成功' } } }
}

const status = await getBackendStatus()
assert.equal(status.configured, true)
assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/health')

const remoteModels = await fetchProviderModels({ apiKey: 'must-not-leave-browser' })
assert.deepEqual(remoteModels, ['deepseek-chat', 'deepseek-reasoner'])
assert.equal(calls[1].url, 'http://127.0.0.1:8787/api/models')
assert.equal(calls[1].options.headers?.Authorization, undefined)

const explanation = await explainTerm('Context window', {
  apiKey: 'sk-test',
  provider: 'openai',
  baseUrl: 'https://wrong.example/v1',
  model: 'deepseek-reasoner',
})
assert.deepEqual(explanation, {
  explanation: '测试解释',
  analogy: '测试类比',
  category: '测试分组',
})
assert.equal(calls[2].url, 'http://127.0.0.1:8787/api/explain')
assert.deepEqual(JSON.parse(calls[2].options.body), { term: 'Context window', model: 'deepseek-reasoner' })

await testAiConnection({ apiKey: 'sk-test', model: 'gpt-5' })
assert.equal(calls[3].url, 'http://127.0.0.1:8787/api/test')
assert.deepEqual(JSON.parse(calls[3].options.body), { model: 'gpt-5' })

const organized = await organizeWithAi([
  { id: 'term-1', term: 'RAG', explanation: '先检索后回答', category: '未分组' },
], { apiKey: 'sk-test', model: 'deepseek-chat' })
assert.equal(organized[0].category, '大模型基础')

assert.equal(calls[4].url, 'http://127.0.0.1:8787/api/organize')
assert.equal(calls.some((call) => JSON.stringify(call).includes('must-not-leave-browser')), false)

console.log('PASS website uses the localhost backend for status, models, explanation, test, and grouping')
console.log('PASS legacy browser API Key is never sent in URL, headers, or request body')
await vite.close()
