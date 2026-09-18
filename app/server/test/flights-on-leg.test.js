import assert from 'node:assert/strict'
import test from 'node:test'
import { flightOnLeg } from '../src/flights/on-leg.js'

/* The board's last word, as it rides on a leg. What these pin: the slice the
   phone draws is all there — the status and the board's own words, the
   times, the gate, the belt, and everything a traveller would otherwise read
   off the departures board: the check-in zone and desks, the walk to the
   gate, the security queue, the stand; a leg nobody has watched carries
   nothing rather than an empty shape; and where the boards came from is
   said, with when. */

const view = () => ({
  flightNumber: 'EI123',
  status: 'scheduled',
  statusText: 'GO TO GATE',
  boardingStatus: 'go-to-gate',
  gate: '106',
  terminal: '1',
  baggageBelt: null,
  scheduledDeparture: '2026-09-17T21:55:00.000Z',
  estimatedDeparture: '2026-09-17T22:10:00.000Z',
  actualDeparture: null,
  scheduledArrival: '2026-09-18T00:55:00.000Z',
  estimatedArrival: null,
  actualArrival: null,
  aircraft: null,
  sources: ['api.dublinairport.com'],
  source: 'api.dublinairport.com',
  lastUpdated: '2026-09-17T21:40:12.000Z',
  extra: {
    internalFlightId: 'abc',
    statusCode: 2,
    checkinZone: '13',
    checkinDeskRange: '1204-1319',
    goToGateTime: '2026-09-17T21:15:00.000Z',
    walkMinutes: 8,
    securityWaitMinutes: 12,
    preClearance: true,
  },
})

test('everything the departures board would tell you rides on the leg', () => {
  const leg = flightOnLeg(view(), '2026-09-17T21:41:00.000Z')
  assert.equal(leg.status, 'scheduled')
  assert.equal(leg.statusText, 'GO TO GATE')
  assert.equal(leg.boardingStatus, 'go-to-gate')
  assert.equal(leg.gate, '106')
  assert.equal(leg.terminal, '1')
  assert.equal(leg.estimatedDeparture, '2026-09-17T22:10:00.000Z')
  assert.equal(leg.checkinZone, '13')
  assert.equal(leg.checkinDesks, '1204-1319')
  assert.equal(leg.walkMinutes, 8)
  assert.equal(leg.goToGateTime, '2026-09-17T21:15:00.000Z')
  assert.equal(leg.securityWaitMinutes, 12)
  assert.equal(leg.preClearance, true)
  assert.deepEqual(leg.sources, ['api.dublinairport.com'])
  assert.equal(leg.lastUpdated, '2026-09-17T21:40:12.000Z')
  assert.equal(leg.fetchedAt, '2026-09-17T21:41:00.000Z')
  assert.equal('internalFlightId' in leg, false, 'the board’s own ids are not the phone’s business')
})

test('a leg nobody has watched carries nothing, and a thin snapshot carries nulls', () => {
  assert.equal(flightOnLeg(null), null)
  assert.equal(flightOnLeg(undefined, '2026-09-17T21:41:00.000Z'), null)
  assert.equal(flightOnLeg('landed'), null)
  const thin = flightOnLeg({
    flightNumber: 'FR557',
    status: 'landed',
    source: 'api.dublinairport.com',
  })
  assert.equal(thin.status, 'landed')
  assert.equal(thin.gate, null)
  assert.equal(thin.checkinZone, null)
  assert.equal(thin.walkMinutes, null)
  assert.equal(thin.securityWaitMinutes, null)
  assert.equal(thin.preClearance, null)
  assert.deepEqual(
    thin.sources,
    ['api.dublinairport.com'],
    'one source is still where it came from',
  )
  assert.equal(thin.fetchedAt, null)
})

test('a stand and a belt are read from the right ends of the flight', () => {
  const leg = flightOnLeg({
    status: 'landed',
    baggageBelt: '5',
    actualArrival: '2026-09-18T00:48:00.000Z',
    extra: { stand: '171', walkMinutes: 'soon' },
    sources: ['www.torontopearson.com', 'api.dublinairport.com'],
  })
  assert.equal(leg.baggageBelt, '5')
  assert.equal(leg.stand, '171')
  assert.equal(leg.actualArrival, '2026-09-18T00:48:00.000Z')
  assert.equal(leg.walkMinutes, null, 'a walk that is not a number is not a walk')
  assert.deepEqual(leg.sources, ['www.torontopearson.com', 'api.dublinairport.com'])
})
