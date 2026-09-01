import assert from 'node:assert/strict'
import { archiveTermInList, restoreTermInList } from '../src/data/archive.js'
import { applyGroupingChanges } from '../src/data/grouping.js'
import { normalizeProviderSettings } from '../src/data/providers.js'
import { createReviewQueue, reviewTermInList } from '../src/data/review.js'
import { mergeExtensionTerms } from '../src/data/termSync.js'
import { normalizeTermRecord, stampChangedTerms, touchTerm } from '../src/data/terms.js'

const settings = normalizeProviderSettings({ provider: 'openai', model: 'gpt-4o-mini', autoExplain: true })
assert.equal(settings.provider, 'openai')
assert.equal(settings.model, 'gpt-4o-mini')
assert.equal(settings.hoverExplanationMode, 'both')
assert.equal(normalizeProviderSettings({ hoverExplanationMode: 'explanation' }).hoverExplanationMode, 'explanation')

const createdAt = '2026-08-29T01:00:00.000Z'
let terms = [normalizeTermRecord({
  id: 'plainify-flow',
  term: 'Context window',
  category: '未分组',
  source: '测试文章',
  sourceUrl: 'https://example.com/plainify',
  createdAt,
}, { now: createdAt })]
assert.equal(terms[0].status, 'pending')

terms = terms.map((term) => touchTerm(term, {
  explanation: '模型一次可以参考的内容范围。',
  analogy: '像桌面能同时摊开的资料数量。',
}, 'content', '2026-08-29T01:01:00.000Z'))
assert.equal(terms[0].status, 'ready')

const grouped = applyGroupingChanges(terms, [{
  id: terms[0].id,
  term: terms[0].term,
  from: '未分组',
  to: '大模型基础',
}])
terms = stampChangedTerms(terms, grouped, 'category', '2026-08-29T01:02:00.000Z')
assert.equal(terms[0].category, '大模型基础')

const queue = createReviewQueue(terms)
assert.deepEqual(queue.map((term) => term.id), ['plainify-flow'])
terms = reviewTermInList(terms, queue[0].id, true, '2026-08-29T01:03:00.000Z')
assert.equal(terms[0].mastered, true)

terms = archiveTermInList(terms, terms[0].id, '2026-08-29T01:04:00.000Z')
assert.equal(terms[0].archived, true)
assert.equal(createReviewQueue(terms).length, 0)

const extensionCopy = structuredClone(terms)
const restartedWebsiteTerms = JSON.parse(JSON.stringify(terms))
terms = mergeExtensionTerms(restartedWebsiteTerms, extensionCopy)
assert.equal(terms[0].archived, true)
assert.equal(terms[0].explanation, '模型一次可以参考的内容范围。')

terms = restoreTermInList(terms, terms[0].id, ['大模型基础'], '2026-08-29T01:05:00.000Z')
assert.equal(terms[0].archived, false)
assert.equal(terms[0].category, '大模型基础')
assert.equal(terms[0].mastered, true)

console.log('PASS model selection, collection, explanation, grouping, review, archive, restart sync, and restore form one core flow')
