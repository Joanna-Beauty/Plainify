function termKey(term) {
  return String(term || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function fillMissingFields(primary, fallback) {
  const explanation = primary.explanation || fallback.explanation || ''
  const analogy = primary.analogy || fallback.analogy || ''
  const sourceUrl = primary.sourceUrl || fallback.sourceUrl || ''
  const source = primary.sourceUrl ? primary.source : fallback.source || primary.source
  const status = explanation ? 'ready' : primary.status
  const archived = primary.archived === true || fallback.archived === true
  const archivedAt = archived ? String(primary.archivedAt || fallback.archivedAt || '') : ''
  const archivedCategory = archived
    ? String(primary.archivedCategory || fallback.archivedCategory || primary.category || fallback.category || '未分组')
    : ''
  const mastered = archived ? true : Boolean(primary.mastered)
  if (explanation === primary.explanation
    && analogy === primary.analogy
    && sourceUrl === primary.sourceUrl
    && source === primary.source
    && status === primary.status
    && archived === primary.archived
    && archivedAt === primary.archivedAt
    && archivedCategory === primary.archivedCategory
    && mastered === primary.mastered) return primary
  return {
    ...primary,
    explanation,
    analogy,
    source,
    sourceUrl,
    status,
    archived,
    archivedAt,
    archivedCategory,
    mastered,
  }
}

export function mergeExtensionTerms(currentTerms, incomingTerms) {
  const incomingByName = new Map()
  for (const incoming of incomingTerms) {
    const key = termKey(incoming.term)
    if (!key) continue
    const existing = incomingByName.get(key)
    incomingByName.set(key, existing ? fillMissingFields(existing, incoming) : incoming)
  }

  const mergedTerms = []
  const currentIndexByName = new Map()
  let changed = false

  for (const term of currentTerms) {
    const key = termKey(term.term)
    const existingIndex = currentIndexByName.get(key)
    if (existingIndex !== undefined) {
      mergedTerms[existingIndex] = fillMissingFields(mergedTerms[existingIndex], term)
      changed = true
      continue
    }

    const incoming = incomingByName.get(key)
    const merged = incoming ? fillMissingFields(term, incoming) : term
    if (merged !== term) changed = true
    currentIndexByName.set(key, mergedTerms.length)
    mergedTerms.push(merged)
    incomingByName.delete(key)
  }

  if (incomingByName.size) {
    mergedTerms.unshift(...incomingByName.values())
    changed = true
  }
  return changed ? mergedTerms : currentTerms
}
