import assert from 'node:assert/strict'
import { mergeExtensionTerms } from '../src/data/termSync.js'
import { createTermTombstone, termKey, touchTerm } from '../src/data/terms.js'

const websiteTerm = {
  id: 'website-id',
  term: 'Context window',
  explanation: '模型一次能参考的内容范围。',
  analogy: '像桌面能摊开的资料数量。',
  category: '大模型基础',
  source: '来自网站',
  sourceUrl: '',
  status: 'ready',
  createdAt: '2026-08-28T07:00:00.000Z',
  updatedAt: '2026-08-28T07:00:00.000Z',
  archived: false,
  archivedAt: '',
  archivedCategory: '',
  mastered: false,
}

const archivedFromExtension = touchTerm({
  ...websiteTerm,
  id: 'extension-id',
}, {
  archived: true,
  archivedAt: '2026-08-28T08:00:00.000Z',
  archivedCategory: '大模型基础',
}, 'archive', '2026-08-28T08:00:00.000Z')

const [mergedArchive] = mergeExtensionTerms([websiteTerm], [archivedFromExtension])
assert.equal(mergedArchive.id, websiteTerm.id)
assert.equal(mergedArchive.archived, true)
assert.equal(mergedArchive.archivedAt, archivedFromExtension.archivedAt)
assert.equal(mergedArchive.archivedCategory, '大模型基础')
assert.equal(mergedArchive.mastered, false)

const [keptWebsiteArchive] = mergeExtensionTerms(
  [archivedFromExtension],
  [{ ...websiteTerm, archived: false, archivedAt: '', archivedCategory: '' }],
)
assert.equal(keptWebsiteArchive.archived, true)
assert.equal(keptWebsiteArchive.archivedAt, archivedFromExtension.archivedAt)
assert.equal(keptWebsiteArchive.archivedCategory, '大模型基础')

const [deduplicatedArchive] = mergeExtensionTerms([websiteTerm], [
  websiteTerm,
  archivedFromExtension,
])
assert.equal(deduplicatedArchive.archived, true)
assert.equal(deduplicatedArchive.archivedAt, archivedFromExtension.archivedAt)

const restoredOnWebsite = touchTerm(archivedFromExtension, {
  archived: false,
  archivedAt: '',
  archivedCategory: '',
}, ['archive', 'category'], '2026-08-28T09:00:00.000Z')
const [restoredAfterSync] = mergeExtensionTerms([restoredOnWebsite], [archivedFromExtension])
assert.equal(restoredAfterSync.archived, false)

const clearedOnWebsite = touchTerm(websiteTerm, {
  explanation: '',
  analogy: '',
  source: '',
  sourceUrl: '',
}, 'content', '2026-08-28T10:00:00.000Z')
const [keptClear] = mergeExtensionTerms([clearedOnWebsite], [websiteTerm])
assert.equal(keptClear.explanation, '')
assert.equal(keptClear.source, '')
assert.equal(keptClear.sourceUrl, '')
assert.equal(keptClear.status, 'pending')

const tombstone = createTermTombstone(websiteTerm, '2026-08-28T11:00:00.000Z')
const blocked = mergeExtensionTerms([], [websiteTerm], { [termKey(websiteTerm.term)]: tombstone })
assert.deepEqual(blocked, [])
const recollected = touchTerm(websiteTerm, {}, 'content', '2026-08-28T12:00:00.000Z')
assert.equal(mergeExtensionTerms([], [recollected], { [termKey(websiteTerm.term)]: tombstone }).length, 1)

console.log('PASS extension archive state is applied to an existing website term')
console.log('PASS stale active extension data cannot restore a website archive')
console.log('PASS duplicate extension terms preserve the archived copy')
console.log('PASS newer website restore and explicit content clearing win over stale extension data')
console.log('PASS delete tombstones block stale copies but allow a genuinely recollected term')
