import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  connectionGap,
  deriveDeadlines,
  makeIt,
  nextDeadline,
  segmentDay,
  segmentFace,
} from '../src/segments-core.ts'

/* The getting-there layer's arithmetic. What these pin: the client's offsets
   agree with the server's to the minute; the card's face follows the clock;
   connections judge themselves against what the walk actually needs; and the
   make-it meter tells each traveller the truth about their own legs. */

const FLIGHT = {
  id: 's-1',
  mode: 'flight',
  fromName: 'Toronto Pearson',
  fromCode: 'YYZ',
  fromLng: -79.6248,
  fromLat: 43.6777,
  toName: 'Regina',
  departsAt: '2026-09-19T16:10:00.000Z',
  arrivesAt: '2026-09-19T18:25:00.000Z',
  passengers: [],
  status: 'scheduled',
  deadlines: deriveDeadlines('flight', '2026-09-19T16:10:00.000Z'),
}

test('the client and the server derive the same countdown', () => {
  // The values pinned in server/test/segments.test.js, to the minute.
  assert.equal(FLIGHT.deadlines.checkinClosesAt, '2026-09-19T15:10:00.000Z')
  assert.equal(FLIGHT.deadlines.bagsCloseAt, '2026-09-19T15:25:00.000Z')
  assert.equal(FLIGHT.deadlines.boardingAt, '2026-09-19T15:30:00.000Z')
  assert.equal(FLIGHT.deadlines.doorsAt, '2026-09-19T15:55:00.000Z')
  assert.equal(
    deriveDeadlines('train', '2026-09-19T13:15:00.000Z').doorsAt,
    '2026-09-19T13:13:00.000Z',
  )
  assert.equal(deriveDeadlines('drive', '2026-09-19T10:00:00.000Z'), null)
})

test('the card wears the face the clock chooses', () => {
  const at = value => new Date(value).getTime()
  assert.equal(segmentFace(FLIGHT, at('2026-09-10T12:00:00Z')), 'future')
  assert.equal(segmentFace(FLIGHT, at('2026-09-18T20:00:00Z')), 'eve')
  assert.equal(segmentFace(FLIGHT, at('2026-09-19T10:00:00Z')), 'day')
  assert.equal(segmentFace(FLIGHT, at('2026-09-19T15:00:00Z')), 'day')
  assert.equal(segmentFace(FLIGHT, at('2026-09-19T21:00:00Z')), 'past')
  assert.equal(segmentFace({ ...FLIGHT, status: 'done' }, at('2026-09-10T12:00:00Z')), 'past')
})

test('the next deadline is the next one, and none after the last', () => {
  const before = new Date('2026-09-19T15:20:00Z').getTime()
  assert.deepEqual(nextDeadline(FLIGHT, before), {
    key: 'bagsCloseAt',
    label: 'Bags by',
    at: '2026-09-19T15:25:00.000Z',
  })
  assert.equal(nextDeadline(FLIGHT, new Date('2026-09-19T16:00:00Z').getTime()), null)
})

test('a connection judges itself against what the change actually needs', () => {
  const train = {
    ...FLIGHT,
    id: 's-0',
    mode: 'train',
    arrivesAt: '2026-09-19T13:40:00.000Z',
  }
  const wide = connectionGap(train, FLIGHT, 9)
  assert.equal(wide.minutes, 150)
  assert.equal(wide.verdict, 'roomy')
  const squeezed = connectionGap({ ...train, arrivesAt: '2026-09-19T14:40:00.000Z' }, FLIGHT, 9)
  assert.equal(squeezed.verdict, 'tight', '90 minutes against 69 needed, under double')
  const doomed = connectionGap({ ...train, arrivesAt: '2026-09-19T15:45:00.000Z' }, FLIGHT, 9)
  assert.equal(doomed.verdict, 'short')
})

test('the make-it meter tells each traveller the truth about their legs', () => {
  // 45 minutes to doors. One traveller at the terminal, one 20 km out —
  // about 43 minutes of driving against those 45.
  const now = new Date('2026-09-19T15:10:00.000Z').getTime()
  const verdicts = makeIt(
    FLIGHT,
    [
      { name: 'Adam', lng: -79.6249, lat: 43.6778 },
      { name: 'Catherine', lng: -79.38, lat: 43.65 },
    ],
    now,
  )
  assert.equal(verdicts.minutesLeft, 45)
  assert.equal(verdicts.hardLabel, 'doors')
  assert.equal(verdicts.people[0].state, 'here')
  assert.equal(verdicts.people[1].state, 'tight')
  assert.equal(verdicts.verdict, 'tight')

  const everyoneLate = makeIt(FLIGHT, [{ name: 'C', lng: -79.38, lat: 43.65 }], now + 40 * 60_000)
  assert.equal(everyoneLate.verdict, 'late')
  assert.equal(makeIt({ ...FLIGHT, fromLng: null }, [], now), null, 'no coordinates, no verdict')
})

test('a segment files under the day it departs, where it departs', () => {
  assert.equal(segmentDay({ ...FLIGHT, departTz: 'America/Toronto' }, '2026-09-01'), 19)
  assert.equal(segmentDay(FLIGHT, null), null)
})
