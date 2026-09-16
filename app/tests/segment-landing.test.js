import assert from 'node:assert/strict'
import test from 'node:test'
import { landedSegments } from '../src/segment-arrival-core.ts'

/* Did they land?
 *
 * The one question a family at home actually asks on a travel day, and the
 * app has been able to answer it all along without a word from any airline:
 * the phones are on the plane, and when they are near the far airport and not
 * moving at five hundred miles an hour, the plane is on the ground.
 *
 * The rule is the arrival rule, pointed at the other end of a journey. What it
 * adds is the only thing a journey has that a stop does not — a departure, and
 * therefore a before and an after. Standing at Schiphol the morning of a
 * flight FROM Schiphol is not landing at Schiphol.
 */

const AMS = { lng: 4.7683, lat: 52.3105 }
const YYC = { lng: -114.0134, lat: 51.1215 }

const flight = (rest = {}) => ({
  id: 'g1',
  mode: 'flight',
  fromName: 'Amsterdam',
  toName: 'Calgary',
  fromLng: AMS.lng,
  fromLat: AMS.lat,
  toLng: YYC.lng,
  toLat: YYC.lat,
  departsAt: '2026-09-19T16:10:00.000Z',
  ...rest,
})

const near = (place, at, metres = 0, rest = {}) => ({
  lng: place.lng,
  lat: place.lat + metres / 111_320,
  at: new Date(at),
  ...rest,
})

test('a phone at the far end after the departure means they landed', () => {
  const landed = landedSegments([flight()], [near(YYC, '2026-09-19T20:30:00Z')])
  assert.deepEqual(landed, ['g1'])
})

test('standing at the airport you are leaving from is not landing', () => {
  /* The whole reason a journey needs a rule of its own. */
  const landed = landedSegments([flight()], [near(AMS, '2026-09-19T15:00:00Z')])
  assert.deepEqual(landed, [])
})

test('being there before the flight left is not landing either', () => {
  /* A connection through the same airport a day earlier, or somebody who
     lives near it. The fix has to come after the wheels went up. */
  const landed = landedSegments([flight()], [near(YYC, '2026-09-18T20:30:00Z')])
  assert.deepEqual(landed, [])
})

test('a vague fix that could be at the airport counts, because airports are big', () => {
  const landed = landedSegments(
    [flight()],
    [near(YYC, '2026-09-19T20:30:00Z', 900, { accuracy: 700 })],
  )
  assert.deepEqual(landed, ['g1'])
})

test('a plane passing overhead has not landed', () => {
  /* Cruising, or on approach. Ground speed rules it out the way it rules out
     a tram through a square. */
  const over = landedSegments([flight()], [near(YYC, '2026-09-19T20:30:00Z', 0, { speed: 180 })])
  assert.deepEqual(over, [])
})

test('a journey with nowhere to land is left alone rather than guessed at', () => {
  const nowhere = flight({ toLng: null, toLat: null })
  assert.deepEqual(landedSegments([nowhere], [near(YYC, '2026-09-19T20:30:00Z')]), [])
})

test('a journey somebody marked done is landed, whatever the trail says', () => {
  /* Somebody saying so outranks anything a sensor has to offer — the same
     rule the itinerary already follows for a finished stop. */
  const said = flight({ status: 'done' })
  assert.deepEqual(landedSegments([said], []), ['g1'])
})

test('several journeys come back in the order they were flown', () => {
  const first = flight({ id: 'g1' })
  const second = flight({
    id: 'g2',
    departsAt: '2026-09-20T09:00:00.000Z',
    toLng: AMS.lng,
    toLat: AMS.lat,
  })
  const landed = landedSegments(
    [first, second],
    [near(AMS, '2026-09-20T17:00:00Z'), near(YYC, '2026-09-19T20:30:00Z')],
  )
  assert.deepEqual(landed, ['g1', 'g2'])
})

test('nothing to go on is nothing claimed, rather than a throw', () => {
  assert.deepEqual(landedSegments([], []), [])
  assert.deepEqual(landedSegments(null, null), [])
  assert.deepEqual(landedSegments([flight()], []), [])
})
