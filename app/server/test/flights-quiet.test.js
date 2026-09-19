import assert from 'node:assert/strict'
import test from 'node:test'
import { keepFarEnd, keepNearEnd } from '../src/flights/quiet.js'

/* Each end's last word about its own end outlives the board that said it
   going quiet; the other board's later word about the whole flight — a
   landing, a cancellation — outranks it. */

const DEPARTED = {
  status: 'departed',
  statusText: 'Departed',
  gate: 'C34',
  terminal: '1',
  boardingStatus: 'closed',
  scheduledDeparture: '2026-09-20T22:35:00.000Z',
  estimatedDeparture: null,
  actualDeparture: '2026-09-20T22:41:00.000Z',
  aircraft: 'Boeing 787-9',
  extra: { checkinZone: 'Aisle 3' },
  sources: ['gtaa-fl-prod.azureedge.net'],
}

const FAR_ONLY = {
  status: 'expected',
  statusText: 'Expected 06:05',
  gate: null,
  terminal: null,
  boardingStatus: null,
  scheduledDeparture: null,
  estimatedDeparture: null,
  actualDeparture: null,
  aircraft: '789',
  sources: ['api.dublinairport.com'],
}

test('the near end keeps what the departures board last said, and a departed flight stays departed', () => {
  const kept = keepNearEnd(FAR_ONLY, DEPARTED)
  assert.equal(kept.status, 'departed')
  assert.equal(kept.statusText, 'Departed')
  assert.equal(kept.gate, 'C34')
  assert.equal(kept.terminal, '1')
  assert.equal(kept.boardingStatus, 'closed')
  assert.equal(kept.scheduledDeparture, '2026-09-20T22:35:00.000Z')
  assert.equal(kept.actualDeparture, '2026-09-20T22:41:00.000Z')
  assert.equal(kept.aircraft, 'Boeing 787-9')
  assert.deepEqual(kept.extra, { checkinZone: 'Aisle 3' })
  assert.deepEqual(kept.sources, ['api.dublinairport.com', 'gtaa-fl-prod.azureedge.net'])
  /* The far board's word about the whole flight is later news. */
  assert.equal(keepNearEnd({ ...FAR_ONLY, status: 'landed' }, DEPARTED).status, 'landed')
  assert.equal(keepNearEnd({ ...FAR_ONLY, status: 'diverted' }, DEPARTED).status, 'diverted')
  /* A flight the near board had not seen leave takes the far board's word. */
  assert.equal(keepNearEnd(FAR_ONLY, { ...DEPARTED, status: 'boarding' }).status, 'expected')
  /* And a far board with its own departure figures is the fresher word. */
  const fresher = keepNearEnd(
    { ...FAR_ONLY, actualDeparture: '2026-09-20T22:43:00.000Z' },
    { ...DEPARTED, actualDeparture: null },
  )
  assert.equal(fresher.actualDeparture, '2026-09-20T22:43:00.000Z')
})

test('the far end keeps what the arrivals board last said, and a landed flight stays landed', () => {
  const landed = {
    status: 'landed',
    statusText: 'Landed 06:01',
    baggageBelt: '8',
    arrivalTerminal: '2',
    arrivalGate: '412',
    estimatedArrival: null,
    actualArrival: '2026-09-21T05:10:00.000Z',
    aircraft: 'BCS3',
    sources: ['gtaa-fl-prod.azureedge.net', 'api.dublinairport.com'],
  }
  const nearOnly = {
    status: 'departed',
    statusText: 'Departed',
    baggageBelt: null,
    arrivalTerminal: null,
    arrivalGate: null,
    estimatedArrival: null,
    actualArrival: null,
    aircraft: null,
    sources: ['gtaa-fl-prod.azureedge.net'],
  }
  const kept = keepFarEnd(nearOnly, landed)
  assert.equal(kept.status, 'landed')
  assert.equal(kept.statusText, 'Landed 06:01')
  assert.equal(kept.baggageBelt, '8')
  assert.equal(kept.arrivalTerminal, '2')
  assert.equal(kept.arrivalGate, '412')
  assert.equal(kept.actualArrival, '2026-09-21T05:10:00.000Z')
  assert.equal(kept.aircraft, 'BCS3', 'the type the far board named is kept too')
  assert.deepEqual(kept.sources, ['gtaa-fl-prod.azureedge.net', 'api.dublinairport.com'])
  /* A cancellation or diversion said by the near board is later news. */
  assert.equal(keepFarEnd({ ...nearOnly, status: 'cancelled' }, landed).status, 'cancelled')
  /* A flight the far board had not landed keeps the near board's word. */
  assert.equal(keepFarEnd(nearOnly, { ...landed, status: 'expected' }).status, 'departed')
})
