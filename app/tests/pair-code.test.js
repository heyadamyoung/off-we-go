import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPairCode,
  normalizePairCode,
  pairCodeLifeWords,
  spellPairCode,
} from '../src/pair-code-core.ts'

test('a typed code is forgiven its spaces, dashes and case, and read in two halves', () => {
  assert.equal(normalizePairCode(' k7m-4pq '), 'K7M4PQ')
  assert.equal(isPairCode(normalizePairCode('K7M 4PQ')), true)
  assert.equal(isPairCode('K7M4P'), false)
  assert.equal(spellPairCode('K7M4PQ'), 'K7M 4PQ')
  assert.equal(spellPairCode('k7m'), 'K7M')
})

test('a code says how long it has left, and nothing once it is gone', () => {
  const at = Date.parse('2026-09-19T16:00:00Z')
  assert.equal(pairCodeLifeWords('2026-09-19T16:14:30Z', at), '15 minutes')
  assert.equal(pairCodeLifeWords('2026-09-19T16:00:40Z', at), 'less than a minute')
  assert.equal(pairCodeLifeWords('2026-09-19T15:59:00Z', at), null)
  assert.equal(pairCodeLifeWords('nonsense', at), null)
})
