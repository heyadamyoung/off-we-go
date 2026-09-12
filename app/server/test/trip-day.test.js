import assert from 'node:assert/strict'
import test from 'node:test'
import { isTripDay, tripDayOrNull } from '../src/trip-day.js'

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
