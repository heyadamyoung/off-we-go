import assert from 'node:assert/strict'
import test from 'node:test'
import { airborneLeg, PLANE_AFTER_MS, PLANE_BEFORE_MS, planeOnMap } from '../src/plane-core.ts'

/* The plane on the map. What these pin: the sky is asked about the one
   flight leg that could be up, inside the server's own window and never
   about one the board has landed; and what was heard becomes a marker with
   its heading and a title that says how old the word is. */

const M = 60_000
const NOW = Date.parse('2026-09-14T12:00:00.000Z')

const leg = (rest = {}) => ({
  id: 'kl677',
  mode: 'flight',
  carrier: 'KLM',
  number: 'KL 677',
  fromName: 'Amsterdam',
  toName: 'Calgary',
  departsAt: '2026-09-14T11:10:00.000Z',
  arrivesAt: '2026-09-14T20:00:00.000Z',
  passengers: [],
  status: 'scheduled',
  ...rest,
})

test('the sky is asked about a flight that could be up, and about nothing else', () => {
  assert.equal(airborneLeg([leg()], NOW).id, 'kl677')
  const departs = Date.parse('2026-09-14T11:10:00.000Z')
  assert.equal(airborneLeg([leg()], departs - PLANE_BEFORE_MS - M), null, 'too early to ask')
  assert.equal(airborneLeg([leg()], departs - PLANE_BEFORE_MS + M).id, 'kl677')
  const arrives = Date.parse('2026-09-14T20:00:00.000Z')
  assert.equal(airborneLeg([leg()], arrives + PLANE_AFTER_MS + M), null, 'long since down')
  assert.equal(airborneLeg([leg({ mode: 'train' })], NOW), null)
  assert.equal(airborneLeg([leg({ status: 'cancelled' })], NOW), null)
  assert.equal(
    airborneLeg([leg({ flight: { status: 'landed' } })], NOW),
    null,
    'the board landed it',
  )
  assert.equal(airborneLeg([leg({ flight: { status: 'departed' } })], NOW).id, 'kl677')
  /* The first that could be up: a train to the airport never is. */
  assert.equal(airborneLeg([leg({ id: 'train', mode: 'train' }), leg()], NOW).id, 'kl677')
})

test('what was heard becomes a marker pointing the way it is going, with its age', () => {
  const heard = {
    callsign: 'KLM677',
    registration: 'PH-BHA',
    type: 'B789',
    onGround: false,
    airborne: true,
    altitudeFeet: 36025,
    groundSpeedKnots: 471,
    trackDegrees: 289,
    lat: 55.1,
    lon: -20.2,
    heardAt: new Date(NOW - 3 * M).toISOString(),
  }
  const plane = planeOnMap(leg(), heard, NOW)
  assert.deepEqual(plane, {
    key: 'plane:kl677',
    lng: -20.2,
    lat: 55.1,
    heading: 289,
    title: 'KL 677 · in the air at 36000 ft · heard 3 min ago',
    airborne: true,
    heardAt: heard.heardAt,
  })
  const parked = planeOnMap(
    leg(),
    {
      ...heard,
      airborne: false,
      onGround: true,
      altitudeFeet: null,
      trackDegrees: null,
      heardAt: null,
    },
    NOW,
  )
  assert.equal(parked.title, 'KL 677 · on the ground')
  assert.equal(parked.heading, null)
  assert.equal(planeOnMap(leg(), null, NOW), null)
  assert.equal(planeOnMap(leg(), { ...heard, lat: null }, NOW), null, 'heard, but not where')
})
