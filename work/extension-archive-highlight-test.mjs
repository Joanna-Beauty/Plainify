import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('../extension/term-data.js', import.meta.url), 'utf8')
const context = vm.createContext({})
vm.runInContext(source, context)

const normalized = context.BaihuabenTermData.normalizeHighlightTerms([
  { id: 'active', term: 'RAG', explanation: '保留高亮', archived: false },
  { id: 'archived', term: 'CORS', explanation: '不能高亮', archived: true },
])

assert.deepEqual(Array.from(normalized, (item) => item.term), ['RAG'])
assert.equal(normalized.some((item) => item.archived), false)
console.log('extension archive highlight checks passed')
