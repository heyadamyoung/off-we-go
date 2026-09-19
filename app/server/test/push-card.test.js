import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CARD_BEFORE_MS,
  DELAY_WAKES_MINUTES,
  HOLD_AFTER_LANDING_MS,
  WAKES_PER_DAY_FOLLOWER,
  WAKES_PER_LEG,
  decidePush,
  flightCard,
  flightName,
  sameCard,
  whatWakes,
  whoIsOn,
} from '../src/push/card.js'

/* The card a phone is shown for a leg, and what about it is worth a sound:
   a state, not an event, so a phone is told again only when the card reads
   differently, and woken only for a gate, a delay, a cancellation, boarding
   and the landing — each to the people it concerns, and never past the
   caps. The rest replaces the card quietly. */

const H = 3600_000
const M = 60_000
const DEPARTS = Date.parse('2026-09-19T17:00:00Z')
const ARRIVES = Date.parse('2026-09-19T19:25:00Z')

const leg = (changes = {}) => ({
  id: 'leg-1',
  tripId: 'trip-1',
  mode: 'flight',
  carrier: 'Air Canada',
  number: 'AC 1115',
  fromCode: 'YYZ',
  fromName: 'Toronto Pearson',
  toCode: 'YQR',
  toName: 'Regina',
  departsAt: new Date(DEPARTS).toISOString(),
  arrivesAt: new Date(ARRIVES).toISOString(),
  departTz: 'America/Toronto',
  arriveTz: 'America/Regina',
  departsWas: null,
  gate: null,
  terminal: null,
  status: 'scheduled',
  passengers: [{ name: 'Maya Example' }, { name: 'Alex Example' }],
  deadlines: { boardingAt: new Date(DEPARTS - 40 * M).toISOString() },
  ...changes,
})

const board = (changes = {}) => ({
  status: 'scheduled',
  gate: 'D43',
  terminal: '1',
  scheduledDeparture: new Date(DEPARTS).toISOString(),
  estimatedDeparture: null,
  actualDeparture: null,
  scheduledArrival: new Date(ARRIVES).toISOString(),
  estimatedArrival: null,
  actualArrival: null,
  boardingStatus: null,
  baggageBelt: null,
  ...changes,
})

test('the card names the flight and the people on it', () => {
  assert.equal(flightName(leg()), 'AC 1115')
  assert.equal(flightName(leg({ carrier: 'KLM', number: '677' })), 'KL 677')
  assert.equal(whoIsOn(leg()), 'Maya and Alex')
  assert.equal(whoIsOn(leg({ passengers: [{ name: 'Maya' }] })), 'Maya')
  assert.equal(whoIsOn(leg({ passengers: [] })), null)
})

test('there is no card until four hours before, and the card says the plan in words', () => {
  assert.equal(flightCard(leg(), board(), DEPARTS - CARD_BEFORE_MS - M), null)
  const first = flightCard(leg(), board(), DEPARTS - CARD_BEFORE_MS + M)
  assert.equal(first.phase, 'before')
  assert.equal(first.title, 'AC 1115 YYZ → YQR')
  /* Toronto's clock: 17:00Z is 13:00 there, boarding forty minutes before. */
  assert.equal(first.body, 'On time · gate D43 · boarding 12:20')
  const quiet = flightCard(leg(), null, DEPARTS - 2 * H)
  assert.equal(quiet.body, 'Scheduled · gate not announced yet · boarding 12:20')
  const late = flightCard(
    leg(),
    board({ estimatedDeparture: new Date(DEPARTS + 25 * M).toISOString() }),
    DEPARTS - 2 * H,
  )
  assert.equal(late.body, 'Delayed 25 min · leaves 13:25 · gate D43')
  assert.equal(late.moved, 25)
})

test('boarding, airborne, landed and gone, in the airports’ own clocks', () => {
  const boarding = flightCard(leg(), board({ boardingStatus: 'boarding' }), DEPARTS - 30 * M)
  assert.equal(`${boarding.phase}: ${boarding.body}`, 'boarding: Boarding · gate D43')
  const last = flightCard(leg(), board({ boardingStatus: 'final-call' }), DEPARTS - 10 * M)
  assert.equal(last.body, 'Final call · gate D43')
  const up = flightCard(
    leg(),
    board({ status: 'departed', actualDeparture: new Date(DEPARTS + 12 * M).toISOString() }),
    DEPARTS + 30 * M,
  )
  /* Regina is an hour behind Toronto: lands 19:25Z is 13:25 there. */
  assert.equal(`${up.phase}: ${up.body}`, 'airborne: Departed 13:12 · lands 13:25')
  const down = flightCard(
    leg(),
    board({ status: 'landed', actualArrival: new Date(ARRIVES).toISOString(), baggageBelt: '2' }),
    ARRIVES + 5 * M,
  )
  assert.equal(`${down.phase}: ${down.body}`, 'landed: Landed 13:25 · baggage claim belt 2')
  assert.equal(
    flightCard(
      leg(),
      board({ status: 'landed', actualArrival: new Date(ARRIVES).toISOString() }),
      ARRIVES + HOLD_AFTER_LANDING_MS + M,
    ),
    null,
    'the card goes a quarter of an hour after landing',
  )
  /* No board ever said it landed: the card goes a while after it was due. */
  assert.equal(flightCard(leg(), board(), ARRIVES + 25 * M), null)
})

test('a cancellation is a card at any hour, and stays an hour past the departure', () => {
  const cancelled = flightCard(leg(), board({ status: 'cancelled' }), DEPARTS - 20 * H)
  assert.equal(`${cancelled.phase}: ${cancelled.body}`, 'cancelled: Cancelled · was leaving 13:00')
  assert.equal(flightCard(leg({ status: 'cancelled' }), null, DEPARTS - 20 * H).phase, 'cancelled')
  assert.equal(flightCard(leg(), board({ status: 'cancelled' }), DEPARTS + 2 * H), null)
})

test('what wakes whom: the gate and boarding for the people on the leg, the landing for the people at home, a delay or a cancellation for everybody', () => {
  const now = DEPARTS - 2 * H
  const first = flightCard(leg(), board(), now)
  /* A first card that already carries the gate is the plan, not news. */
  assert.equal(whatWakes(null, first, 'traveller'), null)
  assert.equal(whatWakes(null, first, 'follower'), null)
  const moved = flightCard(leg(), board({ gate: 'D51' }), now)
  assert.equal(whatWakes(first, moved, 'traveller'), 'gate')
  assert.equal(whatWakes(first, moved, 'follower'), null)
  const named = flightCard(leg(), board({ gate: 'D43' }), now)
  const unnamed = flightCard(leg(), board({ gate: null }), now)
  assert.equal(whatWakes(unnamed, named, 'traveller'), 'gate', 'a gate first named is news')
  const boarding = flightCard(leg(), board({ boardingStatus: 'boarding' }), DEPARTS - 30 * M)
  assert.equal(whatWakes(first, boarding, 'traveller'), 'boarding')
  assert.equal(whatWakes(first, boarding, 'follower'), null)
  const final = flightCard(leg(), board({ boardingStatus: 'final-call' }), DEPARTS - 10 * M)
  assert.equal(whatWakes(boarding, final, 'traveller'), 'boarding')
  const late = flightCard(
    leg(),
    board({ estimatedDeparture: new Date(DEPARTS + DELAY_WAKES_MINUTES * M).toISOString() }),
    now,
  )
  assert.equal(whatWakes(first, late, 'traveller'), 'delay')
  assert.equal(whatWakes(first, late, 'follower'), 'delay')
  assert.equal(
    whatWakes(null, late, 'follower'),
    'delay',
    'a first card already a quarter-hour late',
  )
  const nudge = flightCard(
    leg(),
    board({ estimatedDeparture: new Date(DEPARTS + 7 * M).toISOString() }),
    now,
  )
  assert.equal(whatWakes(first, nudge, 'traveller'), null, 'seven minutes is a quiet update')
  const up = flightCard(
    leg(),
    board({ status: 'departed', actualDeparture: new Date(DEPARTS).toISOString() }),
    DEPARTS + 20 * M,
  )
  assert.equal(whatWakes(boarding, up, 'traveller'), null, 'the people on the plane know it left')
  assert.equal(
    whatWakes(boarding, up, 'follower'),
    null,
    'the people at home hear the landing, not the leaving',
  )
  const down = flightCard(
    leg(),
    board({ status: 'landed', actualArrival: new Date(ARRIVES).toISOString(), baggageBelt: '2' }),
    ARRIVES + M,
  )
  assert.equal(whatWakes(up, down, 'follower'), 'landed')
  assert.equal(whatWakes(up, down, 'traveller'), null)
  const cancelled = flightCard(leg(), board({ status: 'cancelled' }), now)
  assert.equal(whatWakes(first, cancelled, 'traveller'), 'cancelled')
  assert.equal(whatWakes(first, cancelled, 'follower'), 'cancelled')
  assert.equal(whatWakes(cancelled, cancelled, 'follower'), null)
})

test('a phone is told only when the card reads differently, woken only within the caps, and cleared when the card goes', () => {
  const now = DEPARTS - 2 * H
  const first = flightCard(leg(), board(), now)
  assert.deepEqual(decidePush({ previous: null, next: first, role: 'traveller' }), {
    send: 'card',
    audible: false,
    kind: 'update',
  })
  assert.equal(decidePush({ previous: first, next: first, role: 'traveller' }), null)
  assert.ok(
    sameCard(first, flightCard(leg(), board(), now + M)),
    'a minute later it reads the same',
  )
  const moved = flightCard(leg(), board({ gate: 'D51' }), now)
  assert.deepEqual(decidePush({ previous: first, next: moved, role: 'traveller' }), {
    send: 'card',
    audible: true,
    kind: 'gate',
  })
  assert.deepEqual(
    decidePush({ previous: first, next: moved, role: 'traveller', woken: WAKES_PER_LEG }),
    { send: 'card', audible: false, kind: 'gate' },
    'past the cap the card still changes, quietly',
  )
  const down = flightCard(
    leg(),
    board({ status: 'landed', actualArrival: new Date(ARRIVES).toISOString() }),
    ARRIVES + M,
  )
  assert.equal(
    decidePush({ previous: first, next: down, role: 'follower', wokenToday: 0 }).audible,
    true,
  )
  assert.equal(
    decidePush({
      previous: first,
      next: down,
      role: 'follower',
      wokenToday: WAKES_PER_DAY_FOLLOWER,
    }).audible,
    false,
    'somebody at home is woken three times a day at most',
  )
  assert.deepEqual(decidePush({ previous: down, next: null, role: 'follower' }), { send: 'clear' })
  assert.equal(decidePush({ previous: null, next: null, role: 'follower' }), null)
})
