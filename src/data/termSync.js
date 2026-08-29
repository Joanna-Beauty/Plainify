import {
  mergeTermRecords,
  normalizeTermRecord,
  termKey,
  tombstoneBlocksTerm,
} from './terms.js'

function findMatchingIndex(terms, candidate) {
  const id = String(candidate.id || '')
  const key = termKey(candidate.term)
  return terms.findIndex((term) => (
    (id && term.id === id)
    || (key && termKey(term.term) === key)
  ))
}

function upsertTerm(terms, candidate, preferExisting = true) {
  const index = findMatchingIndex(terms, candidate)
  if (index < 0) return false
  const existing = terms[index]
  terms[index] = preferExisting
    ? mergeTermRecords(existing, candidate)
    : mergeTermRecords(candidate, existing)
  return true
}

export function mergeExtensionTerms(currentTerms, incomingTerms, tombstones = {}) {
  const merged = []
  for (const current of currentTerms) {
    const normalized = normalizeTermRecord(current, { now: current.createdAt })
    if (!normalized.term) continue
    if (!upsertTerm(merged, normalized)) merged.push(normalized)
  }

  const additions = []
  for (const incoming of incomingTerms) {
    const normalized = normalizeTermRecord(incoming, { now: incoming.createdAt })
    if (!normalized.term || tombstoneBlocksTerm(tombstones, normalized)) continue
    if (upsertTerm(merged, normalized)) continue
    if (!upsertTerm(additions, normalized)) additions.push(normalized)
  }

  const result = [...additions, ...merged]
  return JSON.stringify(result) === JSON.stringify(currentTerms) ? currentTerms : result
}
