import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quietPhones } from '../src/live-freshness-core.ts'

/* The quiet-phone nudge. What it pins: a phone dark past half an hour is
   named with how long; a deliberate pause is respected as an answer, not a
   problem; a phone that never registered a fix says nothing; and the
   quietest phone leads, because it is the one someone is wondering about. */

const NOW = new Date('2026-09-03T22:15:00Z')
const seenAgo = minutes => new Date(NOW.getTime() - minutes * 60_000)

test('a dark phone is named with how long, pauses and strangers excluded', () => {
  const quiet = quietPhones(
    [
      { id: 'p-1', name: "Catherine's phone", lastSeen: seenAgo(48) },
      { id: 'p-2', name: "Adam's phone", lastSeen: seenAgo(1) },
      { id: 'p-3', name: "Kid's phone", lastSeen: seenAgo(300), pausedAt: seenAgo(300) },
      { id: 'p-4', name: 'Never used', lastSeen: null },
    ],
    NOW,
  )
  assert.deepEqual(quiet, [{ id: 'p-1', name: "Catherine's phone", minutesQuiet: 48 }])
})

test('the quietest phone leads when several are dark', () => {
  const quiet = quietPhones(
    [
      { id: 'a', name: 'A', lastSeen: seenAgo(45) },
      { id: 'b', name: 'B', lastSeen: seenAgo(120) },
    ],
    NOW,
  )
  assert.deepEqual(
    quiet.map(p => p.id),
    ['b', 'a'],
  )
  assert.equal(quiet[0].minutesQuiet, 120)
})

test('a nameless registration still gets called something', () => {
  assert.equal(quietPhones([{ id: 'x', lastSeen: seenAgo(60) }], NOW)[0].name, 'A phone')
})
