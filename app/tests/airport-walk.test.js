import assert from 'node:assert/strict'
import test from 'node:test'
import { indoorFeatures } from '../src/airport-indoor-core.ts'
import {
  advanceWalk,
  currentStage,
  sameAirport,
  skipStage,
  WALK_START,
  walkLeg,
  walkStages,
  walkStop,
} from '../src/airport-walk-core.ts'

/* The walk through the terminal, as a function of a leg, a floor plan, a
   position and a clock — Schiphol's shape, the sample flight's board. */

const NOW = Date.parse('2026-09-18T09:00:00Z')
const iso = minutes => new Date(NOW + minutes * 60_000).toISOString()

const DESKS = [4.7628, 52.3098] // zone 3, desks 13–20
const SECURITY = [4.7638, 52.31]
const GATE = [4.7652, 52.3109] // E19, upstairs
const PLAZA = [4.7615, 52.3094] // where the family is standing, a hundred metres short

const node = (id, [lon, lat], tags) => ({ type: 'node', id, lon, lat, tags })
const terminal = indoorFeatures({
  elements: [
    node(1, [4.762, 52.3091], { aeroway: 'checkin', ref: '1-8', level: '0' }),
    node(2, [4.7624, 52.3094], { aeroway: 'checkin', ref: '9-12', level: '0' }),
    node(3, DESKS, { aeroway: 'checkin', ref: '13-20', level: '0' }),
    node(4, [4.7633, 52.3101], { aeroway: 'checkin', ref: '21-30', level: '0' }),
    node(5, SECURITY, { aeroway: 'security_check', level: '0' }),
    node(6, [4.7648, 52.3107], { aeroway: 'gate', ref: 'E18', level: '2' }),
    node(7, GATE, { aeroway: 'gate', ref: 'E19', level: '2' }),
  ],
})

const board = {
  status: 'scheduled',
  gate: 'E19',
  checkinZone: '3',
  checkinDesks: '13-20',
  securityWaitMinutes: 6,
  walkMinutes: 9,
}
const leg = (over = {}) => ({
  id: 'kl677',
  mode: 'flight',
  carrier: 'KLM',
  number: 'KL 677',
  fromName: 'Amsterdam Schiphol',
  fromCode: 'AMS',
  fromLng: 4.7683,
  fromLat: 52.3105,
  toName: 'Calgary',
  departsAt: iso(180),
  departTz: 'Europe/Amsterdam',
  passengers: [],
  status: 'scheduled',
  bags: { checked: '1 × 23 kg' },
  deadlines: { bagsCloseAt: iso(135), boardingAt: iso(140) },
  flight: board,
  ...over,
})

test('the flight to walk for is the one whose airport the phone is at, in the hours before it', () => {
  assert.equal(walkLeg([leg()], PLAZA, NOW)?.id, 'kl677')
  assert.equal(walkLeg([leg()], [4.8852, 52.36], NOW), null, 'the museum steps are not the airport')
  assert.equal(walkLeg([leg()], null, NOW), null, 'no fix, no walk')
  assert.equal(walkLeg([leg({ departsAt: iso(9 * 60) })], PLAZA, NOW), null, 'nine hours early')
  assert.equal(walkLeg([leg({ departsAt: iso(-60) })], PLAZA, NOW), null, 'an hour after it left')
  assert.equal(walkLeg([leg({ flight: { status: 'departed' } })], PLAZA, NOW), null)
  assert.equal(walkLeg([leg({ status: 'done' })], PLAZA, NOW), null)
  // A delay moves the window with it: the board's estimate outranks the plan.
  const delayed = leg({
    departsAt: iso(-60),
    flight: { status: 'delayed', estimatedDeparture: iso(30) },
  })
  assert.equal(walkLeg([delayed], PLAZA, NOW)?.id, 'kl677')
  // Two flights from here today: the earlier one is the walk.
  const later = leg({ id: 'later', departsAt: iso(300) })
  assert.equal(walkLeg([later, leg()], PLAZA, NOW)?.id, 'kl677')
  assert.equal(walkLeg([leg({ mode: 'train' })], PLAZA, NOW), null, 'a train has no gate')
})

test("bag drop at the board's desks, security beside them, then the gate", () => {
  const stages = walkStages(leg(), terminal, PLAZA, NOW)
  assert.deepEqual(
    stages.map(stage => stage.kind),
    ['bagdrop', 'security', 'gate'],
  )
  const [bags, security, gate] = stages
  assert.equal(bags.title, 'Bag drop')
  assert.equal(bags.detail, 'Zone 3 · Desks 13–20')
  assert.deepEqual([bags.at.lng, bags.at.lat], DESKS, 'the desks the board named, not the nearest')
  assert.equal(security.title, 'Security')
  assert.equal(security.detail, '6 min queue')
  assert.deepEqual([security.at.lng, security.at.lat], SECURITY)
  assert.equal(gate.title, 'Gate E19')
  assert.deepEqual(gate.at.levels, [2])
  assert.equal(gate.detail, '', 'mapped, so the route says how far — not the board')
})

test('a gate the board has not named is still the last stage, and says when it will', () => {
  const dublin = leg({
    gate: null,
    departTz: 'Europe/Dublin',
    flight: {
      status: 'scheduled',
      checkinZone: '6',
      checkinDesks: '606-609',
      goToGateTime: '2026-09-18T11:15:00Z',
    },
  })
  const stages = walkStages(dublin, terminal, PLAZA, NOW)
  const gate = stages[stages.length - 1]
  assert.equal(gate.kind, 'gate')
  assert.equal(gate.title, 'Gate')
  assert.equal(gate.detail, 'not announced yet · by 12:15')
  assert.equal(gate.at, null)
  // The watch writes the gate onto the leg when the board names it.
  const named = walkStages({ ...dublin, gate: 'E19' }, terminal, PLAZA, NOW)
  assert.equal(named[named.length - 1].title, 'Gate E19')
  assert.ok(named[named.length - 1].at)
})

test('a gate the map lacks is walked by the board’s minutes, and the call is passed on', () => {
  const stages = walkStages(
    leg({ gate: 'F12', flight: { ...board, gate: 'F12', boardingStatus: 'boarding' } }),
    terminal,
    PLAZA,
    NOW,
  )
  const gate = stages[stages.length - 1]
  assert.equal(gate.title, 'Gate F12')
  assert.equal(gate.at, null)
  assert.equal(gate.detail, 'Boarding · 9 min walk')
})

test('no bag to drop, or the desks closed, and the walk starts at security', () => {
  const carryOn = walkStages(leg({ bags: { carryOn: '1 × 12 kg' } }), terminal, PLAZA, NOW)
  assert.deepEqual(
    carryOn.map(stage => stage.kind),
    ['security', 'gate'],
  )
  const closed = walkStages(leg(), terminal, PLAZA, Date.parse(iso(136)))
  assert.deepEqual(
    closed.map(stage => stage.kind),
    ['security', 'gate'],
  )
  // Bags unknown: the desks are shown, because a wrong "skip" costs a flight.
  assert.equal(walkStages(leg({ bags: null }), terminal, PLAZA, NOW)[0].kind, 'bagdrop')
})

test('desks are matched by their numbers, then by the zone, and never guessed', () => {
  const byZone = indoorFeatures({
    elements: [
      node(1, [4.762, 52.3091], { name: 'Check-in 2', level: '0' }),
      node(2, DESKS, { name: 'Check-in 3', level: '0' }),
    ],
  })
  const zone = walkStages(leg({ flight: { ...board, checkinDesks: null } }), byZone, PLAZA, NOW)
  assert.equal(zone[0].at.ref, 'Check-in 3')
  // Pearson names its aisles in words.
  const aisles = indoorFeatures({
    elements: [
      node(1, DESKS, { name: 'Aisle 5 check-in', level: '0' }),
      node(2, SECURITY, { name: 'Aisle 8 check-in', level: '0' }),
    ],
  })
  const aisle = walkStages(
    leg({ flight: { status: 'scheduled', gate: 'E19', checkinZone: 'Aisle 5' } }),
    aisles,
    PLAZA,
    NOW,
  )[0]
  assert.equal(aisle.detail, 'Aisle 5')
  assert.deepEqual([aisle.at.lng, aisle.at.lat], DESKS)
  // Nothing matches among several: the words stand, the map stays honest.
  const none = walkStages(
    leg({ flight: { ...board, checkinZone: '6', checkinDesks: '606-609' } }),
    terminal,
    PLAZA,
    NOW,
  )[0]
  assert.equal(none.detail, 'Zone 6 · Desks 606–609')
  assert.equal(none.at, null)
  // One check-in in the whole terminal is not a guess.
  const only = indoorFeatures({ elements: [node(1, DESKS, { aeroway: 'checkin', level: '0' })] })
  const lone = walkStages(
    leg({ flight: { ...board, checkinZone: '6', checkinDesks: '606-609' } }),
    only,
    PLAZA,
    NOW,
  )[0]
  assert.deepEqual([lone.at.lng, lone.at.lat], DESKS)
})

test('the walk advances the way the itinerary does: reached in range, done on leaving', () => {
  const stages = walkStages(leg(), terminal, PLAZA, NOW)
  let state = advanceWalk(WALK_START, stages, PLAZA)
  assert.equal(currentStage(stages, state).kind, 'bagdrop')
  assert.equal(state.reached, null, 'a hundred metres short is not there')
  state = advanceWalk(state, stages, [4.76285, 52.3098]) // at the desks
  assert.equal(state.reached, 'bagdrop')
  state = advanceWalk(state, stages, [4.7632, 52.3099]) // a few steps off: still there
  assert.equal(currentStage(stages, state).kind, 'bagdrop')
  assert.equal(state.reached, 'bagdrop')
  state = advanceWalk(state, stages, [4.7605, 52.3092]) // walked off, 170 m: gone
  assert.equal(currentStage(stages, state).kind, 'security')
  assert.equal(state.reached, null)
  state = advanceWalk(state, stages, SECURITY)
  assert.equal(state.reached, 'security')
  state = advanceWalk(state, stages, GATE) // through, upstairs, at the gate
  assert.equal(currentStage(stages, state).kind, 'gate')
  assert.equal(state.reached, 'gate')
  state = advanceWalk(state, stages, [4.7672, 52.312]) // a coffee at G9, 180 m off
  assert.equal(currentStage(stages, state).kind, 'gate', 'the gate is never done')
  assert.equal(state.reached, null)
  assert.equal(advanceWalk(state, stages, null), state, 'no fix, no change')
})

test('found at the gate straight away, the desks and security are behind them', () => {
  const stages = walkStages(leg(), terminal, GATE, NOW)
  const state = advanceWalk(WALK_START, stages, GATE)
  assert.deepEqual(state.done, ['bagdrop', 'security'])
  assert.equal(state.reached, 'gate')
})

test('the traveller can say they are done here, except at the gate', () => {
  const stages = walkStages(leg(), terminal, PLAZA, NOW)
  let state = skipStage(WALK_START, stages)
  assert.equal(currentStage(stages, state).kind, 'security')
  state = skipStage(state, stages)
  assert.equal(currentStage(stages, state).kind, 'gate')
  assert.equal(skipStage(state, stages), state)
})

test("the walk opens the itinerary's own airport stop when there is one", () => {
  const schiphol = { id: 's1', name: 'Schiphol Airport', icon: 'plane', lng: 4.7639, lat: 52.3105 }
  const hotel = { id: 'h', name: 'Hotel Jakarta', lng: 4.935, lat: 52.3793 }
  assert.equal(walkStop(leg(), [hotel, schiphol]).id, 's1')
  const made = walkStop(leg(), [hotel])
  assert.equal(made.name, 'Amsterdam Schiphol')
  assert.equal(made.icon, 'plane')
  assert.ok(sameAirport(schiphol, leg()))
  assert.ok(!sameAirport(hotel, leg()))
})

test('a flight boarding from a remote stand still has somewhere to walk to', () => {
  /* Pearson tags its remote stands as gates with bare numbers, out on the
     apron; the map does not draw them as gates, but a leg whose gate is
     "541" walks to the stand of that number. */
  const size = 0.004
  const outline = {
    type: 'way',
    id: 100,
    tags: { aeroway: 'terminal' },
    geometry: [
      { lon: 4.7639 - size, lat: 52.3105 - size },
      { lon: 4.7639 + size, lat: 52.3105 - size },
      { lon: 4.7639 + size, lat: 52.3105 + size },
      { lon: 4.7639 - size, lat: 52.3105 + size },
      { lon: 4.7639 - size, lat: 52.3105 - size },
    ],
  }
  const apron = indoorFeatures({
    elements: [
      outline,
      node(7, GATE, { aeroway: 'gate', ref: 'E19' }),
      node(8, [4.775, 52.302], { aeroway: 'gate', ref: '541' }),
    ],
  })
  assert.equal(apron.find(f => f.properties.ref === '541').properties.kind, 'stand')
  const stages = walkStages(leg({ gate: '541' }), apron, PLAZA, NOW)
  const gate = stages[stages.length - 1]
  assert.equal(gate.title, 'Gate 541')
  assert.deepEqual([gate.at?.lng, gate.at?.lat], [4.775, 52.302])
  assert.equal(walkStages(leg({ gate: 'E19' }), apron, PLAZA, NOW).at(-1).at?.ref, 'E19')
})
