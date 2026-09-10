import assert from 'node:assert/strict'
import test from 'node:test'
import { dayIsoOf, groupByDay, onDay, photoDayIso, tripDays } from '../src/trip-days-core.ts'

/* The trip in the screenshot: Netherlands & Scotland, the first week of
   September, with day chips reading THU 3 SEP, 4, 8, 5, FRI 4 SEP. */
const trip = { startsOn: '2026-09-03', endsOn: '2026-09-10' }

test('the label the app writes reads back as its date', () => {
  assert.equal(dayIsoOf('Thu 3 Sep', trip), '2026-09-03')
  assert.equal(dayIsoOf('Fri 4 Sep', trip), '2026-09-04')
})

test('a bare number is the same day as the label that spells it out', () => {
  /* The actual bug. Before there was a date picker people typed '4', and
     de-duplicating the raw text made '4' and 'Fri 4 Sep' two separate days of
     a trip that only has one of them. */
  assert.equal(dayIsoOf('4', trip), dayIsoOf('Fri 4 Sep', trip))
  assert.equal(dayIsoOf('8', trip), '2026-09-08')
  assert.equal(dayIsoOf('5', trip), '2026-09-05')
})

test('a number the trip covers twice is not guessed at', () => {
  /* A month boundary: '4' could be either. Two answers is no answer, and a
     stop put on the wrong day is worse than one left undated. */
  const across = { startsOn: '2026-08-28', endsOn: '2026-09-10' }
  assert.equal(dayIsoOf('4', across), '2026-09-04', 'only September has a 4th here')
  assert.equal(dayIsoOf('30', across), '2026-08-30')
  const twoMonths = { startsOn: '2026-08-01', endsOn: '2026-09-30' }
  assert.equal(dayIsoOf('4', twoMonths), null, 'August the 4th or September the 4th?')
})

test('a number outside the trip is not a day of it', () => {
  assert.equal(dayIsoOf('20', trip), null)
  assert.equal(dayIsoOf('99', trip), null)
})

test('a date is taken as itself, picker or import', () => {
  assert.equal(dayIsoOf('2026-09-04', trip), '2026-09-04')
  assert.equal(dayIsoOf('2026-09-04T09:30:00.000Z', trip), '2026-09-04')
  // And without a trip to measure against, which a half-filled trip has.
  assert.equal(dayIsoOf('2026-09-04', {}), '2026-09-04')
})

test('the ways somebody might write a date out are read too', () => {
  assert.equal(dayIsoOf('Sep 4', trip), '2026-09-04')
  assert.equal(dayIsoOf('4 September', trip), '2026-09-04')
})

test('nothing is invented from a word that is not a day', () => {
  for (const junk of ['', '   ', 'later', 'Day one', 'tbc', null, undefined]) {
    assert.equal(dayIsoOf(junk, trip), null, JSON.stringify(junk))
  }
})

test('without a trip range, only a real date can be placed', () => {
  /* A label carries no year and a number carries nothing at all; the range is
     what gives either of them a meaning. */
  assert.equal(dayIsoOf('Fri 4 Sep', {}), null)
  assert.equal(dayIsoOf('4', {}), null)
  assert.equal(dayIsoOf('2026-09-04', {}), '2026-09-04')
})

test('days come out oldest first, however the rows arrived', () => {
  /* Sorting labels as strings put Friday before Thursday, which is what the
     itinerary and the chips were both doing. */
  const days = tripDays([{ day: 'Fri 4 Sep' }, { day: 'Thu 3 Sep' }, { day: '8' }], trip)
  assert.deepEqual(
    days.map(day => day.iso),
    ['2026-09-03', '2026-09-04', '2026-09-08'],
  )
})

test('two spellings of one day are one chip', () => {
  const days = tripDays([{ day: '4' }, { day: 'Fri 4 Sep' }, { day: '2026-09-04' }], trip)
  assert.equal(days.length, 1)
  assert.equal(days[0].label, 'Fri 4 Sep', 'and it is drawn the way the app writes it')
})

test('a day nothing can date is shown as written, after the real ones', () => {
  /* Not swept into a single bucket: losing a day is worse than showing an odd
     one, and somebody who typed "tbc" still wants to find what is on it. The
     numbers that started all this do not land here — they resolve. */
  const days = tripDays([{ day: 'tbc' }, { day: 'Thu 3 Sep' }, { day: '4' }], trip)
  assert.deepEqual(
    days.map(day => day.iso),
    ['2026-09-03', '2026-09-04', 'tbc'],
  )
  assert.equal(days.at(-1).label, 'tbc')
})

test('the same odd text twice is still one day', () => {
  const days = tripDays([{ day: 'tbc' }, { day: 'tbc' }], trip)
  assert.equal(days.length, 1)
})

test('a trip with nothing dated has no chips at all', () => {
  assert.deepEqual(tripDays([], trip), [])
  assert.deepEqual(tripDays([{ day: '' }, { day: null }], trip), [])
})

test('days something else knows about are counted too', () => {
  /* Photographs carry their own date, and a day that only has photographs on
     it is still a day of the trip. */
  const days = tripDays([{ day: 'Thu 3 Sep' }], trip, ['2026-09-06', '2026-09-06', null])
  assert.deepEqual(
    days.map(day => day.iso),
    ['2026-09-03', '2026-09-06'],
  )
})

test('a photograph takes its day from its stop', () => {
  /* Where the camera's clock and the itinerary disagree, the itinerary wins:
     a picture taken at a place belongs with that place. */
  const photo = { takenAt: '2026-09-07T22:00:00.000Z' }
  assert.equal(photoDayIso(photo, 'Fri 4 Sep', trip), '2026-09-04')
})

test('a photograph with no stop still has a day of its own', () => {
  /* Before this it took its day from its stop and nothing else, so anything
     filed nowhere could never appear under any day at all. */
  assert.equal(photoDayIso({ takenAt: '2026-09-06T10:00:00.000Z' }, null, trip), '2026-09-06')
  assert.equal(photoDayIso({ takenAt: null }, null, trip), null)
  assert.equal(photoDayIso({ takenAt: 'not a date' }, null, trip), null)
})

test('a chosen day matches by date rather than by spelling', () => {
  /* The chip holds an ISO date; the rows hold whatever they hold. Comparing
     the two as text is how a chip could select nothing. */
  assert.ok(onDay('4', '2026-09-04', trip))
  assert.ok(onDay('Fri 4 Sep', '2026-09-04', trip))
  assert.ok(onDay('2026-09-04', '2026-09-04', trip))
  assert.ok(!onDay('Thu 3 Sep', '2026-09-04', trip))
})

test('a day nothing can date still selects its own rows', () => {
  /* Comparing as written is the fallback when either side cannot be placed —
     without it, choosing such a chip would select nothing at all. */
  assert.ok(onDay('tbc', 'tbc', trip))
  assert.ok(!onDay('tbc', 'later', trip))
  assert.ok(!onDay('Fri 4 Sep', 'tbc', trip))
})

test('a trip with no dates of its own still places its labels', () => {
  /* Guessed from the photographs, which know when they were taken. A trip
     whose range was never filled in is exactly the sort with hand-typed days,
     and without this every one of them would show as raw text. */
  const days = tripDays([{ day: 'Fri 4 Sep' }, { day: '4' }], {}, ['2026-09-05T10:00:00.000Z'])
  assert.equal(days.filter(day => day.label === 'Fri 4 Sep').length, 1, 'both spellings, one day')
})

test('a stop with no day still appears, at the end', () => {
  /* The timeline bug: it grouped by the days it found and drew each group's
     stops, so a stop with no day was in no group and rendered nowhere. An
     itinerary item you just added and cannot see is worse than one under an
     awkward heading. */
  const groups = groupByDay(
    [
      { id: 'a', day: 'Thu 3 Sep' },
      { id: 'b', day: '' },
    ],
    trip,
  )
  assert.deepEqual(
    groups.map(group => group.day?.iso ?? null),
    ['2026-09-03', null],
  )
  assert.deepEqual(
    groups.at(-1).things.map(thing => thing.id),
    ['b'],
  )
})

test('two spellings of a day are one heading, in date order', () => {
  /* Grouping on the raw text made 'Fri 4 Sep' and '4' two headings, and
     ordering on it put Friday above Thursday. */
  const groups = groupByDay(
    [
      { id: 'a', day: 'Fri 4 Sep' },
      { id: 'b', day: 'Thu 3 Sep' },
      { id: 'c', day: '4' },
    ],
    trip,
  )
  assert.deepEqual(
    groups.map(group => group.day?.label),
    ['Thu 3 Sep', 'Fri 4 Sep'],
  )
  assert.deepEqual(
    groups[1].things.map(thing => thing.id),
    ['a', 'c'],
  )
})

test('grouping keeps the order things arrived in within a day', () => {
  /* The itinerary is already sorted by time before it gets here; regrouping
     must not shuffle it. */
  const groups = groupByDay(
    [
      { id: 'a', day: '3' },
      { id: 'b', day: '3' },
      { id: 'c', day: '3' },
    ],
    trip,
  )
  assert.deepEqual(
    groups[0].things.map(thing => thing.id),
    ['a', 'b', 'c'],
  )
})

test('a day nothing can date gets its own heading, before the undated', () => {
  const groups = groupByDay(
    [
      { id: 'a', day: 'tbc' },
      { id: 'b', day: null },
      { id: 'c', day: 'Thu 3 Sep' },
    ],
    trip,
  )
  assert.deepEqual(
    groups.map(group => group.day?.label ?? null),
    ['Thu 3 Sep', 'tbc', null],
  )
})

test('grouping and the chips agree on which days there are', () => {
  /* Two places deciding what a day is, is how they came to disagree. */
  const rows = [{ day: 'Fri 4 Sep' }, { day: '4' }, { day: 'Thu 3 Sep' }, { day: 'tbc' }]
  assert.deepEqual(
    groupByDay(rows, trip)
      .filter(group => group.day)
      .map(group => group.day.iso),
    tripDays(rows, trip).map(day => day.iso),
  )
})
