import assert from 'node:assert/strict'
import test from 'node:test'
import {
  driftLabel,
  driftMinutes,
  stayLabel,
  stayMinutes,
  visitLabel,
  zoneClock,
} from '../src/stop-visit-core.ts'

/* The plan and what happened, said in one breath.
 *
 * "Planned 09:45 · arrived 10:20, left 11:40" is the one sentence an itinerary
 * app that also carries a phone can write and an itinerary app on its own
 * cannot. TripIt and Wanderlog own the plan and have no idea what happened;
 * a location history owns what happened and has no plan to hold it against.
 *
 * The arithmetic is all about one trap. A plan is a wall clock — 09:45, the
 * way the ticket prints it — and an arrival is an absolute instant. Read the
 * instant on the wrong wall and the feature is worse than useless: a follower
 * in Sydney is told their family reached the Rijksmuseum at twenty past seven
 * in the evening, and never trusts a number in this app again.
 */

const AMSTERDAM = 'Europe/Amsterdam'

const visit = (rest = {}) => ({
  day: '2026-09-16',
  startsAt: '09:45',
  visitZone: AMSTERDAM,
  ...rest,
})

test('an instant is read on the wall clock of the place it happened', () => {
  /* 08:20 UTC is twenty past ten in Amsterdam in September. */
  assert.equal(zoneClock('2026-09-16T08:20:00Z', AMSTERDAM), '10:20')
})

test('a nonsense zone falls back rather than throwing the row away', () => {
  assert.equal(typeof zoneClock('2026-09-16T08:20:00Z', 'Mars/Olympus'), 'string')
  assert.equal(zoneClock('2026-09-16T08:20:00Z', null).length, 5)
})

test('nothing to read is an empty string, not the word null', () => {
  assert.equal(zoneClock(null, AMSTERDAM), '')
  assert.equal(zoneClock('not a date', AMSTERDAM), '')
})

test('a whole visit reads as an arrival and a departure', () => {
  const label = visitLabel(
    visit({ arrivedAt: '2026-09-16T08:20:00Z', leftAt: '2026-09-16T09:40:00Z' }),
  )
  assert.equal(label, 'arrived 10:20, left 11:40')
})

test('a visit still running says only what it knows', () => {
  /* A phone that goes quiet has not left anywhere, and the row must not imply
     that it has. */
  assert.equal(visitLabel(visit({ arrivedAt: '2026-09-16T08:20:00Z' })), 'arrived 10:20')
})

test('a stop nobody has reached yet says nothing at all', () => {
  assert.equal(visitLabel(visit()), '')
  assert.equal(visitLabel(null), '')
})

test('late is the wall clock against the plan, in minutes', () => {
  assert.equal(driftMinutes(visit({ arrivedAt: '2026-09-16T08:20:00Z' })), 35)
})

test('early is the same sum the other way round', () => {
  assert.equal(driftMinutes(visit({ arrivedAt: '2026-09-16T07:25:00Z' })), -20)
})

test('a plan with no time, or a stop nobody reached, has no drift to report', () => {
  assert.equal(driftMinutes(visit({ startsAt: null, arrivedAt: '2026-09-16T08:20:00Z' })), null)
  assert.equal(driftMinutes(visit()), null)
})

test('arriving after midnight is minutes late, not a day early', () => {
  /* Planned for ten to midnight, there at ten past. Read as clock times alone
     that is twenty-three hours and forty minutes EARLY, which is the kind of
     wrong that makes somebody stop reading the column. */
  const late = visit({
    day: '2026-09-16',
    startsAt: '23:50',
    arrivedAt: '2026-09-16T22:10:00Z',
  })
  assert.equal(driftMinutes(late), 20)
})

test('a few minutes either way is on time, because it is', () => {
  assert.equal(driftLabel(visit({ arrivedAt: '2026-09-16T07:47:00Z' })), 'on time')
  assert.equal(driftLabel(visit({ arrivedAt: '2026-09-16T07:44:00Z' })), 'on time')
})

test('the words for late and early, at the sizes people say them in', () => {
  assert.equal(driftLabel(visit({ arrivedAt: '2026-09-16T08:20:00Z' })), '35 min late')
  assert.equal(driftLabel(visit({ arrivedAt: '2026-09-16T07:25:00Z' })), '20 min early')
  assert.equal(driftLabel(visit({ arrivedAt: '2026-09-16T09:50:00Z' })), '2 h 05 late')
  assert.equal(driftLabel(visit()), '')
})

test('how long they were there, when both ends are known', () => {
  const afternoon = visit({ arrivedAt: '2026-09-16T08:20:00Z', leftAt: '2026-09-16T09:40:00Z' })
  assert.equal(stayMinutes(afternoon), 80)
  assert.equal(stayLabel(afternoon), '1 h 20 there')
  assert.equal(stayLabel(visit({ arrivedAt: '2026-09-16T08:20:00Z' })), '')
})

test('a short stay is minutes and a long one is hours', () => {
  assert.equal(
    stayLabel(visit({ arrivedAt: '2026-09-16T08:20:00Z', leftAt: '2026-09-16T08:55:00Z' })),
    '35 min there',
  )
})

test('none of it needs a zone to survive without one', () => {
  /* A phone that registered before it knew its timezone still took the fix.
     The row reads in the viewer's own clock rather than not at all. */
  const unknown = visit({ visitZone: null, arrivedAt: '2026-09-16T08:20:00Z' })
  assert.equal(visitLabel(unknown).startsWith('arrived '), true)
  assert.equal(typeof driftMinutes(unknown), 'number')
})
