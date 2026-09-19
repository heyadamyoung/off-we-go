import assert from 'node:assert/strict'
import test from 'node:test'
import { flightTimeLeft } from '../src/flight-left-core.ts'
import { deriveDeadlines } from '../src/segments-core.ts'

/* The one line on top of a leg on its day: how long there is, and nothing
   the ticket under it already says. No time of day, no gate, no size of a
   delay — those are on the ticket, the old time struck through beside the
   new one — only what the clock knows and the ticket cannot say: how long
   until the next thing, until it leaves, until it lands, since it did. */

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
  gate: '406',
  passengers: [],
  status: 'scheduled',
  deadlines: deriveDeadlines('flight', '2026-09-17T20:00:00.000Z'),
  flight:
    flight === undefined
      ? {
          status: 'scheduled',
          gate: '406',
          scheduledDeparture: '2026-09-17T20:00:00.000Z',
          scheduledArrival: '2026-09-18T03:00:00.000Z',
          sources: ['api.dublinairport.com'],
          fetchedAt: '2026-09-17T17:58:00.000Z',
        }
      : flight,
  ...rest,
})

test('before the day starts it is the next thing and how long until it', () => {
  assert.deepEqual(flightTimeLeft(leg(), NOW), { text: 'Check-in closes in 1 h', tone: 'ok' })
  assert.deepEqual(flightTimeLeft(leg(), NOW + 50 * M), {
    text: 'Check-in closes in 10 min',
    tone: 'tight',
  })
  /* With nothing left to do before it, it is how long until it leaves. */
  const bare = leg({ deadlines: null })
  assert.deepEqual(flightTimeLeft(bare, NOW), { text: 'Leaves in 2 h', tone: 'ok' })
  /* Without a board the line is the same: it never said "on time". */
  assert.equal(flightTimeLeft(leg({ flight: null }), NOW).text, 'Check-in closes in 1 h')
})

test('a delay is not said here — the ticket strikes the old time through — only what is left', () => {
  const moved = leg({
    departsAt: '2026-09-17T20:55:00.000Z',
    departsWas: '2026-09-17T20:00:00.000Z',
    status: 'delayed',
    deadlines: deriveDeadlines('flight', '2026-09-17T20:55:00.000Z'),
  })
  const said = flightTimeLeft(moved, NOW)
  assert.equal(said.text, 'Check-in closes in 1 h 55')
  assert.doesNotMatch(said.text, /delay|later|gate|\d\d:\d\d/i)
})

test('at the gate: the board word and how long until it leaves, never the gate itself', () => {
  const soon = NOW + 100 * M
  assert.deepEqual(
    flightTimeLeft(
      leg({}, { status: 'gate-open', boardingStatus: 'go-to-gate', gate: '406' }),
      soon,
    ),
    {
      text: 'Go to gate · leaves in 20 min',
      tone: 'tight',
    },
  )
  assert.deepEqual(
    flightTimeLeft(leg({}, { status: 'boarding', boardingStatus: 'boarding' }), soon),
    {
      text: 'Boarding · leaves in 20 min',
      tone: 'tight',
    },
  )
  assert.deepEqual(
    flightTimeLeft(leg({}, { status: 'boarding', boardingStatus: 'final-call' }), soon),
    {
      text: 'Final call · leaves in 20 min',
      tone: 'late',
    },
  )
  assert.equal(
    flightTimeLeft(leg({}, { status: 'gate-closed', boardingStatus: 'closed' }), soon).text,
    'Gate closed · leaves in 20 min',
  )
})

test('in the air it is how long until the ground, in whichever clock the ground keeps', () => {
  const gone = leg(
    {},
    {
      status: 'departed',
      actualDeparture: '2026-09-17T20:12:00.000Z',
      estimatedArrival: '2026-09-18T02:40:00.000Z',
    },
  )
  assert.deepEqual(flightTimeLeft(gone, NOW + 3 * H), { text: 'Lands in 5 h 40', tone: 'ok' })
  assert.deepEqual(flightTimeLeft(gone, NOW + 8 * H + 39 * M), {
    text: 'Lands in 1 min',
    tone: 'ok',
  })
  assert.deepEqual(flightTimeLeft(gone, NOW + 8 * H + 40 * M), { text: 'Lands now', tone: 'ok' })
  /* The estimate behind us and no landed word yet: due, not landed. */
  assert.deepEqual(flightTimeLeft(gone, NOW + 8 * H + 50 * M), {
    text: 'Due to have landed 10 min ago',
    tone: 'done',
  })
  const blind = leg({ arrivesAt: null }, { status: 'departed' })
  assert.equal(flightTimeLeft(blind, NOW + 3 * H).text, 'In the air')
})

test('landed is how long ago, and never a belt or a time — the ticket has those', () => {
  const down = leg(
    {},
    { status: 'landed', actualArrival: '2026-09-18T02:41:00.000Z', baggageBelt: '5' },
  )
  assert.deepEqual(flightTimeLeft(down, NOW + 9 * H), { text: 'Landed 19 min ago', tone: 'done' })
  /* A board that says landed against an estimate still ahead: landed, full stop. */
  const early = leg({}, { status: 'landed', estimatedArrival: '2026-09-18T03:00:00.000Z' })
  assert.deepEqual(flightTimeLeft(early, NOW + 8 * H), { text: 'Landed', tone: 'done' })
  const train = leg(
    { mode: 'train' },
    { status: 'arrived', actualArrival: '2026-09-18T02:41:00.000Z' },
  )
  assert.equal(flightTimeLeft(train, NOW + 9 * H).text, 'Arrived 19 min ago')
})

test('past the time with no board word it is what is due, not what happened', () => {
  assert.deepEqual(flightTimeLeft(leg({ flight: null }), NOW + 3 * H), {
    text: 'Due to land in 6 h',
    tone: 'ok',
  })
  assert.equal(
    flightTimeLeft(leg({ flight: null }), NOW + 10 * H).text,
    'Due to have landed 1 h ago',
  )
  const train = leg({
    mode: 'train',
    flight: null,
    status: 'delayed',
    departsAt: '2026-09-17T20:25:00.000Z',
    departsWas: '2026-09-17T20:00:00.000Z',
    arrivesAt: '2026-09-17T20:45:00.000Z',
    deadlines: deriveDeadlines('train', '2026-09-17T20:25:00.000Z'),
  })
  assert.equal(flightTimeLeft(train, NOW + 150 * M).text, 'Due to arrive in 15 min')
  assert.deepEqual(flightTimeLeft(train, NOW + 3 * H), {
    text: 'Due to have arrived 15 min ago',
    tone: 'done',
  })
  const quiet = leg({}, { status: 'scheduled' })
  assert.equal(flightTimeLeft(quiet, NOW + 3 * H).text, 'Due to land in 6 h')
})

test('cancelled and diverted are said, whoever said them', () => {
  assert.deepEqual(flightTimeLeft(leg({}, { status: 'cancelled' }), NOW), {
    text: 'Cancelled',
    tone: 'late',
  })
  assert.deepEqual(flightTimeLeft(leg({ status: 'cancelled', flight: null }), NOW), {
    text: 'Cancelled',
    tone: 'late',
  })
  assert.deepEqual(flightTimeLeft(leg({}, { status: 'diverted' }), NOW), {
    text: 'Diverted',
    tone: 'late',
  })
})
