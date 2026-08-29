import { UNGROUPED, normalizeGroupName } from './grouping.js'
import { touchTerm } from './terms.js'

export function isArchived(term) {
  return term?.archived === true
}

export function archivedCategoryFor(term) {
  return normalizeGroupName(term?.archivedCategory || term?.category) || UNGROUPED
}

export function archiveTermInList(terms, id, archivedAt = new Date().toISOString()) {
  return terms.map((term) => {
    if (term.id !== id || isArchived(term)) return term
    return touchTerm(term, {
      archived: true,
      archivedAt,
      archivedCategory: normalizeGroupName(term.category) || UNGROUPED,
    }, 'archive', archivedAt)
  })
}

export function restoreTermInList(terms, id, groups, restoredAt = new Date().toISOString()) {
  const availableGroups = new Set(Array.isArray(groups) ? groups : [])
  return terms.map((term) => {
    if (term.id !== id || !isArchived(term)) return term
    const archivedCategory = archivedCategoryFor(term)
    const category = archivedCategory === UNGROUPED || !availableGroups.has(archivedCategory)
      ? UNGROUPED
      : archivedCategory
    return touchTerm(term, {
      archived: false,
      archivedAt: '',
      archivedCategory: '',
      category,
    }, ['archive', 'category'], restoredAt)
  })
}
