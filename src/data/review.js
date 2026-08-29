import { isArchived } from './archive.js'
import { touchTerm } from './terms.js'

export const REVIEW_BATCH_SIZE = 5

export function createReviewQueue(terms, limit = REVIEW_BATCH_SIZE) {
  return [...terms]
    .filter((term) => !isArchived(term))
    .sort((a, b) => (
      Number(a.mastered) - Number(b.mastered)
      || Number(a.reviewCount || 0) - Number(b.reviewCount || 0)
    ))
    .slice(0, limit)
}

export function reviewTermInList(terms, id, remembered, reviewedAt = new Date().toISOString()) {
  return terms.map((term) => term.id === id ? touchTerm(term, {
    mastered: Boolean(remembered),
    reviewCount: Number(term.reviewCount || 0) + 1,
    lastReviewedAt: reviewedAt,
  }, 'review', reviewedAt) : term)
}
