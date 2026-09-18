import assert from 'node:assert/strict'
import test from 'node:test'
import { byDeparture, legDay, legOver, travelLayout } from '../src/travel-order-core.ts'

/* The Travel tab's order: the leg that matters now on top, the rest folded. */

const NOW = Date.parse('2026-09-18T12:00:00Z')
const iso = minutes => new Date(NOW + minutes * 60_000).toISOString()

const leg = (id, departs, arrives, over = {}) => ({
  id,
  mode: 'flight',
  fromName: 'A',
  toName: 'B',
  departsAt: iso(departs),
  arrivesAt: iso(arrives),
  passengers: [],
  status: 'scheduled',
  ...over,
})

test('the leg on top is the one in progress, or the next to leave', () => {
  const drive = leg('drive', -180, -120, { mode: 'drive' })
  const flight = leg('flight', 60, 480)
  const onward = leg('onward', 600, 660, { mode: 'train' })
  const layout = travelLayout([onward, flight, drive], NOW)
  assert.equal(layout.active.id, 'flight', 'the drive arrived; the flight is next')
  assert.deepEqual(
    layout.later.map(l => l.id),
    ['onward'],
  )
  assert.deepEqual(
    layout.earlier.map(l => l.id),
    ['drive'],
  )
  // in the air: still the one on top
  assert.equal(travelLayout([drive, flight, onward], NOW + 120 * 60_000).active.id, 'flight')
  // landed: the onward train takes over, the flight goes behind
  const after = travelLayout([drive, flight, onward], NOW + 481 * 60_000)
  assert.equal(after.active.id, 'onward')
  assert.deepEqual(
    after.earlier.map(l => l.id),
    ['drive', 'flight'],
  )
})

test('a leg is behind you once it has arrived, by the board when it has spoken', () => {
  assert.equal(legOver(leg('x', -120, -30), NOW), true)
  assert.equal(legOver(leg('x', -120, 30), NOW), false, 'still in the air')
  assert.equal(legOver(leg('x', -120, 30, { status: 'done' }), NOW), true, 'somebody said so')
  // the board's actual arrival outranks the timetable, either way
  const early = leg('x', -120, 30, { flight: { status: 'landed', actualArrival: iso(-5) } })
  assert.equal(legOver(early, NOW), true)
  const late = leg('x', -120, -30, { flight: { status: 'delayed', actualArrival: iso(20) } })
  assert.equal(legOver(late, NOW), false)
  // cancelled is not arrived: it stays on top until its hour has passed
  assert.equal(legOver(leg('x', 60, 120, { status: 'cancelled' }), NOW), false)
  // no arrival known: the departure stands in
  assert.equal(legOver(leg('x', -10, null), NOW), true)
})

test('with every leg behind you, nothing is on top and all of them are earlier', () => {
  const layout = travelLayout([leg('a', -300, -240), leg('b', -200, -100)], NOW)
  assert.equal(layout.active, null)
  assert.deepEqual(layout.later, [])
  assert.deepEqual(
    layout.earlier.map(l => l.id),
    ['a', 'b'],
  )
  assert.deepEqual(travelLayout([], NOW), { active: null, later: [], earlier: [] })
})

test('legs are read in the order they leave, whatever order they arrived in', () => {
  const ordered = byDeparture([leg('c', 300, 400), leg('a', 10, 20), leg('b', 100, 200)])
  assert.deepEqual(
    ordered.map(l => l.id),
    ['a', 'b', 'c'],
  )
  // a leg with no readable departure goes last, and does not throw
  const odd = byDeparture([leg('z', 0, 0, { departsAt: 'soon' }), leg('a', 10, 20)])
  assert.deepEqual(
    odd.map(l => l.id),
    ['a', 'z'],
  )
})

test('the day a leg leaves is said where it leaves', () => {
  assert.equal(legDay('2026-09-20T23:30:00Z', 'Europe/Amsterdam'), 'Mon 21 Sept')
  assert.equal(legDay('2026-09-20T23:30:00Z', 'America/Edmonton'), 'Sun 20 Sept')
  assert.equal(legDay(null), '')
  assert.equal(legDay('soon'), '')
})
