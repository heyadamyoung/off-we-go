import assert from 'node:assert/strict'
import test from 'node:test'
import { createBoardCache } from '../src/flights/board-cache.js'
import {
  MOVED_THRESHOLD_MINUTES,
  describeFlightEvent,
  detectFlightEvents,
} from '../src/flights/events.js'
import {
  bestDeparture,
  flightNumberOf,
  matchFlight,
  normalizeFlightNumber,
  normalizeTerminal,
} from '../src/flights/model.js'
import { localToIso, zoneOffsetMinutes } from '../src/flights/time.js'

/* The flight intelligence core, without a network in sight. What these pin:
   a flight number means one thing however it was typed; a leg finds its own
   row on a board and not yesterday's; a wall-clock time in an airport's own
   zone becomes the right instant on both sides of a clock change; every kind
   of change the boards can report becomes exactly one event with both values
   on it; and the sentence a person reads says what happened in their words. */

test('a flight number means one thing however it was typed', () => {
  assert.equal(normalizeFlightNumber('AC 872'), 'AC872')
  assert.equal(normalizeFlightNumber('ac0872'), 'AC872')
  assert.equal(normalizeFlightNumber(' fr-457 '), 'FR457')
  assert.equal(normalizeFlightNumber('U2 1234'), 'U21234')
  assert.equal(normalizeFlightNumber('EI3274A'), 'EI3274A')
  assert.equal(
    normalizeFlightNumber('SIG108'),
    null,
    'a three-letter charter code is not an IATA number',
  )
  assert.equal(normalizeFlightNumber('18 12'), null, 'two digits are a year, not an airline')
  assert.equal(normalizeFlightNumber('872'), null)
  assert.equal(normalizeFlightNumber(''), null)
  assert.equal(normalizeFlightNumber(null), null)
})

test('a leg names its flight from the number, or the carrier and the number', () => {
  assert.equal(flightNumberOf({ carrier: 'KLM', number: 'KL 677' }), 'KL677')
  assert.equal(flightNumberOf({ carrier: 'Air Canada', number: '872' }), 'AC872')
  assert.equal(flightNumberOf({ carrier: 'AC', number: '0872' }), 'AC872')
  assert.equal(flightNumberOf({ carrier: 'WestJet', number: 'WS 3364' }), 'WS3364')
  assert.equal(flightNumberOf({ carrier: 'Some Bus Company', number: '12' }), null)
  assert.equal(flightNumberOf({ carrier: null, number: null }), null)
})

test('a terminal is its number, never the word', () => {
  assert.equal(normalizeTerminal('T1'), '1')
  assert.equal(normalizeTerminal('Terminal 3'), '3')
  assert.equal(normalizeTerminal('2'), '2')
  assert.equal(normalizeTerminal(''), null)
  assert.equal(normalizeTerminal(undefined), null)
})

const row = (flightNumber, scheduledDeparture, rest = {}) => ({
  flightNumber,
  direction: 'departure',
  scheduledDeparture,
  codeshares: [],
  ...rest,
})

test('a leg finds its own row: the number, or a number it is sold under, nearest in time', () => {
  const board = [
    row('FR457', '2026-09-17T22:35:00.000Z'),
    row('FR457', '2026-09-18T22:35:00.000Z'),
    row('DL8291', '2026-09-18T10:00:00.000Z', { codeshares: ['KL8341', 'AF3512'] }),
  ]
  assert.equal(
    matchFlight(board, 'fr 457', '2026-09-18T21:00:00.000Z').scheduledDeparture,
    '2026-09-18T22:35:00.000Z',
    'tonight, not last night',
  )
  assert.equal(matchFlight(board, 'KL8341', '2026-09-18T09:00:00.000Z').flightNumber, 'DL8291')
  assert.equal(
    matchFlight(board, 'FR457', '2026-09-20T22:35:00.000Z'),
    null,
    'a flight two days away is not this one',
  )
  assert.equal(matchFlight(board, 'nonsense', '2026-09-18T09:00:00.000Z'), null)
  assert.equal(matchFlight(null, 'FR457', '2026-09-18T09:00:00.000Z'), null)
})

test('the best-known departure is actual over estimated over scheduled', () => {
  assert.equal(bestDeparture({ scheduledDeparture: 'a' }), 'a')
  assert.equal(bestDeparture({ scheduledDeparture: 'a', estimatedDeparture: 'b' }), 'b')
  assert.equal(
    bestDeparture({ scheduledDeparture: 'a', estimatedDeparture: 'b', actualDeparture: 'c' }),
    'c',
  )
  assert.equal(bestDeparture(null), null)
})

test('a wall-clock time in an airport zone becomes the right instant, clock changes included', () => {
  // Saskatchewan keeps one clock all year: 16:26 in Regina is 22:26Z in September.
  assert.equal(
    localToIso({ year: 2026, month: 9, day: 17, hour: 16, minute: 26 }, 'America/Regina'),
    '2026-09-17T22:26:00.000Z',
  )
  assert.equal(zoneOffsetMinutes('America/Regina', Date.parse('2026-01-15T12:00:00Z')), -360)
  // Dublin: summer time in September, GMT in December.
  assert.equal(
    localToIso({ year: 2026, month: 9, day: 17, hour: 23, minute: 28 }, 'Europe/Dublin'),
    '2026-09-17T22:28:00.000Z',
  )
  assert.equal(
    localToIso({ year: 2026, month: 12, day: 17, hour: 23, minute: 28 }, 'Europe/Dublin'),
    '2026-12-17T23:28:00.000Z',
  )
  // Toronto, the day the clocks go forward (8 March 2026): 03:30 local is 07:30Z.
  assert.equal(
    localToIso({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, 'America/Toronto'),
    '2026-03-08T07:30:00.000Z',
  )
  assert.equal(localToIso({ year: 'x', month: 1, day: 1 }, 'America/Toronto'), null)
})

const before = {
  status: 'scheduled',
  scheduledDeparture: '2026-09-20T18:35:00.000Z',
  scheduledArrival: '2026-09-21T01:25:00.000Z',
  gate: 'C34',
  terminal: '1',
  baggageBelt: null,
  boardingStatus: null,
  aircraft: '789',
}

test('every kind of change the boards report is one event with both values', () => {
  const after = {
    ...before,
    status: 'delayed',
    estimatedDeparture: '2026-09-20T19:30:00.000Z',
    estimatedArrival: '2026-09-21T02:20:00.000Z',
    gate: 'D12',
    terminal: '3',
    baggageBelt: '7',
    boardingStatus: 'boarding',
    aircraft: '77W',
  }
  const events = detectFlightEvents(before, after)
  const byType = Object.fromEntries(events.map(one => [one.type, one]))
  assert.deepEqual(Object.keys(byType).sort(), [
    'AircraftChanged',
    'ArrivalEstimateChanged',
    'BaggageUpdated',
    'BoardingStarted',
    'FlightDelayed',
    'GateChanged',
    'TerminalChanged',
  ])
  assert.equal(byType.FlightDelayed.minutes, 55)
  assert.equal(byType.FlightDelayed.oldValue, '2026-09-20T18:35:00.000Z')
  assert.equal(byType.FlightDelayed.newValue, '2026-09-20T19:30:00.000Z')
  assert.equal(byType.ArrivalEstimateChanged.minutes, 55)
  assert.deepEqual([byType.GateChanged.oldValue, byType.GateChanged.newValue], ['C34', 'D12'])
  assert.deepEqual([byType.TerminalChanged.oldValue, byType.TerminalChanged.newValue], ['1', '3'])
  assert.deepEqual([byType.BaggageUpdated.oldValue, byType.BaggageUpdated.newValue], [null, '7'])
  assert.deepEqual(
    [byType.AircraftChanged.oldValue, byType.AircraftChanged.newValue],
    ['789', '77W'],
  )
})

test('a first look compares against the leg as typed, so a board already saying delayed is news', () => {
  const typed = { status: 'scheduled', scheduledDeparture: '2026-09-20T18:35:00.000Z', gate: null }
  const board = {
    ...typed,
    status: 'delayed',
    estimatedDeparture: '2026-09-20T19:00:00.000Z',
    gate: '106',
  }
  const events = detectFlightEvents(typed, board)
  assert.deepEqual(
    events.map(one => one.type),
    ['FlightDelayed', 'GateChanged'],
  )
  assert.equal(events[1].oldValue, null, 'a first gate is an assignment, not a move')
})

test('an estimate under the threshold is the board rounding, not the flight moving', () => {
  const nudged = {
    ...before,
    estimatedDeparture: `2026-09-20T18:${35 + MOVED_THRESHOLD_MINUTES - 1}:00.000Z`,
  }
  assert.deepEqual(detectFlightEvents(before, nudged), [])
  const earlier = { ...before, estimatedDeparture: '2026-09-20T18:20:00.000Z' }
  assert.equal(detectFlightEvents(before, earlier)[0].type, 'FlightRescheduled')
  assert.equal(detectFlightEvents(before, earlier)[0].minutes, -15)
})

test('the same board twice is no news at all', () => {
  assert.deepEqual(detectFlightEvents(before, { ...before }), [])
})

test('cancelled, boarding over, departed and landed each happen once', () => {
  assert.deepEqual(
    detectFlightEvents(before, { ...before, status: 'cancelled' }).map(one => one.type),
    ['FlightCancelled'],
  )
  const boarding = { ...before, boardingStatus: 'boarding' }
  const closed = { ...boarding, boardingStatus: 'closed', status: 'gate-closed' }
  assert.deepEqual(
    detectFlightEvents(boarding, closed).map(one => one.type),
    ['BoardingEnded'],
  )
  const departed = { ...closed, status: 'departed', actualDeparture: '2026-09-20T18:41:00.000Z' }
  assert.deepEqual(
    detectFlightEvents(closed, departed).map(one => one.type),
    ['FlightDelayed', 'FlightDeparted'],
  )
  assert.deepEqual(
    detectFlightEvents(departed, departed).map(one => one.type),
    [],
  )
  const landed = { ...departed, status: 'landed', actualArrival: '2026-09-21T01:10:00.000Z' }
  assert.deepEqual(
    detectFlightEvents(departed, landed).map(one => one.type),
    ['ArrivalEstimateChanged', 'FlightLanded'],
  )
  /* A gate the board cleared after departure is the flight leaving, not a
     gate change; and a final call after boarding is not a second start. */
  assert.deepEqual(detectFlightEvents(departed, { ...departed, gate: null }), [])
  assert.deepEqual(detectFlightEvents(boarding, { ...boarding, boardingStatus: 'final-call' }), [])
})

test('the sentence says what happened, in the traveller’s words and the airport’s clock', () => {
  const zone = 'America/Toronto'
  assert.equal(
    describeFlightEvent(
      { type: 'GateChanged', oldValue: 'C34', newValue: 'D12' },
      { flight: 'AC872' },
    ),
    'AC872 has moved from gate C34 to D12.',
  )
  assert.equal(
    describeFlightEvent(
      { type: 'GateChanged', oldValue: null, newValue: 'D12' },
      { flight: 'AC872' },
    ),
    'AC872 boards from gate D12.',
  )
  assert.equal(
    describeFlightEvent(
      { type: 'FlightDelayed', minutes: 55, newValue: '2026-09-20T19:30:00.000Z' },
      { flight: 'AC872', zone },
    ),
    'AC872 is delayed by 55 minutes, now leaving at 15:30.',
  )
  assert.equal(
    describeFlightEvent(
      { type: 'FlightDelayed', minutes: 95, newValue: null },
      { flight: 'AC872' },
    ),
    'AC872 is delayed by 1 h 35.',
  )
  assert.equal(
    describeFlightEvent({ type: 'FlightCancelled' }, { flight: 'AC872' }),
    'AC872 has been cancelled.',
  )
  assert.equal(
    describeFlightEvent({ type: 'BoardingStarted', newValue: 'final-call' }, { flight: 'AC872' }),
    'Final call for AC872.',
  )
  assert.equal(
    describeFlightEvent({ type: 'BaggageUpdated', newValue: '5' }, { flight: 'FR3087' }),
    'Bags from FR3087 are on belt 5.',
  )
  assert.equal(
    describeFlightEvent(
      { type: 'FlightLanded', newValue: '2026-09-17T22:28:00.000Z' },
      { flight: 'FR557', zone: 'Europe/Dublin' },
    ),
    'FR557 has landed at 23:28.',
  )
  assert.equal(
    describeFlightEvent({ type: 'FlightLanded', newValue: null }, {}),
    'Your flight has landed.',
  )
})

test('a board is fetched once per interval for everyone, and served stale rather than blank', async () => {
  let clock = 1_000_000
  let loads = 0
  let fail = false
  const cache = createBoardCache({ ttlMs: 1000, staleForMs: 5000, now: () => clock })
  const load = async () => {
    loads += 1
    if (fail) throw new Error('board down')
    return [{ flightNumber: `X${loads}` }]
  }
  const [a, b] = await Promise.all([
    cache.get('DUB:departure', load),
    cache.get('DUB:departure', load),
  ])
  assert.equal(loads, 1, 'two callers at once share one load')
  assert.equal(a.value[0].flightNumber, 'X1')
  assert.equal(b.stale, false)

  clock += 500
  assert.equal(
    (await cache.get('DUB:departure', load)).value[0].flightNumber,
    'X1',
    'inside the ttl, the held board',
  )
  assert.equal(loads, 1)

  clock += 1000
  fail = true
  const stale = await cache.get('DUB:departure', load)
  assert.equal(loads, 2, 'past the ttl it asks again')
  assert.equal(stale.stale, true)
  assert.equal(
    stale.value[0].flightNumber,
    'X1',
    'a failed refresh serves the last board, marked stale',
  )
  assert.equal(stale.error.message, 'board down')
  assert.equal(cache.health()['DUB:departure'].failures, 1)
  assert.equal(cache.health()['DUB:departure'].lastError, 'board down')

  clock += 10_000
  const gone = await cache.get('DUB:departure', load)
  assert.equal(gone.value, null, 'too old to serve stale, it says so')
  assert.equal(cache.health()['DUB:departure'].failures, 2)

  fail = false
  clock += 2000
  const back = await cache.get('DUB:departure', load)
  assert.equal(back.stale, false)
  assert.equal(cache.health()['DUB:departure'].failures, 0, 'a success clears the streak')
})
