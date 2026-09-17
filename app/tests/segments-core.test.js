import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  connectionGap,
  delayLabel,
  delayMinutes,
  deriveDeadlines,
  makeIt,
  segmentName,
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
      { name: 'Maya', lng: -79.6249, lat: 43.6778 },
      { name: 'Alex', lng: -79.38, lat: 43.65 },
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

/* A departure that moved, said out loud.
 *
 * A gate change has struck the old gate through since the card was written.
 * The departure — the number the whole day hangs off — moved silently: the
 * countdown quietly re-based and nothing anywhere said the plan had changed,
 * so a traveller glancing at the screen could not tell a delay from having
 * misremembered.
 */

test('a departure that never moved has nothing to say about it', () => {
  assert.equal(delayMinutes({ departsAt: '2026-09-19T16:10:00.000Z' }), null)
  assert.equal(delayLabel({ departsAt: '2026-09-19T16:10:00.000Z' }), '')
  assert.equal(
    delayMinutes({ departsAt: '2026-09-19T16:10:00.000Z', departsWas: '2026-09-19T16:10:00.000Z' }),
    null,
  )
})

test('later is positive and earlier is negative, because the sign is the point', () => {
  /* A card that says "brought forward" when it means "put back" is a card
     that makes somebody miss a flight. */
  const back = { departsAt: '2026-09-19T17:40:00.000Z', departsWas: '2026-09-19T16:10:00.000Z' }
  const forward = { departsAt: '2026-09-19T15:50:00.000Z', departsWas: '2026-09-19T16:10:00.000Z' }
  assert.equal(delayMinutes(back), 90)
  assert.equal(delayMinutes(forward), -20)
  assert.equal(delayLabel(back), '1 h 30 later')
  assert.equal(delayLabel(forward), '20 min earlier')
})

test('under an hour reads in minutes, the way anybody would say it', () => {
  assert.equal(
    delayLabel({ departsAt: '2026-09-19T16:45:00.000Z', departsWas: '2026-09-19T16:10:00.000Z' }),
    '35 min later',
  )
})

test('nonsense either side is no claim rather than a wrong one', () => {
  assert.equal(delayMinutes({ departsAt: 'soon', departsWas: '2026-09-19T16:10:00.000Z' }), null)
  assert.equal(delayLabel({ departsAt: '2026-09-19T16:10:00.000Z', departsWas: 'earlier' }), '')
})

/* What to call a leg, in one place.
 *
 * Three surfaces spelled this out — the card, the timeline row and the papers
 * list — each in its own copy of the same two lines, and all three said the
 * airline twice: "KLM KL 677". A flight number already carries its carrier.
 */

test('the airline is not said twice', () => {
  assert.equal(
    segmentName({ carrier: 'KLM', number: 'KL 677', fromName: 'Amsterdam', toName: 'Calgary' }),
    'KL 677 · Amsterdam → Calgary',
  )
})

test('a carrier the number does not carry is kept', () => {
  /* "NS Intercity IC 3155" — the operator's name is not in the service
     number, and dropping it would lose which railway it is. */
  assert.equal(segmentName({ carrier: 'NS Intercity', number: 'IC 3155' }), 'NS Intercity IC 3155')
})

test('whatever a leg actually has is what it is called', () => {
  assert.equal(segmentName({ number: 'KL 677' }), 'KL 677')
  assert.equal(segmentName({ fromName: 'Amsterdam', toName: 'Calgary' }), 'Amsterdam → Calgary')
  assert.equal(segmentName({ mode: 'ferry' }), 'ferry')
})

test('a leg with nothing on it still has a name rather than an empty row', () => {
  assert.equal(segmentName({}), 'Journey')
  assert.equal(segmentName(null), 'Journey')
})
