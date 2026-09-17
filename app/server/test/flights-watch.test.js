import assert from 'node:assert/strict'
import test from 'node:test'
import {
  baselineFromSegment,
  changesFor,
  mergeBoards,
  noteFor,
  watchFlights,
} from '../src/flights/watch.js'

/* The airports looking at the legs. What these pin: a leg finds its row on
   the boards at both ends and what differs is written onto it and said as a
   sentence; the first look is against what was typed; nothing is written or
   said twice; a leg whose airports have no board is left alone; a board that
   is down costs nobody else their turn; and the sky is asked only when a
   board has gone quiet about a flight that should have left. */

const NOW = Date.parse('2026-09-20T17:30:00.000Z')

const leg = (rest = {}) => ({
  id: 'leg-1',
  tripId: 'trip-1',
  mode: 'flight',
  carrier: 'Air Canada',
  number: 'AC 872',
  fromCode: 'YYZ',
  fromName: 'Toronto',
  fromLng: -79.6248,
  fromLat: 43.6777,
  toCode: 'DUB',
  toName: 'Dublin',
  toLng: -6.2701,
  toLat: 53.4213,
  departsAt: '2026-09-20T22:35:00.000Z',
  arrivesAt: '2026-09-21T05:25:00.000Z',
  gate: 'C34',
  terminal: '1',
  status: 'scheduled',
  ...rest,
})

const boardRow = (rest = {}) => ({
  flightNumber: 'AC872',
  carrierCode: 'AC',
  carrierName: 'Air Canada',
  airportCode: 'YYZ',
  direction: 'departure',
  origin: 'YYZ',
  destination: 'DUB',
  scheduledDeparture: '2026-09-20T22:35:00.000Z',
  estimatedDeparture: null,
  actualDeparture: null,
  scheduledArrival: null,
  estimatedArrival: null,
  actualArrival: null,
  status: 'scheduled',
  statusText: 'On Time',
  terminal: '1',
  gate: 'C34',
  baggageBelt: null,
  boardingStatus: null,
  aircraft: null,
  codeshares: [],
  lastUpdated: '2026-09-20T17:29:00.000Z',
  source: 'gtaa-fl-prod.azureedge.net',
  ...rest,
})

function store({ legs = [leg()], snapshot = null } = {}) {
  const applied = []
  const events = []
  const snapshots = []
  return {
    applied,
    events,
    snapshots,
    async flightLegsToWatch() {
      return legs
    },
    async flightSnapshot() {
      return snapshot
    },
    async saveFlightSnapshot(id, held) {
      snapshots.push({ id, ...held })
    },
    async recordFlightEvents(id, list) {
      events.push(...list.map(one => ({ id, ...one })))
      return list.length
    },
    async applyFlightUpdate(id, changes) {
      applied.push({ id, changes })
      return { id, ...changes }
    },
  }
}

function sourcesWith({ boards = {}, adsb = null } = {}) {
  const providers = {
    YYZ: { airportCode: 'YYZ', source: 'gtaa-fl-prod.azureedge.net', zone: 'America/Toronto' },
    DUB: { airportCode: 'DUB', source: 'api.dublinairport.com', zone: 'Europe/Dublin' },
  }
  const asked = []
  return {
    asked,
    providerFor: code => providers[String(code || '').toUpperCase()] || null,
    async board(code, direction, date) {
      asked.push(`${code}:${direction}:${date}`)
      const held = boards[`${code}:${direction}`]
      if (held instanceof Error) return { value: null, fetchedAt: null, stale: true, error: held }
      return { value: held || [], fetchedAt: NOW, stale: false, error: null }
    },
    adsb,
  }
}

test('a gate change on the origin board is written onto the leg, said, kept and announced', async () => {
  const repository = store()
  const announced = []
  const stats = await watchFlights({
    repository,
    sources: sourcesWith({ boards: { 'YYZ:departure': [boardRow({ gate: 'D12' })] } }),
    announce: (tripId, kind) => announced.push([tripId, kind]),
    now: NOW,
  })
  assert.deepEqual(stats, { legs: 1, matched: 1, changed: 1, events: 1, unwatched: 0 })
  assert.equal(repository.applied.length, 1)
  assert.equal(repository.applied[0].changes.gate, 'D12')
  assert.equal(
    repository.applied[0].changes.statusNote,
    'AC872 has moved from gate C34 to D12. Toronto Pearson, 13:30.',
  )
  assert.equal(repository.events.length, 1)
  assert.equal(repository.events[0].type, 'GateChanged')
  assert.equal(repository.events[0].text, 'AC872 has moved from gate C34 to D12.')
  assert.equal(repository.events[0].source, 'gtaa-fl-prod.azureedge.net')
  assert.equal(repository.snapshots[0].info.gate, 'D12')
  assert.deepEqual(announced, [['trip-1', 'segments']])
})

test('a delay moves the departure, and the arrival board’s belt and landing reach the same leg', async () => {
  const repository = store()
  const stats = await watchFlights({
    repository,
    sources: sourcesWith({
      boards: {
        'YYZ:departure': [
          boardRow({
            status: 'delayed',
            statusText: 'Delayed',
            estimatedDeparture: '2026-09-20T23:30:00.000Z',
          }),
        ],
        'DUB:arrival': [
          boardRow({
            airportCode: 'DUB',
            direction: 'arrival',
            source: 'api.dublinairport.com',
            scheduledDeparture: null,
            scheduledArrival: '2026-09-21T05:25:00.000Z',
            estimatedArrival: '2026-09-21T06:20:00.000Z',
            baggageBelt: '8',
            terminal: '2',
            gate: null,
          }),
        ],
      },
    }),
    now: NOW,
  })
  assert.equal(stats.matched, 1)
  const { changes } = repository.applied[0]
  assert.equal(changes.departsAt, '2026-09-20T23:30:00.000Z')
  assert.equal(changes.arrivesAt, '2026-09-21T06:20:00.000Z', 'the far board knows when it lands')
  assert.equal(changes.gate, undefined, 'the gate did not move')
  assert.match(
    changes.statusNote,
    /^AC872 is delayed by 55 minutes, now leaving at 19:30\. Toronto Pearson, 13:30\.$/,
  )
  const types = repository.events.map(one => one.type).sort()
  assert.deepEqual(types, ['ArrivalEstimateChanged', 'BaggageUpdated', 'FlightDelayed'])
  assert.equal(repository.snapshots[0].info.baggageBelt, '8')
  assert.deepEqual(repository.snapshots[0].info.sources, [
    'gtaa-fl-prod.azureedge.net',
    'api.dublinairport.com',
  ])
})

test('the same board twice writes nothing, says nothing and announces nothing', async () => {
  const row = boardRow({ gate: 'D12' })
  const snapshot = { info: mergeBoards(row, null), fetchedAt: '2026-09-20T17:20:00.000Z' }
  const repository = store({ legs: [leg({ gate: 'D12' })], snapshot })
  const announced = []
  const stats = await watchFlights({
    repository,
    sources: sourcesWith({ boards: { 'YYZ:departure': [row] } }),
    announce: (...args) => announced.push(args),
    now: NOW,
  })
  assert.equal(stats.changed, 0)
  assert.equal(stats.events, 0)
  assert.deepEqual(repository.applied, [])
  assert.deepEqual(announced, [])
  assert.equal(repository.snapshots.length, 1, 'the snapshot is still refreshed')
})

test('a cancellation is written as the leg’s status', async () => {
  const repository = store()
  await watchFlights({
    repository,
    sources: sourcesWith({
      boards: { 'YYZ:departure': [boardRow({ status: 'cancelled', statusText: 'Cancelled' })] },
    }),
    now: NOW,
  })
  assert.equal(repository.applied[0].changes.status, 'cancelled')
  assert.equal(
    repository.applied[0].changes.statusNote,
    'AC872 has been cancelled. Toronto Pearson, 13:30.',
  )
})

test('a leg whose airports have no board, or whose number cannot be read, is left alone', async () => {
  const repository = store({
    legs: [
      leg({ fromCode: 'LHR', toCode: 'JFK' }),
      leg({ id: 'leg-2', number: 'the 3pm one', carrier: 'Dad' }),
    ],
  })
  const stats = await watchFlights({ repository, sources: sourcesWith(), now: NOW })
  assert.deepEqual(stats, { legs: 2, matched: 0, changed: 0, events: 0, unwatched: 2 })
  assert.deepEqual(repository.applied, [])
})

test('a leg that is not on the board yet is neither written nor snapshotted', async () => {
  const repository = store()
  const stats = await watchFlights({
    repository,
    sources: sourcesWith({ boards: { 'YYZ:departure': [boardRow({ flightNumber: 'AC848' })] } }),
    now: NOW,
  })
  assert.equal(stats.matched, 0)
  assert.deepEqual(repository.snapshots, [])
})

test('a board that is down costs the other legs nothing', async () => {
  const repository = store({
    legs: [leg(), leg({ id: 'leg-2', fromCode: 'DUB', toCode: 'YQR', number: 'EI 123' })],
  })
  const warned = []
  const stats = await watchFlights({
    repository,
    sources: sourcesWith({
      boards: {
        'YYZ:departure': new Error('board down'),
        'DUB:departure': [
          boardRow({
            flightNumber: 'EI123',
            airportCode: 'DUB',
            gate: '106',
            source: 'api.dublinairport.com',
          }),
        ],
      },
    }),
    now: NOW,
    log: { warn: (...args) => warned.push(args) },
  })
  assert.equal(stats.matched, 1, 'the Dublin leg still got its look')
  assert.equal(repository.applied[0].id, 'leg-2')
  assert.equal(repository.applied[0].changes.gate, '106')
})

test('when a board has gone quiet about a flight that should have left, the sky is asked once in a while', async () => {
  const quiet = boardRow({ status: 'scheduled' })
  const repository = store({
    legs: [leg()],
    snapshot: { info: mergeBoards(quiet, null), fetchedAt: '2026-09-20T22:00:00.000Z' },
  })
  const asked = []
  const adsb = {
    source: 'api.adsb.lol',
    async byCallsign(callsign) {
      asked.push(callsign)
      return { callsign, airborne: true, onGround: false, lat: 47.5, lon: -52.7, type: 'B789' }
    },
  }
  const later = Date.parse('2026-09-20T23:10:00.000Z')
  const memory = new Map()
  const stats = await watchFlights({
    repository,
    sources: sourcesWith({ boards: { 'YYZ:departure': [quiet] }, adsb }),
    now: later,
    asked: memory,
  })
  assert.deepEqual(asked, ['ACA872'])
  assert.equal(stats.events, 1)
  assert.equal(repository.events[0].type, 'FlightDeparted')
  assert.equal(repository.snapshots[0].info.status, 'departed')
  assert.equal(repository.snapshots[0].info.statusText, 'In the air (ADS-B)')
  assert.ok(repository.snapshots[0].info.sources.includes('api.adsb.lol'))

  await watchFlights({
    repository,
    sources: sourcesWith({ boards: { 'YYZ:departure': [quiet] }, adsb }),
    now: later + 60_000,
    asked: memory,
  })
  assert.equal(asked.length, 1, 'not again a minute later')
})

test('the first comparison is the leg as typed; the boards merge with the later stage winning', () => {
  const typed = baselineFromSegment(leg({ status: 'delayed' }))
  assert.equal(typed.flightNumber, 'AC872')
  assert.equal(typed.status, 'delayed')
  assert.equal(typed.scheduledDeparture, '2026-09-20T22:35:00.000Z')
  assert.equal(typed.gate, 'C34')

  const merged = mergeBoards(
    boardRow({ status: 'departed', actualDeparture: '2026-09-20T22:40:00.000Z' }),
    boardRow({
      direction: 'arrival',
      airportCode: 'DUB',
      status: 'landed',
      actualArrival: '2026-09-21T05:10:00.000Z',
      baggageBelt: '3',
      source: 'api.dublinairport.com',
    }),
  )
  assert.equal(merged.status, 'landed')
  assert.equal(merged.actualDeparture, '2026-09-20T22:40:00.000Z')
  assert.equal(merged.actualArrival, '2026-09-21T05:10:00.000Z')
  assert.equal(merged.baggageBelt, '3')
  assert.equal(mergeBoards(null, null), null)

  const changes = changesFor(leg(), merged)
  assert.equal(changes.departsAt, '2026-09-20T22:40:00.000Z')
  assert.equal(changes.arrivesAt, '2026-09-21T05:10:00.000Z')
  assert.equal(changes.gate, undefined)

  assert.equal(
    noteFor(
      [
        { type: 'BaggageUpdated', newValue: '3' },
        { type: 'FlightLanded', newValue: '2026-09-21T05:10:00.000Z' },
      ],
      {
        flight: 'AC872',
        zone: 'Europe/Dublin',
        sourceName: 'Dublin Airport',
        at: Date.parse('2026-09-21T05:12:00.000Z'),
      },
    ),
    'AC872 has landed at 06:10. Dublin Airport, 06:12.',
    'the landing outranks the belt',
  )
  assert.equal(noteFor([], { flight: 'AC872' }), null)
})
