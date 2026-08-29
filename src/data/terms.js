import { UNGROUPED, normalizeGroupName } from './grouping.js'

export const TERM_FIELD_SCOPES = ['content', 'category', 'review', 'archive']

export function normalizeTermText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function termKey(value) {
  return normalizeTermText(value).toLocaleLowerCase('zh-CN')
}

function validTimestamp(value, fallback = '') {
  const timestamp = String(value || '')
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback
}

function latestTimestamp(...values) {
  return values
    .map((value) => validTimestamp(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || ''
}

function earliestTimestamp(...values) {
  return values
    .map((value) => validTimestamp(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || ''
}

export function normalizeTermRecord(rawTerm = {}, options = {}) {
  const now = validTimestamp(options.now) || new Date().toISOString()
  const term = normalizeTermText(rawTerm.term)
  const explanation = String(rawTerm.explanation || '')
  const archived = rawTerm.archived === true
  const createdAt = validTimestamp(rawTerm.createdAt, now)
  const baseUpdatedAt = validTimestamp(rawTerm.updatedAt, createdAt)
  const archivedAt = archived ? validTimestamp(rawTerm.archivedAt) : ''
  const lastReviewedAt = validTimestamp(rawTerm.lastReviewedAt)
  const fieldUpdatedAt = {
    content: validTimestamp(rawTerm.fieldUpdatedAt?.content, baseUpdatedAt),
    category: validTimestamp(rawTerm.fieldUpdatedAt?.category, baseUpdatedAt),
    review: validTimestamp(rawTerm.fieldUpdatedAt?.review, lastReviewedAt || baseUpdatedAt),
    archive: validTimestamp(rawTerm.fieldUpdatedAt?.archive, archivedAt || baseUpdatedAt),
  }
  const updatedAt = latestTimestamp(baseUpdatedAt, ...Object.values(fieldUpdatedAt)) || createdAt
  const category = normalizeGroupName(rawTerm.category) || UNGROUPED

  return {
    ...rawTerm,
    id: String(rawTerm.id || options.id || ''),
    term,
    explanation,
    analogy: String(rawTerm.analogy || ''),
    category,
    source: String(rawTerm.source ?? options.source ?? '来自网页插件'),
    sourceUrl: String(rawTerm.sourceUrl || ''),
    createdAt,
    updatedAt,
    fieldUpdatedAt,
    reviewCount: Math.max(0, Number(rawTerm.reviewCount || 0)),
    mastered: Boolean(rawTerm.mastered),
    lastReviewedAt,
    archived,
    archivedAt,
    archivedCategory: archived
      ? normalizeGroupName(rawTerm.archivedCategory || category) || UNGROUPED
      : '',
    status: explanation ? 'ready' : 'pending',
  }
}

export function normalizeTermList(terms) {
  let changed = false
  const normalized = (Array.isArray(terms) ? terms : []).flatMap((term) => {
    const next = normalizeTermRecord(term, { now: term?.createdAt })
    if (!next.term) {
      changed = true
      return []
    }
    if (JSON.stringify(next) !== JSON.stringify(term)) changed = true
    return [next]
  })
  return changed ? normalized : terms
}

export function touchTerm(term, changes, scopes, updatedAt = new Date().toISOString()) {
  const current = normalizeTermRecord(term, { now: updatedAt })
  const nextScopes = Array.isArray(scopes) ? scopes : [scopes]
  const fieldUpdatedAt = { ...current.fieldUpdatedAt }
  for (const scope of nextScopes) {
    if (TERM_FIELD_SCOPES.includes(scope)) fieldUpdatedAt[scope] = updatedAt
  }
  return normalizeTermRecord({
    ...current,
    ...changes,
    updatedAt,
    fieldUpdatedAt,
  }, { now: updatedAt })
}

export function stampChangedTerms(previousTerms, nextTerms, scopes, updatedAt = new Date().toISOString()) {
  const previousById = new Map(previousTerms.map((term) => [term.id, term]))
  return nextTerms.map((term) => {
    const previous = previousById.get(term.id)
    return previous && previous !== term ? touchTerm(term, {}, scopes, updatedAt) : term
  })
}

function scopeSource(primary, fallback, scope) {
  const primaryTime = Date.parse(primary.fieldUpdatedAt[scope]) || 0
  const fallbackTime = Date.parse(fallback.fieldUpdatedAt[scope]) || 0
  if (scope === 'content' && fallbackTime === primaryTime) {
    const contentScore = (term) => ['term', 'explanation', 'analogy', 'source', 'sourceUrl']
      .filter((field) => String(term[field] || '').trim()).length
    if (contentScore(fallback) > contentScore(primary)) return fallback
  }
  return fallbackTime > primaryTime ? fallback : primary
}

export function mergeTermRecords(primaryRecord, fallbackRecord) {
  const primary = normalizeTermRecord(primaryRecord, { now: primaryRecord?.createdAt })
  const fallback = normalizeTermRecord(fallbackRecord, { now: fallbackRecord?.createdAt })
  const content = scopeSource(primary, fallback, 'content')
  const category = scopeSource(primary, fallback, 'category')
  const review = scopeSource(primary, fallback, 'review')
  const archive = scopeSource(primary, fallback, 'archive')
  const fieldUpdatedAt = Object.fromEntries(TERM_FIELD_SCOPES.map((scope) => [
    scope,
    latestTimestamp(primary.fieldUpdatedAt[scope], fallback.fieldUpdatedAt[scope]),
  ]))

  return normalizeTermRecord({
    ...fallback,
    ...primary,
    id: primary.id || fallback.id,
    term: content.term,
    explanation: content.explanation,
    analogy: content.analogy,
    source: content.source,
    sourceUrl: content.sourceUrl,
    category: category.category,
    reviewCount: review.reviewCount,
    mastered: review.mastered,
    lastReviewedAt: review.lastReviewedAt,
    archived: archive.archived,
    archivedAt: archive.archivedAt,
    archivedCategory: archive.archivedCategory,
    createdAt: earliestTimestamp(primary.createdAt, fallback.createdAt),
    updatedAt: latestTimestamp(primary.updatedAt, fallback.updatedAt, ...Object.values(fieldUpdatedAt)),
    fieldUpdatedAt,
  }, { now: primary.createdAt || fallback.createdAt })
}

export function createTermTombstone(term, deletedAt = new Date().toISOString()) {
  return {
    id: String(term.id || ''),
    term: normalizeTermText(term.term),
    deletedAt,
  }
}

export function tombstoneBlocksTerm(tombstones, term) {
  const key = termKey(term.term)
  const tombstone = tombstones?.[key]
    || Object.values(tombstones || {}).find((item) => item.id && item.id === term.id)
  if (!tombstone) return false
  return (Date.parse(term.updatedAt || term.createdAt) || 0) <= (Date.parse(tombstone.deletedAt) || 0)
}

export function clearSupersededTombstones(tombstones, terms) {
  let changed = false
  const next = { ...(tombstones || {}) }
  for (const term of terms) {
    const key = termKey(term.term)
    const tombstoneEntry = Object.entries(next).find(([storedKey, item]) => (
      storedKey === key || (item.id && item.id === term.id)
    ))
    if (!tombstoneEntry) continue
    if ((Date.parse(term.updatedAt || term.createdAt) || 0) > (Date.parse(tombstoneEntry[1].deletedAt) || 0)) {
      delete next[tombstoneEntry[0]]
      changed = true
    }
  }
  return changed ? next : tombstones
}
