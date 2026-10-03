import assert from 'node:assert/strict'
import test from 'node:test'
import { isTripDay, tripDayOrNull, tripEndedAt, tripIsOver } from '../src/trip-day.js'

/* A stop's day is a calendar date. This is the door that keeps it one. */

test('a calendar date is a day', () => {
  assert.equal(isTripDay('2026-09-04'), true)
  assert.equal(tripDayOrNull('2026-09-04'), '2026-09-04')
})

test('the shapes people used to type are not', () => {
  /* Every one of these was in the database before there was a picker, and
     migration 025 exists to convert them. Accepting them again puts the mess
     back one stop at a time. */
  for (const was of ['Fri 4 Sep', '4', 'Sep 4', '4 September', 'tbc', 'all', 'all-days']) {
    assert.equal(isTripDay(was), false, was)
  }
})

test('a number is not a day, which is how a stop came to sit on the 10th of nothing', () => {
  /* The assistant's tool declared this field an integer, so asked for today's
     date it sent 10. */
  assert.equal(isTripDay(10), false)
  assert.equal(isTripDay('10'), false)
})

test('a date-shaped thing that is not a date is not a day', () => {
  assert.equal(isTripDay('2026-02-30'), false)
  assert.equal(isTripDay('2026-13-01'), false)
  assert.equal(isTripDay('0000-00-00'), false)
})

test('an instant is not a day either — the day is the part before the T', () => {
  /* Deliberate. A stop holds a date, and something handing over a timestamp
     has not decided which day it means in whose timezone. */
  assert.equal(isTripDay('2026-09-04T09:30:00.000Z'), false)
})

test('nothing is a perfectly good answer, and means no day', () => {
  assert.equal(tripDayOrNull(''), null)
  assert.equal(tripDayOrNull(null), null)
  assert.equal(tripDayOrNull(undefined), null)
  assert.equal(tripDayOrNull('   '), null)
})

test('and something unreadable is refused rather than quietly dropped', () => {
  /* The difference that matters: a caller sending nothing means "no day", and
     a caller sending 'Fri 4 Sep' has made a mistake worth hearing about. */
  assert.equal(tripDayOrNull('Fri 4 Sep'), undefined)
  assert.equal(tripDayOrNull(10), undefined)
})

test('surrounding space is trimmed rather than refused', () => {
  assert.equal(tripDayOrNull(' 2026-09-04 '), '2026-09-04')
})

/* And when a trip is over, which is the question that stops a phone reporting.
 *
 * These instants are mirrored in `app/tests/trip-over.test.js` against the
 * client's copy of the rule. The two files assert the same numbers on purpose:
 * the Phones tab withholds the "share this phone" button exactly when the
 * server would refuse the first fix, and a disagreement between them is a
 * button that lies in one direction or the other.
 */

test('a trip is over once its last day has finished everywhere on Earth', () => {
  /* '2026-09-06' names no instant on its own. The last clock to let that date
     go is the one furthest behind UTC, so the trip ends at noon UTC on the
     7th — and until then it is still somebody's last day somewhere. */
  assert.equal(new Date(tripEndedAt('2026-09-06')).toISOString(), '2026-09-07T12:00:00.000Z')

  const at = iso => Date.parse(iso)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-06T23:00:00Z')), false)
  /* Four in the afternoon on the last day in Honolulu. This is the reading
     that a naive UTC-midnight rule gets wrong, and it is the whole reason the
     rule is written in instants. */
  assert.equal(tripIsOver('2026-09-06', at('2026-09-07T02:00:00Z')), false)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-07T11:59:59Z')), false)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-07T12:00:00Z')), true)
  assert.equal(tripIsOver('2026-09-06', at('2026-09-08T00:00:00Z')), true)
})

test('a trip with no last day is not over, and never becomes over', () => {
  /* Most trips are planned before they have dates. Reading "we have not
     decided yet" as "it has finished" would turn location sharing off for
     everybody who had not filled in a box. */
  for (const none of [null, undefined, '']) {
    assert.equal(tripEndedAt(none), null, String(none))
    assert.equal(tripIsOver(none, Date.parse('2099-01-01T00:00:00Z')), false, String(none))
  }
})

test('a last day that is not a date leaves the trip running', () => {
  /* `trips.ends_on` is a `date` column, so this is unreachable from the
     database and only a bug could produce it. It fails towards keeping a live
     trip's map working rather than towards cutting travellers off over a
     parse error — the same direction `tripDayOrNull` refuses rather than
     quietly storing null. */
  for (const wrong of ['Fri 4 Sep', '2026-02-30', '2026-9-6', 10]) {
    assert.equal(tripEndedAt(wrong), null, String(wrong))
    assert.equal(tripIsOver(wrong, Date.parse('2099-01-01T00:00:00Z')), false, String(wrong))
  }
})
