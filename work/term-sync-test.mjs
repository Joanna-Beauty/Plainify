import assert from 'node:assert/strict'
import { mergeExtensionTerms } from '../src/data/termSync.js'

const websiteTerm = {
  id: 'website-bash',
  term: 'bash',
  explanation: 'bash 是输入命令的程序。',
  analogy: '',
  category: '命令行',
  source: '手动输入',
  sourceUrl: '',
  status: 'ready',
}
const extensionTerm = {
  ...websiteTerm,
  id: 'extension-bash',
  analogy: '像通过聊天窗口给电脑派任务。',
  source: '测试网页',
  sourceUrl: 'https://example.com/bash',
}

const completed = mergeExtensionTerms([websiteTerm], [extensionTerm])
assert.equal(completed.length, 1)
assert.equal(completed[0].id, 'website-bash')
assert.equal(completed[0].analogy, extensionTerm.analogy)
assert.equal(completed[0].sourceUrl, extensionTerm.sourceUrl)
assert.equal(completed[0].category, '命令行')

const richWebsiteTerms = [completed[0]]
const unchanged = mergeExtensionTerms(richWebsiteTerms, [{ ...extensionTerm, analogy: '' }])
assert.equal(unchanged, richWebsiteTerms)
assert.equal(unchanged[0].analogy, extensionTerm.analogy)

const deduplicated = mergeExtensionTerms([
  websiteTerm,
  { ...websiteTerm, id: 'duplicate-bash', analogy: extensionTerm.analogy },
], [])
assert.equal(deduplicated.length, 1)
assert.equal(deduplicated[0].analogy, extensionTerm.analogy)

const archivedWebsiteTerm = {
  ...completed[0],
  archived: true,
  archivedCategory: '命令行',
}
const archivePreserved = mergeExtensionTerms([archivedWebsiteTerm], [{ ...extensionTerm, archived: false }])
assert.equal(archivePreserved[0].archived, true)
assert.equal(archivePreserved[0].archivedCategory, '命令行')

console.log('PASS website fills missing analogy from extension without overwriting existing fields')
console.log('PASS stale empty analogy cannot replace a complete website term')
console.log('PASS duplicate website terms collapse into one complete record')
console.log('PASS stale extension state cannot restore an archived website term')
