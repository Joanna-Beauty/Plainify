import assert from 'node:assert/strict'
import {
  applyGroupingChanges,
  consolidateBroadGroups,
  createGroupingPreview,
  deleteGroup,
  groupsAfterAutomaticGrouping,
  mergeGroups,
  recommendedBroadGroupCount,
  renameGroup,
} from '../src/data/grouping.js'

const terms = [
  { id: 'a', term: 'RAG', category: 'AI 开发' },
  { id: 'b', term: 'Embedding', category: 'AI 开发' },
  { id: 'c', term: 'CORS', category: 'API 与网络' },
]
const groups = ['AI 开发', 'API 与网络', '空分组']

const renamed = renameGroup(groups, terms, 'AI 开发', '大模型基础')
assert.deepEqual(renamed.groups, ['大模型基础', 'API 与网络', '空分组'])
assert.deepEqual(renamed.terms.map((term) => term.category), ['大模型基础', '大模型基础', 'API 与网络'])

const deleted = deleteGroup(renamed.groups, renamed.terms, 'API 与网络')
assert.equal(deleted.groups.includes('API 与网络'), false)
assert.equal(deleted.terms.find((term) => term.id === 'c').category, '未分组')

const merged = mergeGroups(groups, terms, 'AI 开发', 'API 与网络')
assert.deepEqual(merged.groups, ['API 与网络', '空分组'])
assert.equal(merged.terms.every((term) => term.category === 'API 与网络'), true)

const current = [
  { id: 'new-1', term: 'Token', category: '未分组' },
  { id: 'new-2', term: 'Service worker', category: '未分组' },
  { id: 'stable', term: 'Commit', category: '版本控制' },
]
const proposed = [
  { ...current[0], category: '大模型基础' },
  { ...current[1], category: '浏览器机制' },
  current[2],
]
const preview = createGroupingPreview(current, proposed, ['大模型基础', '版本控制'], 'incremental')
assert.equal(preview.changes.length, 2)
assert.equal(preview.existingAssignmentsCount, 1)
assert.deepEqual(preview.newGroups, ['浏览器机制'])
assert.deepEqual(preview.removedGroups, [])

const applied = applyGroupingChanges(current, preview.changes)
assert.deepEqual(applied.map((term) => term.category), ['大模型基础', '浏览器机制', '版本控制'])

const manuallyMoved = applied.map((term) => term.id === 'new-2' ? { ...term, category: '手动分组' } : term)
const undone = applyGroupingChanges(manuallyMoved, preview.changes, 'reverse')
assert.deepEqual(undone.map((term) => term.category), ['未分组', '手动分组', '版本控制'])

const overlyDetailed = [
  ['1', 'Cherry-pick', 'Git 命令'],
  ['2', 'CORS', '浏览器安全'],
  ['3', 'CSS', '前端样式'],
  ['4', 'HTML', '前端样式'],
  ['5', 'RAG', '大模型与数据'],
  ['6', 'Token', '大模型与数据'],
  ['7', 'Embedding', '大模型与数据'],
  ['8', 'Docker', '系统与基础设施'],
  ['9', 'Kubernetes', '系统与基础设施'],
  ['10', 'Linux', '系统与基础设施'],
].map(([id, term, category]) => ({ id, term, category }))
const broad = consolidateBroadGroups(overlyDetailed, 'all')
const broadCounts = new Map()
for (const term of broad) broadCounts.set(term.category, (broadCounts.get(term.category) || 0) + 1)
assert.ok(broadCounts.size <= recommendedBroadGroupCount(broad.length))
assert.equal([...broadCounts.values()].every((count) => count >= 3), true)

const fullPreview = createGroupingPreview(
  overlyDetailed,
  broad,
  ['Git 命令', '浏览器安全', '前端样式', '大模型与数据', '系统与基础设施', '空旧分组'],
  'all',
)
const groupsAfterFullRegroup = groupsAfterAutomaticGrouping(
  ['Git 命令', '浏览器安全', '前端样式', '大模型与数据', '系统与基础设施', '空旧分组'],
  broad,
  'all',
  fullPreview.newGroups,
)
assert.deepEqual(groupsAfterFullRegroup, fullPreview.resultGroups)
assert.equal(groupsAfterFullRegroup.includes('空旧分组'), false)
assert.equal(fullPreview.removedGroups.includes('空旧分组'), true)

const groupsAfterIncremental = groupsAfterAutomaticGrouping(
  ['版本控制', '空分组'],
  applied,
  'incremental',
  preview.newGroups,
)
assert.deepEqual(groupsAfterIncremental, ['版本控制', '空分组', '浏览器机制'])

console.log('PASS group create data can stay empty and rename/delete/merge update term assignments')
console.log('PASS grouping preview reports existing and new groups before applying')
console.log('PASS undo restores only untouched automatic changes and preserves later manual moves')
console.log('PASS full regroup consolidates tiny categories into a limited set of broad groups')
console.log('PASS full regroup replaces obsolete groups while incremental grouping preserves them')
