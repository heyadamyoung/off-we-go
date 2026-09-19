import assert from 'node:assert/strict'
import test from 'node:test'
import { filterRows, orderRows } from '../src/timeline-find-core.ts'
import {
  DAY_HEIGHT,
  LEG_HEIGHT,
  SHOTS_HEIGHT,
  STOP_HEIGHT,
  timelineRows,
  windowRows,
} from '../src/timeline-core.ts'

/* The timeline as a flat list of rows, which is the whole trick.
 *
 * It was a nest — days holding stops holding a row per photograph — and a nest
 * cannot be windowed, so a trip with four thousand pictures on it put four
 * thousand buttons in the document and asked a phone to scroll them. The
 * gallery was fixed for exactly this in its own time and the timeline was left
 * behind.
 *
 * Flattened, every row knows its own height, and the slice on screen is
 * arithmetic rather than a guess.
 */

const stop = (id, rest = {}) => ({ id, name: id, lng: 4.9, lat: 52.4, ...rest })
const shot = (id, stopId, rest = {}) => ({ id, stopId, ...rest })

test('a day heading comes before the stops that belong to it', () => {
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-16' }), stop('b', { day: '2026-09-16' })],
    photos: [],
  })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'stop', 'stop'],
  )
  assert.equal(rows[0].stops, 2)
})

test('the photographs of a stop are one row under it, not one row each', () => {
  /* The whole reason the timeline was unusable. Fourteen pictures from one
     afternoon were fourteen text rows with thumbnails the size of a full
     stop — neither a gallery nor an itinerary. */
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-16' })],
    photos: Array.from({ length: 14 }, (_, nth) => shot(`p${nth}`, 'a')),
  })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'stop', 'shots'],
  )
  assert.equal(rows[2].count, 14)
  assert.ok(rows[2].photos.length < 14, 'the row shows a handful, not the lot')
  /* The viewer opened from a thumbnail still pages through the whole
     afternoon, not the five that happened to fit. */
  assert.equal(rows[2].ordered.length, 14)
})

test('a stop nobody photographed has no picture row at all', () => {
  const rows = timelineRows({ stops: [stop('a', { day: '2026-09-16' })], photos: [] })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'stop'],
  )
})

test('the road out of a stop is its own row, under it', () => {
  const legs = new Map([['a', { minutes: 40, km: 12 }]])
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-16' }), stop('b', { day: '2026-09-16' })],
    photos: [],
    legs,
  })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'stop', 'leg', 'stop'],
  )
})

test('today is marked on its own heading and nowhere else', () => {
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-15' }), stop('b', { day: '2026-09-16' })],
    photos: [],
    today: '2026-09-16',
  })
  const days = rows.filter(row => row.kind === 'day')
  assert.deepEqual(
    days.map(day => day.today),
    [false, true],
  )
})

test('a stop with no date still gets a heading and is still drawn', () => {
  const rows = timelineRows({ stops: [stop('a')], photos: [], today: '2026-09-16' })
  assert.equal(rows[0].kind, 'day')
  assert.equal(rows[0].iso, null)
  assert.equal(rows[0].today, false)
  assert.equal(rows[1].kind, 'stop')
})

test('every row carries the height it will actually be drawn at', () => {
  /* The arithmetic below and the CSS have to agree or the window slides faster
     than the rows inside it. They agree because there is one number. */
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-16' }), stop('b', { day: '2026-09-16' })],
    photos: [shot('p1', 'a')],
    legs: new Map([['a', { minutes: 40, km: 12 }]]),
  })
  assert.deepEqual(
    rows.map(row => row.height),
    [DAY_HEIGHT, STOP_HEIGHT, SHOTS_HEIGHT, LEG_HEIGHT, STOP_HEIGHT],
  )
})

test('an empty trip is no rows rather than a heading over nothing', () => {
  assert.deepEqual(timelineRows({ stops: [], photos: [] }), [])
  assert.deepEqual(timelineRows({}), [])
})

const manyRows = count =>
  Array.from({ length: count }, (_, nth) => ({
    kind: 'stop',
    key: `k${nth}`,
    height: 60,
  }))

test('only the rows on screen are asked for, plus a little either side', () => {
  const rows = manyRows(1000)
  const view = windowRows(rows, { scrolled: 0, viewportHeight: 600 })
  assert.ok(view.rows.length < 60, `drew ${view.rows.length} rows for a ten-row screen`)
  assert.ok(view.rows.length >= 10, 'the screen itself must be full')
  assert.equal(view.above, 0)
})

test('the spacers add up to the rows that were not drawn', () => {
  /* If they do not, the scrollbar lies about how long the trip is and the
     thumb jumps as the window slides. */
  const rows = manyRows(1000)
  const view = windowRows(rows, { scrolled: 12_000, viewportHeight: 600 })
  const drawn = view.rows.reduce((total, row) => total + row.height, 0)
  assert.equal(view.above + drawn + view.below, 60 * 1000)
  assert.ok(view.above > 0 && view.below > 0)
})

test('the window follows the thumb', () => {
  const rows = manyRows(1000)
  const top = windowRows(rows, { scrolled: 0, viewportHeight: 600 })
  const middle = windowRows(rows, { scrolled: 30_000, viewportHeight: 600 })
  assert.notEqual(top.rows[0].key, middle.rows[0].key)
  assert.ok(middle.above <= 30_000, 'the first drawn row must still be above the fold')
})

test('scrolled past the end draws the end rather than nothing', () => {
  const rows = manyRows(20)
  const view = windowRows(rows, { scrolled: 99_999, viewportHeight: 600 })
  assert.ok(view.rows.length > 0)
  assert.equal(view.below, 0)
})

test('rows of different heights are measured, not counted', () => {
  /* A day heading is not a stop is not a strip of photographs, and a window
     that assumes they are is a window that drifts further from the truth the
     further down a long trip somebody reads. */
  const mixed = [
    { kind: 'day', key: 'd', height: 36 },
    { kind: 'stop', key: 's', height: 62 },
    { kind: 'shots', key: 'p', height: 96 },
  ]
  const view = windowRows(mixed, { scrolled: 0, viewportHeight: 40 })
  assert.equal(view.above + view.rows.reduce((t, r) => t + r.height, 0) + view.below, 194)
})

test('nothing to draw is an honest empty rather than a throw', () => {
  const view = windowRows([], { scrolled: 0, viewportHeight: 600 })
  assert.deepEqual(view.rows, [])
  assert.equal(view.above, 0)
  assert.equal(view.below, 0)
})

/* Getting there, in the timeline it happens in.
 *
 * A flight was a whole tab and nothing at all on the one screen whose subject
 * is the order of the day — so a travel day read as a gap between two hotels.
 * This is the plainest thing every itinerary app does and the only one this
 * one did not, and every fact needed for it was already stored: a segment
 * carries an instant, the zone it leaves in, and where it goes.
 */

const leg = (id, departsAt, rest = {}) => ({
  id,
  mode: 'flight',
  fromName: 'Edinburgh',
  toName: 'Amsterdam',
  departsAt,
  departTz: 'UTC',
  ...rest,
})

test('a flight is a row on the day it leaves', () => {
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-16', startsAt: '14:00' })],
    photos: [],
    segments: [leg('g1', '2026-09-16T09:35:00Z')],
  })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'travel', 'stop'],
  )
  assert.equal(rows[0].stops, 1)
  assert.equal(rows[0].journeys, 1, 'a flight is named on the heading, not folded into the stops')
})

test('a flight lands in the hour it leaves at, not at the end of the day', () => {
  const rows = timelineRows({
    stops: [
      stop('morning', { day: '2026-09-16', startsAt: '09:00' }),
      stop('evening', { day: '2026-09-16', startsAt: '19:00' }),
    ],
    photos: [],
    segments: [leg('g1', '2026-09-16T14:30:00Z')],
  })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'stop', 'travel', 'stop'],
  )
})

test('a day that is only travel is still a day of the trip', () => {
  /* The whole point of a travel day: nothing is planned because the day IS the
     flight, and a timeline that skips it says the trip skipped it. */
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-17' })],
    photos: [],
    segments: [leg('g1', '2026-09-16T09:35:00Z')],
  })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'travel', 'day', 'stop'],
  )
  assert.equal(rows[0].iso, '2026-09-16')
})

test('a flight is read on the clock of the airport it leaves from', () => {
  /* Departing 23:35 in Los Angeles is a Tuesday night there and a Wednesday
     morning in UTC. Filed on the wrong day it disappears from the day nobody
     is going to be looking at. */
  const rows = timelineRows({
    stops: [],
    photos: [],
    segments: [leg('g1', '2026-09-17T06:35:00Z', { departTz: 'America/Los_Angeles' })],
  })
  assert.equal(rows[0].kind, 'day')
  assert.equal(rows[0].iso, '2026-09-16')
})

test('a segment with no departure at all is left out rather than guessed at', () => {
  const rows = timelineRows({
    stops: [stop('a', { day: '2026-09-16' })],
    photos: [],
    segments: [{ id: 'g1', mode: 'flight', fromName: 'A', toName: 'B', departsAt: '' }],
  })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['day', 'stop'],
  )
})

/* Newest first, and found by a word: the days turned round with each day
   still read morning to evening, and the rows that carry the words asked
   for under the heading of their day. */

const week = () =>
  timelineRows({
    stops: [
      stop('museum', { name: 'Rijksmuseum', day: '2026-09-12', note: 'Vermeer' }),
      stop('market', { name: 'Albert Cuyp market', day: '2026-09-12' }),
      stop('canal', { name: 'Canal boat', day: '2026-09-13', kind: 'Boat' }),
      stop('loose', { name: 'Somewhere, some day' }),
    ],
    photos: [shot('p1', 'museum', { caption: 'The Milkmaid' }), shot('p2', 'canal')],
    legs: new Map([['museum', { minutes: 12, distanceKm: 1.2 }]]),
    today: '2026-09-13',
  })

test('newest first turns the days round and leaves each day reading morning to evening', () => {
  const rows = week()
  assert.deepEqual(
    rows.map(row => row.key),
    [
      'day:2026-09-12',
      'stop:museum',
      'shots:museum',
      'leg:museum',
      'stop:market',
      'day:2026-09-13',
      'stop:canal',
      'shots:canal',
      'day:undated',
      'stop:loose',
    ],
  )
  assert.deepEqual(
    orderRows(rows, 'newest').map(row => row.key),
    [
      'day:2026-09-13',
      'stop:canal',
      'shots:canal',
      'day:2026-09-12',
      'stop:museum',
      'shots:museum',
      'leg:museum',
      'stop:market',
      'day:undated',
      'stop:loose',
    ],
    'the undated tail stays at the end either way',
  )
  assert.deepEqual(orderRows(rows, 'oldest'), rows)
  assert.deepEqual(orderRows([], 'newest'), [])
})

test('a word finds the rows that carry it, under the heading of their day', () => {
  const rows = week()
  assert.deepEqual(filterRows(rows, '   '), rows, 'nothing asked, nothing hidden')
  assert.deepEqual(
    filterRows(rows, 'rijks').map(row => row.key),
    ['day:2026-09-12', 'stop:museum', 'shots:museum'],
    'a stop found keeps its photographs and loses the road out of it',
  )
  assert.deepEqual(
    filterRows(rows, 'milkmaid').map(row => row.key),
    ['day:2026-09-12', 'stop:museum', 'shots:museum'],
    'a photograph found by its caption keeps the stop it was taken at',
  )
  assert.deepEqual(
    filterRows(rows, 'vermeer market').map(row => row.key),
    [],
    'every word has to be on the same row',
  )
  assert.deepEqual(
    filterRows(rows, 'boat').map(row => row.key),
    ['day:2026-09-13', 'stop:canal', 'shots:canal'],
    'the kind of a stop counts as its words',
  )
  assert.deepEqual(
    filterRows(rows, 'sat 12').map(row => row.key),
    ['day:2026-09-12', 'stop:museum', 'shots:museum', 'stop:market'],
    'a day found by its own name keeps the whole day, without the roads',
  )
  assert.deepEqual(
    filterRows(orderRows(rows, 'newest'), 'canal').map(row => row.key),
    ['day:2026-09-13', 'stop:canal', 'shots:canal'],
    'found in whichever order the days are read',
  )
})

test('a journey is found by its number, its airline and its airports', () => {
  const rows = timelineRows({
    stops: [stop('a', { name: 'Home', day: '2026-09-12' })],
    photos: [],
    segments: [
      {
        id: 'f1',
        mode: 'flight',
        carrier: 'KLM',
        number: 'KL 677',
        fromCode: 'AMS',
        toCode: 'YYC',
        departsAt: '2026-09-12T16:10:00.000Z',
        departTz: 'Europe/Amsterdam',
      },
    ],
  })
  assert.deepEqual(
    filterRows(rows, 'kl 677').map(row => row.key),
    ['day:2026-09-12', 'travel:f1'],
  )
  assert.deepEqual(
    filterRows(rows, 'yyc').map(row => row.key),
    ['day:2026-09-12', 'travel:f1'],
  )
  assert.deepEqual(
    filterRows(rows, 'home').map(row => row.key),
    ['day:2026-09-12', 'stop:a'],
  )
})
