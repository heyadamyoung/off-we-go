import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTIVITY_BEFORE_MS,
  HOLD_AFTER_LANDING_MS,
  LANDED_GRACE_MS,
  sameActivity,
  travelActivity,
} from '../src/live-activity-core.ts'

/* What the card on the Lock Screen says, and when there is one at all.
 *
 * On a travel day somebody looks at their phone thirty times and opens the
 * app twice. The Live Activity is the other twenty-eight glances: the leg,
 * the gate, what the countdown is to, and whether they are going to make it —
 * without unlocking, without finding the app, without the tab.
 *
 * Everything here is a function of the legs, the family's positions and a
 * clock. The countdown itself is not here: the system draws it from the
 * deadline, so the state only changes when something real does — a gate, a
 * delay, boarding, wheels down — and the card is only ever redrawn for those.
 */

const H = 3600_000
const M = 60_000
const T0 = Date.parse('2026-09-14T09:00:00Z')

const flight = over => ({
  id: 'f1',
  mode: 'flight',
  carrier: 'KLM',
  number: 'KL 677',
  fromName: 'Amsterdam Schiphol',
  fromCode: 'AMS',
  fromLng: 4.7639,
  fromLat: 52.3086,
  toName: 'Calgary',
  toCode: 'YYC',
  toLng: -114.0198,
  toLat: 51.1215,
  departsAt: new Date(T0 + 4 * H).toISOString(),
  arrivesAt: new Date(T0 + 13 * H).toISOString(),
  gate: 'D7',
  terminal: '2',
  passengers: [{ name: 'Maya' }, { name: 'Alex' }],
  deadlines: {
    checkinOpensAt: new Date(T0 + 4 * H - 24 * H).toISOString(),
    checkinClosesAt: new Date(T0 + 3 * H).toISOString(),
    bagsCloseAt: new Date(T0 + 3 * H + 15 * M).toISOString(),
    boardingAt: new Date(T0 + 3 * H + 20 * M).toISOString(),
    doorsAt: new Date(T0 + 3 * H + 45 * M).toISOString(),
  },
  status: 'scheduled',
  ...over,
})

const train = over => ({
  id: 't1',
  mode: 'train',
  carrier: 'NS',
  number: 'IC 3155',
  fromName: 'Amsterdam Centraal',
  toName: 'Schiphol',
  toLng: 4.7639,
  toLat: 52.3086,
  departsAt: new Date(T0 + 1 * H).toISOString(),
  arrivesAt: new Date(T0 + 1 * H + 20 * M).toISOString(),
  platform: '11b',
  passengers: [],
  deadlines: { boardingAt: new Date(T0 + 1 * H - 20 * M).toISOString() },
  status: 'scheduled',
  ...over,
})

test('there is no card while the day is still far off', () => {
  /* Apple ends a Live Activity after eight hours whatever we do, and a card
     that sat on the Lock Screen all night would be stale by the time it was
     wanted. It appears when somebody would plausibly be setting off. */
  const leg = flight()
  assert.equal(travelActivity([leg], [], [], T0 - 1 * H), null)
  assert.notEqual(travelActivity([leg], [], [], T0 + 4 * H - ACTIVITY_BEFORE_MS + 1), null)
})

test('before boarding the card counts down to the next deadline', () => {
  const found = travelActivity([flight()], [], [], T0 + 30 * M)
  assert.equal(found.attributes.title, 'KL 677', 'the carrier twice is the app saying KLM KL 677')
  assert.equal(found.attributes.from, 'AMS')
  assert.equal(found.attributes.to, 'YYC')
  assert.equal(found.attributes.glyph, '✈')
  assert.equal(found.state.phase, 'before')
  assert.equal(found.state.gate, 'D7')
  assert.equal(found.state.terminal, '2')
  assert.equal(found.state.deadlineLabel, 'Check-in closes')
  assert.equal(found.state.deadlineAt, new Date(T0 + 3 * H).toISOString())
  assert.equal(found.state.verdict, null, 'no positions, no verdict — never a guess')
})

test('the verdict is the make-it meter, when there are positions to judge', () => {
  const near = [{ name: 'Maya', lng: 4.7645, lat: 52.309 }]
  const found = travelActivity([flight()], near, [], T0 + 30 * M)
  assert.equal(found.state.verdict, 'here')
  assert.equal(found.state.verdictWord, 'Here')

  const far = [{ name: 'Alex', lng: 4.9, lat: 52.37 }]
  const later = travelActivity([flight()], far, [], T0 + 3 * H + 30 * M)
  assert.equal(later.state.verdict, 'late')
  assert.equal(later.state.verdictWord, 'Too far out')
})

test('once boarding has started the card says so and counts to the doors', () => {
  const found = travelActivity([flight()], [], [], T0 + 3 * H + 25 * M)
  assert.equal(found.state.phase, 'boarding')
  assert.equal(found.state.deadlineLabel, 'Doors close')
  assert.equal(found.state.deadlineAt, new Date(T0 + 3 * H + 45 * M).toISOString())
})

test('in the air the card counts down to landing, and stops judging', () => {
  const found = travelActivity(
    [flight()],
    [{ name: 'Maya', lng: 4.7645, lat: 52.309 }],
    [],
    T0 + 6 * H,
  )
  assert.equal(found.state.phase, 'airborne')
  assert.equal(found.state.deadlineLabel, 'Lands')
  assert.equal(found.state.deadlineAt, new Date(T0 + 13 * H).toISOString())
  assert.equal(found.state.verdict, null, 'a verdict about reaching a gate you have left')
})

test('a train arrives rather than lands', () => {
  const found = travelActivity([train()], [], [], T0 + 1 * H + 5 * M)
  assert.equal(found.attributes.glyph, '🚆')
  assert.equal(found.state.platform, '11b')
  assert.equal(found.state.deadlineLabel, 'Arrives')
})

test('a delay is carried onto the card in words', () => {
  const moved = flight({
    departsAt: new Date(T0 + 4 * H + 25 * M).toISOString(),
    departsWas: new Date(T0 + 4 * H).toISOString(),
    status: 'delayed',
  })
  const found = travelActivity([moved], [], [], T0 + 1 * H)
  assert.equal(found.state.moved, '25 min later')
  assert.equal(found.state.status, 'delayed')
})

test('the trail saying they landed ends the card, after a moment to say so', () => {
  /* The phone knows before the airline's app does: a slow fix at the far end
     is wheels down. The card says Landed and goes; long after, nothing. */
  const down = { lng: -114.0198, lat: 51.1215, at: new Date(T0 + 12 * H + 50 * M), speed: 3 }
  const landed = travelActivity([flight()], [], [down], T0 + 12 * H + 55 * M)
  assert.equal(landed.state.phase, 'landed')
  assert.equal(landed.state.deadlineLabel, 'Landed')
  assert.equal(landed.state.deadlineAt, null)

  const gone = travelActivity(
    [flight()],
    [],
    [down],
    T0 + 13 * H + LANDED_GRACE_MS + HOLD_AFTER_LANDING_MS + M,
  )
  assert.equal(gone, null)
})

test('with no trail to say so, a leg is over a little after it was due to be', () => {
  const found = travelActivity([flight()], [], [], T0 + 13 * H + LANDED_GRACE_MS + M)
  assert.equal(found.state.phase, 'landed')
})

test('the next leg takes the card the moment the last one is done', () => {
  /* A train to the airport and then the flight: one card, moving on. */
  const legs = [train(), flight()]
  const onTheTrain = travelActivity(legs, [], [], T0 + 1 * H + 5 * M)
  assert.equal(onTheTrain.attributes.segmentId, 't1')
  const atTheAirport = travelActivity(legs, [], [], T0 + 2 * H)
  assert.equal(atTheAirport.attributes.segmentId, 'f1', 'the train is done, the flight is next')
})

test('a leg somebody marked done is nobody’s card', () => {
  assert.equal(travelActivity([flight({ status: 'done' })], [], [], T0 + 1 * H), null)
})

test('a drive with no deadlines simply counts to departure', () => {
  const drive = flight({ id: 'd1', mode: 'drive', carrier: null, number: null, deadlines: null })
  const found = travelActivity([drive], [], [], T0 + 1 * H)
  assert.equal(found.state.deadlineLabel, 'Departs')
  assert.equal(found.state.deadlineAt, drive.departsAt)
})

test('the card is only redrawn when something on it changed', () => {
  /* The countdown ticks by itself; sending the same state every minute is a
     battery cost for nothing. A gate change is a change. */
  const a = travelActivity([flight()], [], [], T0 + 30 * M)
  const b = travelActivity([flight()], [], [], T0 + 31 * M)
  assert.equal(sameActivity(a, b), true)
  const c = travelActivity([flight({ gate: 'D9', gateWas: 'D7' })], [], [], T0 + 31 * M)
  assert.equal(sameActivity(a, c), false)
  assert.equal(sameActivity(null, null), true)
  assert.equal(sameActivity(a, null), false)
})
