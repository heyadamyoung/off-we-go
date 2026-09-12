import assert from 'node:assert/strict'
import test from 'node:test'
import { dayIsoOf, groupByDay, onDay, photoDayIso, tripDays } from '../src/trip-days-core.ts'

/* A day is a date. That is the whole contract now.

   It used to be whatever somebody had typed — 'Fri 4 Sep', '4', 'Sep 4', 'tbc'
   — and this file was mostly about reading each of those back against the
   trip's own range. Migrations 025, 026 and 029 converted what was stored, the
   API refuses anything else, and the reader is gone. What is left here is the
   one rule, and a guard against the readings creeping back. */

test('a date is taken as itself, picker or import', () => {
  assert.equal(dayIsoOf('2026-09-04'), '2026-09-04')
  // A photograph's capture time arrives as an instant; the day is its date.
  assert.equal(dayIsoOf('2026-09-04T09:30:00.000Z'), '2026-09-04')
  assert.equal(dayIsoOf(' 2026-09-04 '), '2026-09-04')
})

test('a date that is not a date is not a day', () => {
  /* The shape alone is not enough, and a Date that rolls February over into
     March would file a stop on a day the trip does not have. */
  assert.equal(dayIsoOf('2026-02-30'), null)
  assert.equal(dayIsoOf('2026-13-01'), null)
})

test('none of the old spellings are read any more', () => {
  /* The point of the removal, kept honest.

     Every one of these used to resolve, against the trip's dates, into the day
     it plainly meant — and that reader is exactly why the same stop could be
     two chips: two screens asking the question got two answers. They are all
     no day now, which is visible and fixable in a tap, rather than a value
     that means something slightly different everywhere it is read. */
  for (const was of ['Thu 3 Sep', 'Fri 4 Sep', '4', '8', 'Sep 4', '4 September', '2026/09/04']) {
    assert.equal(dayIsoOf(was), null, was)
  }
})

test('nothing is invented from a word that is not a day', () => {
  for (const junk of ['', '   ', 'later', 'Day one', 'tbc', 'all', 'all-days', null, undefined]) {
    assert.equal(dayIsoOf(junk), null, JSON.stringify(junk))
  }
})

test('days come out oldest first, however the rows arrived', () => {
  /* Sorting labels as strings put Friday before Thursday, which is what the
     itinerary and the chips were both doing before a date was the identity. */
  const days = tripDays([{ day: '2026-09-04' }, { day: '2026-09-03' }, { day: '2026-09-08' }])
  assert.deepEqual(
    days.map(day => day.iso),
    ['2026-09-03', '2026-09-04', '2026-09-08'],
  )
  assert.equal(days[1].label, 'Fri 4 Sep', 'and each is drawn the way the app writes it')
})

test('one date is one chip, however many rows are on it', () => {
  const days = tripDays([{ day: '2026-09-04' }, { day: '2026-09-04T18:00:00.000Z' }])
  assert.equal(days.length, 1)
  assert.equal(days[0].label, 'Fri 4 Sep')
})

test('a trip with nothing dated has no chips at all', () => {
  assert.deepEqual(tripDays([]), [])
  assert.deepEqual(tripDays([{ day: '' }, { day: null }]), [])
  // And a leftover that is not a date is not a chip either.
  assert.deepEqual(tripDays([{ day: 'tbc' }]), [])
})

test('days something else knows about are counted too', () => {
  /* Photographs carry their own date, and a day that only has photographs on
     it is still a day of the trip. */
  const days = tripDays([{ day: '2026-09-03' }], ['2026-09-06', '2026-09-06', null])
  assert.deepEqual(
    days.map(day => day.iso),
    ['2026-09-03', '2026-09-06'],
  )
})

test('a photograph takes its day from its stop', () => {
  /* Where the camera's clock and the itinerary disagree, the itinerary wins:
     a picture taken at a place belongs with that place. */
  assert.equal(photoDayIso({ takenAt: '2026-09-07T22:00:00.000Z' }, '2026-09-04'), '2026-09-04')
})

test('a photograph with no stop still has a day of its own', () => {
  /* Before this it took its day from its stop and nothing else, so anything
     filed nowhere could never appear under any day at all. */
  assert.equal(photoDayIso({ takenAt: '2026-09-06T10:00:00.000Z' }, null), '2026-09-06')
  assert.equal(photoDayIso({ takenAt: null }, null), null)
  assert.equal(photoDayIso({ takenAt: 'not a date' }, null), null)
})

test('the day is read from the field a photograph actually arrives with', () => {
  /* The server calls it `when`; only an upload on its way up carries
     `takenAt`. Asking only about the spelling the server never sends is how
     this went unnoticed: a photograph loaded from the API and filed nowhere
     had no day at all, so it fell out of the timeline, out of the by-date
     grouping, and off the map. */
  assert.equal(photoDayIso({ when: '2026-09-06T10:00:00.000Z' }, null), '2026-09-06')
  assert.equal(photoDayIso({ when: null }, null), null)
  assert.equal(photoDayIso({ when: 'not a date' }, null), null)

  // A stop still outranks both, and takenAt still outranks when.
  assert.equal(photoDayIso({ when: '2026-09-06T10:00:00.000Z' }, '2026-09-04'), '2026-09-04')
  assert.equal(
    photoDayIso({ takenAt: '2026-09-05T10:00:00.000Z', when: '2026-09-06T10:00:00.000Z' }, null),
    '2026-09-05',
  )
})

test('a stop whose day is a leftover falls back to its own dateless self', () => {
  /* A row written before the door was shut. It does not take the photograph's
     day with it and it does not invent one. */
  assert.equal(photoDayIso({ when: '2026-09-06T10:00:00.000Z' }, 'tbc'), '2026-09-06')
})

test('a chosen day matches by date', () => {
  assert.ok(onDay('2026-09-04', '2026-09-04'))
  assert.ok(onDay('2026-09-04T08:00:00.000Z', '2026-09-04'), 'an instant is its date')
  assert.ok(!onDay('2026-09-03', '2026-09-04'))
})

test('a leftover day selects nothing, including itself', () => {
  /* It used to compare as written when either side could not be placed, so a
     'tbc' chip still found its 'tbc' rows. There is no such chip to click now
     — tripDays does not offer one — so the fallback only served to make a
     value that is not a date behave as though it were. */
  assert.ok(!onDay('tbc', 'tbc'))
  assert.ok(!onDay('tbc', '2026-09-04'))
  assert.ok(!onDay('2026-09-04', 'tbc'))
})

test('a stop with no day still appears, at the end', () => {
  /* The timeline bug: it grouped by the days it found and drew each group's
     stops, so a stop with no day was in no group and rendered nowhere. An
     itinerary item you just added and cannot see is worse than one under an
     awkward heading. */
  const groups = groupByDay([
    { id: 'a', day: '2026-09-03' },
    { id: 'b', day: '' },
  ])
  assert.deepEqual(
    groups.map(group => group.day?.iso ?? null),
    ['2026-09-03', null],
  )
  assert.deepEqual(
    groups.at(-1).things.map(thing => thing.id),
    ['b'],
  )
})

test('a leftover day is drawn with the undated, not as a day of its own', () => {
  /* It used to get a heading of its own, labelled with the text, because the
     text was somebody's typing and worth keeping. Nothing can type one now, so
     a heading reading 'tbc' beside the real days is a heading for a value that
     should not exist — and it is still drawn, which is what matters. */
  const groups = groupByDay([
    { id: 'a', day: 'tbc' },
    { id: 'b', day: null },
    { id: 'c', day: '2026-09-03' },
  ])
  assert.deepEqual(
    groups.map(group => group.day?.label ?? null),
    ['Thu 3 Sep', null],
  )
  assert.deepEqual(
    groups.at(-1).things.map(thing => thing.id),
    ['a', 'b'],
  )
})

test('grouping keeps the order things arrived in within a day', () => {
  /* The itinerary is already sorted by time before it gets here; regrouping
     must not shuffle it. */
  const groups = groupByDay([
    { id: 'a', day: '2026-09-03' },
    { id: 'b', day: '2026-09-03' },
    { id: 'c', day: '2026-09-03' },
  ])
  assert.deepEqual(
    groups[0].things.map(thing => thing.id),
    ['a', 'b', 'c'],
  )
})

test('grouping and the chips agree on which days there are', () => {
  /* Two places deciding what a day is, is how they came to disagree. */
  const rows = [{ day: '2026-09-04' }, { day: '2026-09-03' }, { day: 'tbc' }]
  assert.deepEqual(
    groupByDay(rows)
      .filter(group => group.day)
      .map(group => group.day.iso),
    tripDays(rows).map(day => day.iso),
  )
})
