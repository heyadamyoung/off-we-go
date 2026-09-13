import assert from 'node:assert/strict'
import test from 'node:test'
import {
  endsAfterMidnight,
  isClock,
  minutesOf,
  startMinutes,
  stopTimeLabel,
  windowEndMinutes,
} from '../src/stop-time-core.ts'
import { clockOrNull, timeNoteOrNull } from '../server/src/stop-time.js'

/* A stop's time used to be a text box, and the text box is why one itinerary
   item read 11:20-11:50 and the next one read 2:30 PM. These are the two
   halves of the replacement: the door, which decides what may be stored, and
   the label, which decides how the one stored shape is read. */

test('a clock is two digits, a colon and two digits, in the day', () => {
  assert.equal(isClock('00:00'), true)
  assert.equal(isClock('23:59'), true)
  assert.equal(isClock('09:30'), true)
  assert.equal(isClock('24:00'), false, 'midnight is 00:00 of the next day')
  assert.equal(isClock('23:60'), false)
  assert.equal(isClock('9:30'), false, 'the stored shape is padded')
  assert.equal(isClock('2:30 PM'), false, 'the whole point')
  assert.equal(isClock(''), false)
  assert.equal(isClock(null), false)
  assert.equal(isClock(930), false)
})

test('the door pads what is unambiguous and refuses what is not', () => {
  /* Same three answers as the day's door: the value to store, `null` for a
     stop with no time, and `undefined` meaning refuse — because quietly
     storing null instead throws away a time somebody meant to set. */
  assert.equal(clockOrNull('09:30'), '09:30')
  assert.equal(clockOrNull(' 09:30 '), '09:30')
  assert.equal(clockOrNull('9:30'), '09:30', 'one digit is not ambiguous')
  assert.equal(clockOrNull('14:00:00'), '14:00', 'the shape Postgres hands back')

  assert.equal(clockOrNull(null), null)
  assert.equal(clockOrNull(undefined), null)
  assert.equal(clockOrNull(''), null)
  assert.equal(clockOrNull('   '), null)

  /* Refused rather than guessed at. "2:30" with a PM beside it is the caller
     saying something this column cannot hold, and half-reading it is how a
     stop ends up at half past two in the morning. */
  assert.equal(clockOrNull('2:30 PM'), undefined)
  assert.equal(clockOrNull('14h00'), undefined)
  assert.equal(clockOrNull('24:00'), undefined)
  assert.equal(clockOrNull('evening'), undefined)
  assert.equal(clockOrNull(930), undefined)
})

test('the note keeps the words and never the numbers', () => {
  assert.equal(timeNoteOrNull('Check-in'), 'Check-in')
  assert.equal(timeNoteOrNull('  Doors  '), 'Doors')
  assert.equal(timeNoteOrNull(''), null)
  assert.equal(timeNoteOrNull(null), null)
  assert.equal(timeNoteOrNull(undefined), null)
  assert.equal(timeNoteOrNull(7), undefined, 'refused, like every other door')
})

test('minutes from midnight, for arithmetic rather than for reading', () => {
  assert.equal(minutesOf('00:00'), 0)
  assert.equal(minutesOf('09:30'), 570)
  assert.equal(minutesOf('23:59'), 1439)
  assert.equal(minutesOf('nonsense'), null)
  assert.equal(minutesOf(null), null)
})

test('a stop is over at its end, or at its start when it has no end', () => {
  assert.equal(windowEndMinutes({ startsAt: '11:20', endsAt: '11:50' }), 710)
  assert.equal(windowEndMinutes({ startsAt: '14:00' }), 840, 'a moment ends when it starts')
  assert.equal(windowEndMinutes({ endsAt: '17:00' }), 1020)
  assert.equal(windowEndMinutes({}), null)
  assert.equal(windowEndMinutes({ timeNote: 'Evening' }), null, 'words are not a time')

  /* Across midnight. The end is earlier on the clock than the start, and
     reading it as 01:00 of the same morning would call the stop finished
     twenty-two hours before it begins. Counted from the start of its own day
     instead, so the arithmetic downstream needs no special case. */
  assert.equal(windowEndMinutes({ startsAt: '23:00', endsAt: '01:00' }), 1500)
  assert.equal(endsAfterMidnight({ startsAt: '23:00', endsAt: '01:00' }), true)
  assert.equal(endsAfterMidnight({ startsAt: '09:00', endsAt: '17:00' }), false)
  assert.equal(endsAfterMidnight({ startsAt: '09:00' }), false)

  assert.equal(startMinutes({ startsAt: '09:30', endsAt: '12:30' }), 570)
  assert.equal(startMinutes({ endsAt: '12:30' }), 750, 'one time given is when it happens')
  assert.equal(startMinutes({}), null)
})

test('one clock, everywhere, whoever is reading it', () => {
  /* Twenty-four hour on purpose, and not the reader's own locale. Every
     boarding pass, platform board and hotel confirmation on a trip through
     Europe is written this way; it cannot lose an AM or a PM; it is the same
     width on every row, which is what lets the strip's time column be forty
     pixels wide; and it is what the stored value already is, so nothing has to
     be converted to be believed. Entry is the device's business — the picker
     is a native one and shows whatever the phone shows. */
  assert.equal(stopTimeLabel({ startsAt: '09:30', endsAt: '12:30' }), '09:30 – 12:30')
  assert.equal(stopTimeLabel({ startsAt: '14:00' }), '14:00')
  assert.equal(stopTimeLabel({ endsAt: '17:00' }), '17:00')
  assert.equal(stopTimeLabel({ startsAt: '14:00', endsAt: '14:00' }), '14:00', 'not a range of one')
  assert.equal(stopTimeLabel({}), '')
})

test('the words sit in front of the numbers, and stand alone without them', () => {
  assert.equal(stopTimeLabel({ timeNote: 'Check-in', startsAt: '14:00' }), 'Check-in 14:00')
  assert.equal(stopTimeLabel({ timeNote: 'Evening' }), 'Evening')
  assert.equal(
    stopTimeLabel({ timeNote: 'Doors', startsAt: '19:00', endsAt: '23:00' }),
    'Doors 19:00 – 23:00',
  )
  assert.equal(stopTimeLabel({ timeNote: '  ' }), '')
  assert.equal(stopTimeLabel(null), '')
  assert.equal(stopTimeLabel(undefined), '')
})
