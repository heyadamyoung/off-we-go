import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveDeadlines, rescheduled } from '../src/segments.js'

/* When the departure moves, the whole day moves with it.
 *
 * A segment's deadlines are worked out from its departure once, at write time,
 * and then never again. So a flight put back ninety minutes kept boarding,
 * bags and doors at the times they would have been — and every countdown on
 * the card, every notification on the phone, and the meter that tells a family
 * whether they will make it were all still counting down to a moment that had
 * stopped existing. Confidently wrong on the one screen with consequences,
 * which is worse than saying nothing.
 *
 * Two rules do the work, and the second is the one that matters. Deadlines
 * nobody has touched are derived again from the new departure. Deadlines
 * somebody set by hand are SHIFTED by the same amount instead — a traveller
 * who wrote their own boarding time meant it, and a delay is not a reason to
 * throw their answer away.
 */

const FLIGHT = {
  mode: 'flight',
  departs_at: '2026-09-19T16:10:00.000Z',
  arrives_at: '2026-09-19T18:40:00.000Z',
  deadlines: deriveDeadlines('flight', '2026-09-19T16:10:00.000Z'),
  status: 'scheduled',
  departs_was: null,
}

const later = '2026-09-19T17:40:00.000Z' // ninety minutes on
const earlier = '2026-09-19T15:40:00.000Z'

test('a departure that has not moved changes nothing at all', () => {
  assert.equal(rescheduled(FLIGHT, {}), null)
  assert.equal(rescheduled(FLIGHT, { departsAt: FLIGHT.departs_at }), null)
  assert.equal(rescheduled(FLIGHT, { gate: 'E19' }), null)
})

test('the countdown is derived again from where the departure went', () => {
  const moved = rescheduled(FLIGHT, { departsAt: later })
  assert.deepEqual(moved.deadlines, deriveDeadlines('flight', later))
})

test('a deadline somebody typed is moved, not thrown away', () => {
  /* The whole point. A traveller who wrote their own boarding time meant it,
     and a delay is not a reason to overrule them — it is a reason to move
     what they said by the same ninety minutes. */
  const byHand = {
    ...FLIGHT,
    deadlines: { ...FLIGHT.deadlines, boardingAt: '2026-09-19T15:00:00.000Z' },
  }
  const moved = rescheduled(byHand, { departsAt: later })
  assert.equal(moved.deadlines.boardingAt, '2026-09-19T16:30:00.000Z')
  /* And the ones nobody touched still land where the template says. */
  assert.equal(moved.deadlines.doorsAt, deriveDeadlines('flight', later).doorsAt)
})

test('where it was is kept, the way a changed gate is kept', () => {
  const moved = rescheduled(FLIGHT, { departsAt: later })
  assert.equal(moved.departsWas, FLIGHT.departs_at)
})

test('the first time it moved is the time it was meant to go', () => {
  /* Put back twice, the card must still say what the ticket said — not what
     the last delay said. Two delays are one delay of the sum, to everybody
     except an airline. */
  const once = { ...FLIGHT, departs_was: FLIGHT.departs_at, departs_at: later }
  const twice = rescheduled(once, { departsAt: '2026-09-19T19:00:00.000Z' })
  assert.equal(twice.departsWas, FLIGHT.departs_at)
})

test('later is a delay and earlier is a change, said in the status', () => {
  assert.equal(rescheduled(FLIGHT, { departsAt: later }).status, 'delayed')
  assert.equal(rescheduled(FLIGHT, { departsAt: earlier }).status, 'changed')
})

test('a status somebody states outright is not argued with', () => {
  /* Cancelled is cancelled, whatever the clock did. */
  const moved = rescheduled(FLIGHT, { departsAt: later, status: 'cancelled' })
  assert.equal(moved.status, 'cancelled')
})

test('a flight already flown is not re-labelled by a correction', () => {
  const flown = { ...FLIGHT, status: 'done' }
  assert.equal(rescheduled(flown, { departsAt: later }).status, 'done')
})

test('the arrival moves with the departure when nothing else says otherwise', () => {
  /* A delayed flight lands late. Leaving the arrival where it was makes a
     two-and-a-half hour flight look like an hour, and the connection after it
     look comfortable. */
  const moved = rescheduled(FLIGHT, { departsAt: later })
  assert.equal(moved.arrivesAt, '2026-09-19T20:10:00.000Z')
})

test('an arrival sent in the same breath is the one that is kept', () => {
  const moved = rescheduled(FLIGHT, { departsAt: later, arrivesAt: '2026-09-19T19:55:00.000Z' })
  assert.equal(moved.arrivesAt, undefined, 'the caller said, so nothing here should say')
})

test('a drive has no deadlines to move and still records the change', () => {
  const drive = {
    mode: 'drive',
    departs_at: FLIGHT.departs_at,
    deadlines: null,
    status: 'scheduled',
  }
  const moved = rescheduled(drive, { departsAt: later })
  assert.equal(moved.deadlines, null)
  assert.equal(moved.departsWas, FLIGHT.departs_at)
  assert.equal(moved.status, 'delayed')
})

test('a departure that is not a time moves nothing', () => {
  assert.equal(rescheduled(FLIGHT, { departsAt: 'tomorrow-ish' }), null)
  assert.equal(rescheduled({ ...FLIGHT, departs_at: null }, { departsAt: later }), null)
})
