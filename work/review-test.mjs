import assert from 'node:assert/strict'
import { createReviewQueue, reviewTermInList } from '../src/data/review.js'

const terms = [
  { id: 'a', term: 'A', mastered: false, reviewCount: 0, archived: false },
  { id: 'b', term: 'B', mastered: false, reviewCount: 1, archived: false },
  { id: 'c', term: 'C', mastered: false, reviewCount: 2, archived: false },
  { id: 'd', term: 'D', mastered: true, reviewCount: 1, archived: false },
  { id: 'e', term: 'E', mastered: true, reviewCount: 3, archived: false },
  { id: 'archived', term: 'Archived', mastered: false, reviewCount: 0, archived: true },
]

const queue = createReviewQueue(terms)
assert.deepEqual(queue.map((term) => term.id), ['a', 'b', 'c', 'd', 'e'])

let updated = terms
for (const [index, queued] of queue.entries()) {
  updated = reviewTermInList(updated, queued.id, index % 2 === 0, `2026-08-29T00:0${index}:00.000Z`)
}

assert.deepEqual(queue.map((term) => term.id), ['a', 'b', 'c', 'd', 'e'])
assert.equal(updated.find((term) => term.id === 'a').reviewCount, 1)
assert.equal(updated.find((term) => term.id === 'b').reviewCount, 2)
assert.equal(updated.find((term) => term.id === 'archived').reviewCount, 0)
assert.equal(updated.find((term) => term.id === 'a').fieldUpdatedAt.review, '2026-08-29T00:00:00.000Z')

const nextRound = createReviewQueue(updated)
assert.equal(nextRound.length, 5)
assert.equal(nextRound[0].id, 'b')

console.log('PASS a review round keeps a fixed queue while ratings update the source terms')
console.log('PASS archived terms stay excluded and the next round uses the latest review results')
