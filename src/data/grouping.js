export const UNGROUPED = '未分组'
export const ALL_TERMS = '全部术语'
export const BROAD_FALLBACK_GROUP = '其他技术概念'
export const MIN_TERMS_PER_GROUP = 3
export const MAX_BROAD_GROUPS = 5

export function normalizeGroupName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function mergeGroupNames(...lists) {
  const names = new Map()
  for (const list of lists) {
    for (const rawName of Array.isArray(list) ? list : []) {
      const name = normalizeGroupName(rawName)
      if (!name || name === UNGROUPED || name === ALL_TERMS) continue
      const key = name.toLocaleLowerCase('zh-CN')
      if (!names.has(key)) names.set(key, name)
    }
  }
  return [...names.values()]
}

export function groupNamesFromTerms(terms) {
  return mergeGroupNames((Array.isArray(terms) ? terms : [])
    .filter((term) => term.archived !== true)
    .map((term) => term.category))
}

function countGroups(terms) {
  const counts = new Map()
  for (const term of terms) {
    if (term.archived === true) continue
    const category = normalizeGroupName(term.category)
    if (!category || category === UNGROUPED) continue
    counts.set(category, (counts.get(category) || 0) + 1)
  }
  return counts
}

function replaceGroups(terms, sources, target) {
  const sourceSet = new Set(sources)
  return terms.map((term) => term.archived !== true && sourceSet.has(term.category)
    ? { ...term, category: target }
    : term)
}

export function recommendedBroadGroupCount(termCount) {
  if (termCount <= 0) return 0
  return Math.max(1, Math.min(MAX_BROAD_GROUPS, Math.floor(termCount / MIN_TERMS_PER_GROUP)))
}

export function consolidateBroadGroups(terms, mode = 'all', existingGroups = []) {
  let consolidated = terms
  let counts = countGroups(consolidated)
  const existing = new Set(existingGroups)
  const smallGroups = [...counts]
    .filter(([group, count]) => count < MIN_TERMS_PER_GROUP && (mode === 'all' || !existing.has(group)))
    .map(([group]) => group)

  if (smallGroups.length) {
    const smallTotal = smallGroups.reduce((total, group) => total + (counts.get(group) || 0), 0)
    const largestStableGroup = [...counts]
      .filter(([group]) => !smallGroups.includes(group))
      .sort((a, b) => b[1] - a[1])[0]?.[0]
    const target = mode === 'all' && smallTotal < MIN_TERMS_PER_GROUP && largestStableGroup
      ? largestStableGroup
      : BROAD_FALLBACK_GROUP
    consolidated = replaceGroups(consolidated, smallGroups, target)
    counts = countGroups(consolidated)
  }

  if (mode !== 'all') return consolidated

  const assignedCount = [...counts.values()].reduce((total, count) => total + count, 0)
  const maxGroups = recommendedBroadGroupCount(assignedCount)
  while (counts.size > maxGroups) {
    const smallestGroups = [...counts]
      .filter(([group]) => group !== BROAD_FALLBACK_GROUP)
      .sort((a, b) => a[1] - b[1])
    const sources = counts.has(BROAD_FALLBACK_GROUP)
      ? smallestGroups.slice(0, 1).map(([group]) => group)
      : smallestGroups.slice(0, 2).map(([group]) => group)
    if (!sources.length) break
    consolidated = replaceGroups(consolidated, sources, BROAD_FALLBACK_GROUP)
    counts = countGroups(consolidated)
  }
  return consolidated
}

export function groupsAfterAutomaticGrouping(currentGroups, terms, mode, newGroups = []) {
  return mode === 'all'
    ? groupNamesFromTerms(terms)
    : mergeGroupNames(currentGroups, newGroups)
}

export function renameGroup(groups, terms, source, target) {
  return {
    groups: groups.map((group) => group === source ? target : group),
    terms: terms.map((term) => {
      if (term.archived === true && term.archivedCategory === source) {
        return {
          ...term,
          archivedCategory: target,
          category: term.category === source ? target : term.category,
        }
      }
      return term.archived !== true && term.category === source ? { ...term, category: target } : term
    }),
  }
}

export function deleteGroup(groups, terms, target) {
  return {
    groups: groups.filter((group) => group !== target),
    terms: terms.map((term) => term.archived !== true && term.category === target
      ? { ...term, category: UNGROUPED }
      : term),
  }
}

export function mergeGroups(groups, terms, source, target) {
  return {
    groups: groups.filter((group) => group !== source),
    terms: terms.map((term) => {
      if (term.archived === true && term.archivedCategory === source) {
        return {
          ...term,
          archivedCategory: target,
          category: term.category === source ? target : term.category,
        }
      }
      return term.archived !== true && term.category === source ? { ...term, category: target } : term
    }),
  }
}

export function createGroupingPreview(currentTerms, proposedTerms, groups, mode, fallbackMessage = '') {
  const proposedById = new Map(proposedTerms.map((term) => [term.id, term]))
  const knownGroups = new Set(groups)
  const changes = currentTerms.filter((term) => term.archived !== true).flatMap((term) => {
    const proposed = proposedById.get(term.id)
    const target = normalizeGroupName(proposed?.category)
    if (!target || target === term.category) return []
    return [{ id: term.id, term: term.term, from: term.category || UNGROUPED, to: target }]
  })
  const newGroups = mergeGroupNames(changes
    .map((change) => change.to)
    .filter((group) => !knownGroups.has(group)))
  const resultGroups = groupNamesFromTerms(proposedTerms)
  const resultGroupSet = new Set(resultGroups)
  const removedGroups = mode === 'all' ? groups.filter((group) => !resultGroupSet.has(group)) : []

  return {
    mode,
    changes,
    newGroups,
    removedGroups,
    resultGroups,
    existingAssignmentsCount: changes.filter((change) => knownGroups.has(change.to)).length,
    fallbackMessage,
  }
}

export function applyGroupingChanges(terms, changes, direction = 'forward') {
  const changesById = new Map(changes.map((change) => [change.id, change]))
  return terms.map((term) => {
    const change = changesById.get(term.id)
    if (!change) return term
    const expected = direction === 'reverse' ? change.to : change.from
    const target = direction === 'reverse' ? change.from : change.to
    return term.category === expected ? { ...term, category: target } : term
  })
}
