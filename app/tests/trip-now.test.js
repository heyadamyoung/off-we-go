import assert from 'node:assert/strict'
import test from 'node:test'
import { tripNow } from '../src/trip-now-core.ts'

/* What is happening on this trip, right now.
 *
 * The map screen has always been reactive: it answers what you tap and says
 * nothing on its own. The bar over it is day chips and a list of rows, which
 * is a filter rather than an answer — so the map shows where everything is and
 * nothing tells you what is going on.
 *
 * Nothing here computes anything the app did not already know. Where the
 * phones are is worked out in live-stop-progress-core, what the calendar has
 * gone past in live-schedule-core, and this only gathers the answer into the
 * shape a sentence needs. Two people read that sentence — somebody following
 * along at home and somebody standing in the rain — and they want the same
 * facts with a different emphasis, which is why there is one of these and two
 * renderings of it.
 */

const at = (day, time) => new Date(`${day}T${time}:00`)

const stop = (id, name, day, startsAt, endsAt) => ({ id, name, day, startsAt, endsAt })

const DAY = '2026-05-14'
const YESTERDAY = '2026-05-13'

const ITINERARY = [
  stop('a', 'Harbour breakfast', DAY, '08:00', '09:00'),
  stop('b', 'Cliff walk', DAY, '09:45', '10:45'),
  stop('c', 'Lighthouse', DAY, '13:00', '14:30'),
  stop('d', 'Ferry', DAY, '17:20', '17:50'),
  stop('e', 'Inland loch', '2026-05-15', '10:00', '12:00'),
]

const shot = (id, day, when) => ({ id, day, when })

test('what is done today is what the phone saw and what the clock went past', () => {
  const now = tripNow(
    {
      stops: ITINERARY,
      photos: [],
      visitedStopIds: ['a'],
      behindStopIds: ['b'],
      destination: ITINERARY[2],
    },
    at(DAY, '11:46'),
  )
  assert.deepEqual(
    now.done.map(s => s.id),
    ['a', 'b'],
    'in the order the day ran, not the order the evidence arrived',
  )
})

test('yesterday is not today, however far behind it is', () => {
  /* The whole trip is behind you eventually. "What have they done today" is a
     question about today. */
  const now = tripNow(
    {
      stops: [stop('old', 'Airport', YESTERDAY, '06:00', '07:00'), ...ITINERARY],
      photos: [],
      visitedStopIds: ['old', 'a'],
      behindStopIds: ['old', 'a', 'b'],
      destination: ITINERARY[2],
    },
    at(DAY, '11:46'),
  )
  assert.deepEqual(
    now.done.map(s => s.id),
    ['a', 'b'],
  )
})

test('what is next carries how long until it was due', () => {
  const now = tripNow(
    {
      stops: ITINERARY,
      photos: [],
      visitedStopIds: ['a'],
      behindStopIds: ['b'],
      destination: ITINERARY[2],
    },
    at(DAY, '11:46'),
  )
  assert.equal(now.next?.stop.id, 'c')
  assert.equal(now.next?.inMinutes, 74, 'thirteen hundred is an hour and a quarter off')
})

test('a thing that was due already says so, rather than rounding to nought', () => {
  /* Being late is the most useful thing the line can say, and a countdown that
     stops at zero is a countdown that lies about it. */
  const now = tripNow(
    {
      stops: ITINERARY,
      photos: [],
      visitedStopIds: [],
      behindStopIds: ['a', 'b'],
      destination: ITINERARY[2],
    },
    at(DAY, '13:25'),
  )
  assert.equal(now.next?.inMinutes, -25)
})

test('a next thing on another day has no countdown, only a date', () => {
  /* Minutes until tomorrow morning is a number nobody reads. */
  const now = tripNow(
    {
      stops: ITINERARY,
      photos: [],
      visitedStopIds: ['a', 'b', 'c', 'd'],
      behindStopIds: [],
      destination: ITINERARY[4],
    },
    at(DAY, '19:00'),
  )
  assert.equal(now.next?.stop.id, 'e')
  assert.equal(now.next?.inMinutes, null)
})

test('a next thing with no hour of its own has no countdown either', () => {
  const loose = stop('f', 'Somewhere', DAY, null, null)
  const now = tripNow(
    { stops: [...ITINERARY, loose], photos: [], destination: loose },
    at(DAY, '11:46'),
  )
  assert.equal(now.next?.inMinutes, null)
})

test('nothing ahead is nothing ahead, not a guess', () => {
  const now = tripNow({ stops: ITINERARY, photos: [], destination: null }, at(DAY, '23:00'))
  assert.equal(now.next, null)
})

test('today’s photographs come back newest first, and counted', () => {
  const photos = [
    shot('p1', DAY, `${DAY}T08:10:00Z`),
    shot('p2', DAY, `${DAY}T10:30:00Z`),
    shot('p3', YESTERDAY, `${YESTERDAY}T20:00:00Z`),
    shot('p4', DAY, `${DAY}T09:15:00Z`),
  ]
  const now = tripNow({ stops: ITINERARY, photos, destination: null }, at(DAY, '11:46'))
  assert.deepEqual(
    now.fresh.map(p => p.id),
    ['p2', 'p4', 'p1'],
  )
  assert.equal(now.todayCount, 3)
})

test('only a handful are handed over, however many were taken', () => {
  /* The sheet shows a row of thumbnails, not a gallery — that is one tap away
     and already does this better. */
  const photos = Array.from({ length: 40 }, (_, nth) =>
    shot(`p${nth}`, DAY, `${DAY}T0${nth % 9}:00:00Z`),
  )
  const now = tripNow({ stops: ITINERARY, photos, destination: null }, at(DAY, '11:46'))
  assert.equal(now.fresh.length, 6)
  assert.equal(now.todayCount, 40, 'and the count is still the truth')
})

test('a photograph with no day of its own is nobody’s today', () => {
  const now = tripNow(
    { stops: ITINERARY, photos: [shot('p', null, null)], destination: null },
    at(DAY, '11:46'),
  )
  assert.deepEqual(now.fresh, [])
  assert.equal(now.todayCount, 0)
})

test('an empty trip answers emptily rather than throwing', () => {
  const now = tripNow({}, at(DAY, '11:46'))
  assert.deepEqual(now.done, [])
  assert.equal(now.next, null)
  assert.deepEqual(now.fresh, [])
  assert.equal(now.todayCount, 0)
})

test('the day the trip is on is the day it reports', () => {
  /* Not the machine's date: the traveller's own midnight decides whether their
     day is over, and the suite pins a clock for exactly that reason. */
  const now = tripNow({ stops: ITINERARY, photos: [], destination: null }, at(DAY, '00:20'))
  assert.equal(now.today, DAY)
})
