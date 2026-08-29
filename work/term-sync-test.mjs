import assert from 'node:assert/strict'
import { mergeExtensionTerms } from '../src/data/termSync.js'

const websiteTerm = {
  id: 'website-id',
  term: 'Context window',
  explanation: '模型一次能参考的内容范围。',
  analogy: '像桌面能摊开的资料数量。',
  category: '大模型基础',
  source: '来自网站',
  sourceUrl: '',
  status: 'ready',
  archived: false,
  archivedAt: '',
  archivedCategory: '',
  mastered: false,
}

const archivedFromExtension = {
  ...websiteTerm,
  id: 'extension-id',
  archived: true,
  archivedAt: '2026-08-28T08:00:00.000Z',
  archivedCategory: '大模型基础',
  mastered: true,
}

const [mergedArchive] = mergeExtensionTerms([websiteTerm], [archivedFromExtension])
assert.equal(mergedArchive.id, websiteTerm.id)
assert.equal(mergedArchive.archived, true)
assert.equal(mergedArchive.archivedAt, archivedFromExtension.archivedAt)
assert.equal(mergedArchive.archivedCategory, '大模型基础')
assert.equal(mergedArchive.mastered, true)

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

console.log('PASS extension archive state is applied to an existing website term')
console.log('PASS stale active extension data cannot restore a website archive')
console.log('PASS duplicate extension terms preserve the archived copy')
