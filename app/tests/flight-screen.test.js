import assert from 'node:assert/strict'
import test from 'node:test'
import { flightScreen, spanWords } from '../src/flight-screen-core.ts'
import { deriveDeadlines } from '../src/segments-core.ts'

/* The leg's own screen: the two ends with the time to plan by and the time
   it was, the board's columns, the day as steps with a note under each,
   and the people, bags and reference. All of it is what the ticket knows,
   with room to say it. */

const H = 3600_000
const M = 60_000
const NOW = Date.parse('2026-09-13T10:00:00Z')
const iso = ms => new Date(ms).toISOString()

const leg = (extra = {}) => ({
  id: 'leg',
  mode: 'flight',
  carrier: 'KLM',
  number: 'KL 677',
  ref: 'R7QWXZ',
  fromName: 'Amsterdam Schiphol',
  fromCode: 'AMS',
  toName: 'Calgary',
  toCode: 'YYC',
  fromLng: 4.77,
  fromLat: 52.31,
  departsAt: iso(NOW + 3 * H),
  arrivesAt: iso(NOW + 12 * H),
  departTz: 'Europe/Amsterdam',
  arriveTz: 'America/Edmonton',
  terminal: '3',
  gate: 'E19',
  aircraft: 'Boeing 787-9',
  passengers: [
    { name: 'Maya', seat: '31A' },
    { name: 'Alex', seat: '31B' },
  ],
  bags: { checked: '1 × 23 kg', carryOn: '1 × 12 kg' },
  deadlines: deriveDeadlines('flight', iso(NOW + 3 * H)),
  costAmount: 1284,
  costCurrency: 'EUR',
  status: 'scheduled',
  flight: {
    status: 'scheduled',
    statusText: 'On time',
    gate: 'E19',
    terminal: '3',
    scheduledDeparture: iso(NOW + 3 * H),
    estimatedDeparture: iso(NOW + 3 * H),
    scheduledArrival: iso(NOW + 12 * H),
    checkinZone: '3',
    checkinDesks: '13-20',
    walkMinutes: 9,
    securityWaitMinutes: 6,
    sources: ['www.schiphol.nl'],
    lastUpdated: iso(NOW - 4 * M),
    fetchedAt: iso(NOW - 4 * M),
  },
  ...extra,
})

test('the screen leads with the answer and the two ends, timed in their own clocks', () => {
  const screen = flightScreen(leg(), NOW)
  assert.equal(screen.title, 'KL 677')
  assert.equal(screen.date, 'Sun 13 Sept')
  assert.equal(screen.status.text, 'Check-in closes in 2 h')
  assert.deepEqual(
    {
      code: screen.from.code,
      name: screen.from.name,
      time: screen.from.time,
      was: screen.from.was,
    },
    { code: 'AMS', name: 'Amsterdam Schiphol', time: '15:00', was: null },
  )
  assert.deepEqual(
    { code: screen.to.code, time: screen.to.time, was: screen.to.was, day: screen.to.day },
    { code: 'YYC', time: '16:00', was: null, day: 'Sun 13 Sept' },
  )
  assert.equal(screen.duration, '9 h')
  assert.equal(screen.aircraft, 'Boeing 787-9')
  assert.equal(screen.ref, 'R7QWXZ')
  assert.equal(screen.cost, '1284 EUR')
  assert.equal(screen.bags, 'Checked 1 × 23 kg · Carry-on 1 × 12 kg')
  assert.deepEqual(screen.people, [
    { name: 'Maya', seat: '31A' },
    { name: 'Alex', seat: '31B' },
  ])
  assert.equal(screen.source?.name, 'Schiphol')
})

test('the board is the ticket’s columns, and each step of the day carries its note', () => {
  const screen = flightScreen(leg(), NOW)
  assert.deepEqual(
    screen.board.map(column => column.key),
    ['terminal', 'gate', 'checkin', 'walk', 'security'],
  )
  const notes = Object.fromEntries(screen.steps.map(step => [step.key, step.note]))
  assert.equal(notes.checkinClosesAt, 'Zone 3 · Desks 13–20')
  assert.equal(notes.bagsCloseAt, 'Checked 1 × 23 kg')
  assert.equal(notes.boardingAt, 'Gate E19')
  assert.equal(notes.departs, null, 'the plan held, so nothing to say under leaving')
  assert.equal(notes.lands, null)
  assert.equal(screen.steps.filter(step => step.state === 'now').length, 1)
})

test('a moved departure shows the new time with the old struck, and says so under the step', () => {
  const moved = leg({
    flight: {
      ...leg().flight,
      status: 'delayed',
      estimatedDeparture: iso(NOW + 3 * H + 40 * M),
      estimatedArrival: iso(NOW + 12 * H + 35 * M),
      baggageBelt: '14',
    },
  })
  const screen = flightScreen(moved, NOW)
  assert.deepEqual(
    { time: screen.from.time, was: screen.from.was },
    { time: '15:40', was: '15:00' },
  )
  assert.deepEqual({ time: screen.to.time, was: screen.to.was }, { time: '16:35', was: '16:00' })
  assert.equal(screen.duration, '8 h 55')
  const notes = Object.fromEntries(screen.steps.map(step => [step.key, step.note]))
  assert.equal(notes.departs, 'Scheduled 15:00')
  assert.equal(notes.lands, 'Scheduled 16:00 · Baggage belt 14')
  assert.ok(screen.board.some(column => column.key === 'belt' && column.value === 'Belt 14'))
})

test('a leg with no board still has its two ends, its steps and its people', () => {
  const plain = leg({ flight: null, gate: null, terminal: null })
  const screen = flightScreen(plain, NOW)
  assert.deepEqual({ time: screen.from.time, was: screen.from.was }, { time: '15:00', was: null })
  assert.ok(screen.steps.length >= 5, 'the app’s own deadlines are the steps')
  assert.equal(screen.source, null)
  assert.ok(screen.board.some(column => column.key === 'gate' && !column.value))
})

test('a span reads in hours and minutes, and never runs backwards', () => {
  assert.equal(spanWords(0, 95 * M), '1 h 35')
  assert.equal(spanWords(0, 45 * M), '45 min')
  assert.equal(spanWords(0, 2 * H), '2 h')
  assert.equal(spanWords(2 * H, 0), null)
  assert.equal(spanWords(null, 0), null)
})
