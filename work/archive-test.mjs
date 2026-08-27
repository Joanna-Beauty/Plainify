import assert from 'node:assert/strict'
import {
  archiveTermInList,
  archivedCategoryFor,
  restoreTermInList,
} from '../src/data/archive.js'
import {
  deleteGroup,
  groupNamesFromTerms,
  renameGroup,
} from '../src/data/grouping.js'

const terms = [
  { id: 'grouped', term: 'RAG', category: '大模型基础', archived: false },
  { id: 'ungrouped', term: 'CORS', category: '未分组', archived: false },
]

const archivedGrouped = archiveTermInList(terms, 'grouped', '2026-08-27T00:00:00.000Z')
assert.equal(archivedGrouped[0].archived, true)
assert.equal(archivedCategoryFor(archivedGrouped[0]), '大模型基础')
assert.deepEqual(groupNamesFromTerms(archivedGrouped), [])

const restoredToExisting = restoreTermInList(archivedGrouped, 'grouped', ['大模型基础'])
assert.equal(restoredToExisting[0].archived, false)
assert.equal(restoredToExisting[0].category, '大模型基础')

const archivedUngrouped = archiveTermInList(terms, 'ungrouped', '2026-08-27T00:00:00.000Z')
assert.equal(archivedCategoryFor(archivedUngrouped[1]), '未分组')

const deletedGroup = deleteGroup(['大模型基础'], archivedGrouped, '大模型基础')
assert.deepEqual(deletedGroup.groups, [])
assert.equal(archivedCategoryFor(deletedGroup.terms[0]), '大模型基础')

const restoredWithoutGroup = restoreTermInList(deletedGroup.terms, 'grouped', deletedGroup.groups)
assert.equal(restoredWithoutGroup[0].category, '未分组')
const archivedAgain = archiveTermInList(restoredWithoutGroup, 'grouped', '2026-08-27T01:00:00.000Z')
assert.equal(archivedCategoryFor(archivedAgain[0]), '未分组')

const renamed = renameGroup(['大模型基础'], archivedGrouped, '大模型基础', '大模型与数据')
assert.equal(archivedCategoryFor(renamed.terms[0]), '大模型与数据')
assert.equal(restoreTermInList(renamed.terms, 'grouped', renamed.groups)[0].category, '大模型与数据')

console.log('archive logic checks passed')
