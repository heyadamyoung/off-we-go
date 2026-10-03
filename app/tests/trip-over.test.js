import assert from 'node:assert/strict'
import test from 'node:test'
import { tripEndedAt, tripIsOver } from '../src/trip-over-core'

/* The client's copy of "is this trip over".
 *
 * The authority is the server: `tripIsOver` in `server/src/trip-day.js`
 * refuses a position once the trip has ended, and that is what actually stops
 * a phone reporting. This file is here because the screens have to agree with
 * it to the same instant — the Phones tab withholds the "share this phone"
 * button exactly when the server would refuse the first fix, and any
 * disagreement is a button that lies in one direction or the other.
 *
 * So the instants below are the same instants as in
 * `server/test/trip-day.test.js`, on purpose. Two copies of a rule are only
 * safe while something holds them together, and this is that something.
 */

test('the client ends a trip at the same instant the server does', () => {
  assert.equal(new Date(tripEndedAt('2026-09-06')).toISOString(), '2026-09-07T12:00:00.000Z')

  const at = iso => Date.parse(iso)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-06T23:00:00Z')), false)
  /* Four in the afternoon on the last day in Honolulu — still the trip. */
  assert.equal(tripIsOver('2026-09-06', at('2026-09-07T02:00:00Z')), false)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-07T11:59:59Z')), false)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-07T12:00:00Z')), true)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-08T00:00:00Z')), true)
})

test('a trip with no last day is never over, so sharing stays on offer', () => {
  for (const none of [null, undefined, '']) {
    assert.equal(tripEndedAt(none), null, String(none))
    assert.equal(tripIsOver(none, Date.parse('2099-01-01T00:00:00Z')), false, String(none))
  }
})

test('a last day that is not a date leaves the trip running', () => {
  for (const wrong of ['Fri 4 Sep', '2026-02-30', '2026-9-6']) {
    assert.equal(tripEndedAt(wrong), null, wrong)
    assert.equal(tripIsOver(wrong, Date.parse('2099-01-01T00:00:00Z')), false, wrong)
  }
})

test('the rule reads the trip, not the browser, so a laptop in the wrong zone agrees', () => {
  /* `tripProgress` in the home slice works in the viewer's own zone, which is
     right for drawing a globe and wrong for this: two people looking at the
     same trip from Dublin and Honolulu must see the same answer to "has
     sharing stopped", because the server only has one. Passing the instant in
     is what makes that testable, and nothing in this module reads a clock of
     its own. */
  const ends = '2026-09-06'
  const instant = Date.parse('2026-09-07T06:00:00Z')
  assert.equal(tripIsOver(ends, instant), false)
  assert.equal(tripIsOver(ends, instant + 6 * 60 * 60_000), true)
})
