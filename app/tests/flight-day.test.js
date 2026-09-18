import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boardName,
  flightHeadline,
  flightPhases,
  flightSource,
  movedMinutes,
  QUIET_AFTER_MS,
  ticketColumns,
  ticketLine,
} from '../src/flight-day-core.ts'
import { liveLeg, travelCapsule } from '../src/travel-capsule-core.ts'
import { deriveDeadlines } from '../src/segments-core.ts'

/* The travel day in words. What these pin: the headline leads with the
   answer and never a raw status word; the delta is said; the phases are the
   app's deadlines with the board's actuals taking over; everything on the
   departures board — check-in zone and desks, the walk, the security queue,
   the belt — is a row; the source and its age are said and a quiet board is
   called quiet; and the capsule leads with the live leg on its day only. */

const H = 3600_000
const M = 60_000
const NOW = Date.parse('2026-09-17T18:00:00.000Z')

const leg = (rest = {}, flight = undefined) => ({
  id: 'ei123',
  mode: 'flight',
  carrier: 'Aer Lingus',
  number: 'EI 123',
  fromName: 'Dublin',
  fromCode: 'DUB',
  toName: 'Toronto',
  toCode: 'YYZ',
  departsAt: '2026-09-17T20:00:00.000Z',
  arrivesAt: '2026-09-18T03:00:00.000Z',
  departTz: 'Europe/Dublin',
  arriveTz: 'America/Toronto',
  terminal: '2',
  gate: '406',
  passengers: [],
  status: 'scheduled',
  deadlines: deriveDeadlines('flight', '2026-09-17T20:00:00.000Z'),
  flight:
    flight === undefined
      ? {
          status: 'scheduled',
          statusText: 'ON SCHEDULE',
          gate: '406',
          terminal: '2',
          scheduledDeparture: '2026-09-17T20:00:00.000Z',
          checkinZone: '15',
          checkinDesks: '1501-1520',
          walkMinutes: 12,
          securityWaitMinutes: 9,
          preClearance: true,
          sources: ['api.dublinairport.com'],
          fetchedAt: '2026-09-17T17:58:00.000Z',
        }
      : flight,
  ...rest,
})

test('the headline leads with the answer: on time, the gate, the next thing and when', () => {
  const said = flightHeadline(leg(), NOW)
  assert.equal(said.text, 'On time · gate 406 · check-in closes in 1 h')
  assert.equal(said.tone, 'ok')
  const soon = flightHeadline(leg(), NOW + 50 * M)
  assert.equal(soon.text, 'On time · gate 406 · check-in closes in 10 min')
  assert.equal(soon.tone, 'tight', 'ten minutes to a hard deadline is tight')
})

test('without a board the app says what it knows and does not claim on time', () => {
  const said = flightHeadline(leg({ flight: null }), NOW)
  assert.equal(said.text, 'Scheduled · gate 406 · check-in closes in 1 h')
  const train = flightHeadline(
    leg({
      mode: 'train',
      flight: null,
      gate: null,
      deadlines: deriveDeadlines('train', '2026-09-17T20:00:00.000Z'),
    }),
    NOW,
  )
  assert.equal(train.text, 'On the plan · boarding in 1 h 40')
})

test('a delay says by how much and when it leaves now', () => {
  const moved = leg({
    departsAt: '2026-09-17T20:55:00.000Z',
    departsWas: '2026-09-17T20:00:00.000Z',
    status: 'delayed',
  })
  const said = flightHeadline(moved, NOW)
  assert.equal(said.text, 'Delayed 55 min · leaves 21:55 · gate 406')
  assert.equal(said.tone, 'tight')
  /* The board's estimate says so when the leg has not been rewritten yet. */
  const byBoard = leg(
    {},
    {
      status: 'scheduled',
      scheduledDeparture: '2026-09-17T20:00:00.000Z',
      estimatedDeparture: '2026-09-17T21:30:00.000Z',
    },
  )
  assert.equal(movedMinutes(byBoard), 90)
  assert.match(flightHeadline(byBoard, NOW).text, /^Delayed 1 h 30/)
})

test('go to gate, boarding, final call and closed are said in those words with the walk', () => {
  const gate = leg(
    {},
    { status: 'scheduled', boardingStatus: 'go-to-gate', gate: '406', walkMinutes: 12 },
  )
  assert.deepEqual(flightHeadline(gate, NOW), {
    text: 'Go to gate 406 · 12 min walk',
    tone: 'tight',
  })
  const boarding = leg({}, { status: 'boarding', boardingStatus: 'boarding' })
  assert.deepEqual(flightHeadline(boarding, NOW), { text: 'Boarding · gate 406', tone: 'tight' })
  const last = leg({}, { status: 'boarding', boardingStatus: 'final-call' })
  assert.deepEqual(flightHeadline(last, NOW), { text: 'Final call · gate 406', tone: 'late' })
  const shut = leg({}, { status: 'gate-closed', boardingStatus: 'closed' })
  assert.equal(flightHeadline(shut, NOW).text, 'Gate closed · gate 406')
})

test('departed, landed with the belt, cancelled and diverted', () => {
  const gone = leg(
    {},
    {
      status: 'departed',
      actualDeparture: '2026-09-17T20:12:00.000Z',
      estimatedArrival: '2026-09-18T02:40:00.000Z',
    },
  )
  assert.deepEqual(flightHeadline(gone, NOW + 3 * H), {
    text: 'Departed 21:12 · lands 22:40',
    tone: 'ok',
  })
  const down = leg(
    {},
    { status: 'landed', actualArrival: '2026-09-18T02:41:00.000Z', baggageBelt: '5' },
  )
  assert.deepEqual(flightHeadline(down, NOW + 9 * H), {
    text: 'Landed 22:41 · bags on belt 5',
    tone: 'done',
  })
  assert.deepEqual(flightHeadline(leg({}, { status: 'cancelled' }), NOW), {
    text: 'Cancelled',
    tone: 'late',
  })
  assert.deepEqual(flightHeadline(leg({ status: 'cancelled', flight: null }), NOW), {
    text: 'Cancelled',
    tone: 'late',
  })
  assert.deepEqual(flightHeadline(leg({}, { status: 'diverted' }), NOW), {
    text: 'Diverted',
    tone: 'late',
  })
})

test('past the departure with no board word, the app says what is due rather than what happened', () => {
  const said = flightHeadline(leg({ flight: null }), NOW + 3 * H)
  assert.equal(said.text, 'Due to land 23:00')
  assert.equal(flightHeadline(leg({ flight: null }), NOW + 10 * H).text, 'Due to have landed 23:00')
  /* A train that was put back and has since left is not "delayed · leaves
     14:20" for the rest of the day: it is due where it is going. */
  const train = leg({
    mode: 'train',
    flight: null,
    status: 'delayed',
    departsAt: '2026-09-17T20:25:00.000Z',
    departsWas: '2026-09-17T20:00:00.000Z',
    arrivesAt: '2026-09-17T20:45:00.000Z',
    arriveTz: 'Europe/Dublin',
  })
  assert.equal(flightHeadline(train, NOW + 2 * H).text, 'Delayed 25 min · leaves 21:25 · gate 406')
  assert.equal(flightHeadline(train, NOW + 150 * M).text, 'Due to arrive 21:45')
  assert.deepEqual(flightHeadline(train, NOW + 3 * H), {
    text: 'Due to have arrived 21:45',
    tone: 'done',
  })
  /* A board that still says scheduled about a flight past its time: the
     board has not called it, and the app does not either. */
  const quiet = leg({}, { status: 'scheduled', statusText: 'ON SCHEDULE' })
  assert.equal(flightHeadline(quiet, NOW + 3 * H).text, 'Due to land 23:00')
})

test('the phases are the deadlines, the board’s go-to-gate, then leaving and landing as the board calls them', () => {
  const phases = flightPhases(
    leg({}, { status: 'scheduled', goToGateTime: '2026-09-17T19:25:00.000Z' }),
    NOW + 70 * M,
  )
  assert.deepEqual(
    phases.map(one => `${one.key}:${one.state}`),
    [
      'checkinClosesAt:done',
      'bagsCloseAt:now',
      'goToGate:later',
      'boardingAt:later',
      'doorsAt:later',
      'departs:later',
      'lands:later',
    ],
  )
  assert.equal(phases[0].clock, '✓')
  assert.equal(phases[1].clock, '20:15', 'in the airport’s own clock')
  assert.equal(phases[6].clock, '23:00', 'in the far end’s clock')
  /* With a board, the clock alone never marks a plane as gone; the board
     does. With no board at all — a train — the clock is all there is. */
  const late = flightPhases(leg({}, { status: 'scheduled' }), NOW + 3 * H)
  assert.equal(late.find(one => one.key === 'departs').state, 'now')
  assert.equal(late.find(one => one.key === 'departs').label, 'Departs')
  const train = flightPhases(leg({ mode: 'train', flight: null }), NOW + 3 * H)
  assert.equal(train.find(one => one.key === 'departs').state, 'done')
  assert.equal(train.find(one => one.key === 'departs').label, 'Departed')
  assert.equal(train.find(one => one.key === 'lands').state, 'now')
  assert.equal(train.find(one => one.key === 'lands').label, 'Lands')
  const gone = flightPhases(
    leg({}, { status: 'departed', actualDeparture: '2026-09-17T20:12:00.000Z' }),
    NOW + 3 * H,
  )
  const left = gone.find(one => one.key === 'departs')
  assert.equal(left.state, 'done')
  assert.equal(left.label, 'Departed')
  assert.equal(gone.find(one => one.key === 'lands').state, 'now')
  const down = flightPhases(
    leg({}, { status: 'landed', actualArrival: '2026-09-18T02:41:00.000Z', baggageBelt: '5' }),
    NOW + 9 * H,
  )
  assert.deepEqual(
    down.slice(-2).map(one => `${one.label}:${one.state}`),
    ['Landed:done', 'Belt 5:done'],
  )
})

test('the ticket has its columns whether or not the board has filled them: a dash until it does', () => {
  /* A boarding pass prints TERMINAL and GATE as headings and the traveller
     looks for the heading first, so the headings are always there. */
  const bare = ticketColumns(leg({ gate: null, terminal: null, flight: null }))
  assert.deepEqual(
    bare.map(one => `${one.label}:${one.value}`),
    [
      'Terminal:null',
      'Gate:null',
      'Check-in:null',
      'Walk to gate:null',
      'Security:null',
      'Belt:null',
    ],
  )
  const full = ticketColumns(leg({ gateWas: '404' }))
  assert.deepEqual(full, [
    { key: 'terminal', label: 'Terminal', value: 'T2' },
    { key: 'gate', label: 'Gate', value: '406', was: '404' },
    { key: 'checkin', label: 'Check-in', value: 'Zone 15 · Desks 1501–1520' },
    { key: 'walk', label: 'Walk to gate', value: '12 min' },
    { key: 'security', label: 'Security', value: '9 min queue' },
    { key: 'belt', label: 'Belt', value: null },
    { key: 'preclearance', label: 'US pre-clearance', value: 'Before the gate' },
  ])
  const arrived = ticketColumns(
    leg({}, { status: 'landed', baggageBelt: '5', stand: '171', securityWaitMinutes: 0 }),
  )
  assert.equal(arrived.find(one => one.key === 'belt').value, '5')
  assert.equal(arrived.find(one => one.key === 'security').value, 'No queue')
  assert.equal(arrived.find(one => one.key === 'stand').value, '171')
  assert.equal(
    arrived.some(one => one.key === 'preclearance'),
    false,
    'not a column on a flight the board did not flag',
  )
  const pearson = ticketColumns(
    leg({}, { status: 'scheduled', checkinZone: 'Aisle 5', checkinDesks: '169-182' }),
  )
  assert.equal(pearson.find(one => one.key === 'checkin').value, 'Aisle 5 · Desks 169–182')
  assert.deepEqual(ticketColumns(leg({ mode: 'train', flight: null, platform: '14b' })), [
    { key: 'platform', label: 'Platform', value: '14b' },
  ])
  assert.deepEqual(ticketColumns(leg({ mode: 'bus', flight: null, platform: null })), [
    { key: 'platform', label: 'Bay', value: null },
  ])
  assert.deepEqual(ticketColumns(leg({ mode: 'drive', flight: null })), [])
  assert.equal(ticketLine(leg()), 'T2 · gate 406 · Zone 15 · Desks 1501–1520')
})

test('the source line says which board, how old, and calls a quiet board quiet', () => {
  const fresh = flightSource(leg(), NOW)
  assert.deepEqual(fresh, {
    name: 'Dublin Airport',
    age: '2 min ago',
    quiet: false,
    said: 'ON SCHEDULE',
  })
  const quiet = flightSource(leg(), NOW + QUIET_AFTER_MS + 3 * M)
  assert.equal(quiet.quiet, true)
  assert.equal(quiet.age, '20 min ago')
  const over = flightSource(
    leg(
      {},
      {
        status: 'landed',
        sources: ['www.torontopearson.com', 'api.dublinairport.com'],
        fetchedAt: '2026-09-17T15:00:00.000Z',
      },
    ),
    NOW,
  )
  assert.equal(over.name, 'Toronto Pearson and Dublin Airport')
  assert.equal(over.quiet, false, 'a board has nothing more to say about a flight that has landed')
  assert.equal(over.age, '3 h ago')
  assert.equal(flightSource(leg({ flight: null }), NOW), null)
  assert.equal(boardName('nobody.example'), 'The airport')
})

test('the capsule leads with the live leg on its day, and with nothing on any other', () => {
  const eve = travelCapsule([leg()], NOW - 20 * H)
  assert.equal(eve, null)
  const day = travelCapsule([leg()], NOW)
  assert.equal(day.text, '✈ EI 123 · On time · gate 406 · check-in closes in 1 h')
  assert.equal(day.meta, 'DUB → YYZ')
  assert.equal(day.tone, 'heading')
  const train = leg({
    id: 'train',
    mode: 'train',
    carrier: 'DART',
    number: null,
    fromName: 'Dublin Connolly',
    fromCode: null,
    toName: 'Dublin Airport',
    toCode: null,
    departsAt: '2026-09-17T17:00:00.000Z',
    arrivesAt: '2026-09-17T17:40:00.000Z',
    gate: null,
    terminal: null,
    flight: null,
    deadlines: deriveDeadlines('train', '2026-09-17T17:00:00.000Z'),
  })
  /* The train has left; the flight is the story now, even before it is over. */
  assert.equal(liveLeg([train, leg()], NOW).id, 'ei123')
  assert.equal(liveLeg([train, leg()], NOW - 2 * H).id, 'train')
  const landed = leg(
    {},
    { status: 'landed', actualArrival: '2026-09-18T02:41:00.000Z', baggageBelt: '5' },
  )
  const after = travelCapsule([train, landed], NOW + 9 * H)
  assert.equal(after.text, '✈ EI 123 · Landed 22:41 · bags on belt 5')
  assert.equal(after.tone, 'arrived')
})
