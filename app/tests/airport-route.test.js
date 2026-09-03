import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeIndoorRoute,
  nearestNode,
  planGateRoute,
  routeSlices,
  stepMetres,
  walkGraph,
} from '../src/airport-route-core.ts'

const path = (coords, levels, stair = false) => ({
  type: 'Feature',
  properties: { kind: 'path', levels, stair, name: '', ref: '', cat: '' },
  geometry: { type: 'LineString', coordinates: coords },
})
const lift = (at, levels) => ({
  type: 'Feature',
  properties: { kind: 'lift', levels, stair: false, name: 'Lift', ref: '', cat: 'lift' },
  geometry: { type: 'Point', coordinates: at },
})

// One corridor east along a parallel: A --- B --- C, roughly 68 m per step.
const A = [4.76, 52.31],
  B = [4.761, 52.31],
  C = [4.762, 52.31]

test('a walk along one corridor routes end to end with no floor changes', () => {
  const graph = walkGraph([path([A, B, C], [0])])
  const route = planGateRoute(graph, A, { ref: 'D1', lng: C[0], lat: C[1], levels: [0] })

  assert.ok(route)
  assert.equal(route.ref, 'D1')
  assert.equal(route.steps.length, 3)
  assert.deepEqual(route.transitions, [])
  const straight = stepMetres(A, C)
  assert.ok(Math.abs(route.metres - straight) < 1, `${route.metres} vs ${straight}`)
})

test('stairs carry a route between floors, and the story says so', () => {
  const graph = walkGraph([
    path([A, B], [0]),
    path([B, C], [1]),
    path([B, [4.7611, 52.3101]], [0, 1], true), // a staircase at B
  ])
  const route = planGateRoute(graph, A, { ref: 'D2', lng: C[0], lat: C[1], levels: [1] })

  assert.ok(route)
  assert.equal(route.transitions.length, 1)
  assert.deepEqual(
    {
      from: route.transitions[0].from,
      to: route.transitions[0].to,
      kind: route.transitions[0].kind,
    },
    { from: 0, to: 1, kind: 'stairs' },
  )
  // vertical hops carry a penalty but no distance: the walk is still A→B→C
  assert.ok(Math.abs(route.metres - stepMetres(A, C)) < 1)
  assert.match(describeIndoorRoute(route), /^\d+ m walk · stairs to level 1$/)
})

test('a lift connects floors where no stairs do', () => {
  const graph = walkGraph([path([A, B], [0]), path([B, C], [1]), lift(B, [0, 1])])
  const route = planGateRoute(graph, A, { ref: 'D3', lng: C[0], lat: C[1], levels: [1] })

  assert.ok(route)
  assert.equal(route.transitions[0].kind, 'lift')
  assert.match(describeIndoorRoute(route), /lift to level 1/)
})

test('two networks that never touch yield no route rather than a wrong one', () => {
  const graph = walkGraph([
    path([A, B], [0]),
    path(
      [
        [4.78, 52.32],
        [4.781, 52.32],
      ],
      [0],
    ), // a different pier entirely
  ])
  const route = planGateRoute(graph, A, { ref: 'E9', lng: 4.781, lat: 52.32, levels: [0] })
  assert.equal(route, null)
})

test('endpoints snap to the network only from nearby', () => {
  const graph = walkGraph([path([A, B], [0])])
  assert.ok(nearestNode(graph, [4.7601, 52.3101])) // a few metres off
  assert.equal(nearestNode(graph, [4.8, 52.35]), null) // kilometres away
})

test('the drawn route is solid on this floor, faint on the other, marked between', () => {
  const graph = walkGraph([
    path([A, B], [0]),
    path([B, C], [1]),
    path([B, [4.7611, 52.3101]], [0, 1], true),
  ])
  const route = planGateRoute(graph, A, { ref: 'D2', lng: C[0], lat: C[1], levels: [1] })

  const ground = routeSlices(route, 0)
  assert.deepEqual(ground.map(f => f.properties.kind).sort(), [
    'route-away',
    'route-here',
    'transfer',
  ])
  const marker = ground.find(f => f.properties.kind === 'transfer')
  assert.equal(marker.properties.name, 'Stairs to level 1')

  const upstairs = routeSlices(route, 1)
  const up = upstairs.find(f => f.properties.kind === 'transfer')
  assert.equal(up.properties.name, 'Stairs from level 0')
})

test('nearby fragments are sewn together, so a gate on a stub still routes', () => {
  // corridor, 34 m gap, corridor, 34 m gap, corridor — the Schiphol shape
  const graph = walkGraph([
    path([A, B], [0]),
    path(
      [
        [4.7615, 52.31],
        [4.7625, 52.31],
      ],
      [0],
    ),
    path(
      [
        [4.763, 52.31],
        [4.764, 52.31],
      ],
      [0],
    ),
  ])
  const route = planGateRoute(graph, A, { ref: 'G9', lng: 4.764, lat: 52.31, levels: [0] })

  assert.ok(route, 'the chain of fragments should be walkable end to end')
  assert.ok(
    route.steps.some(s => s.via === 'gap'),
    'the walk crosses the unmapped stretches',
  )
  // the gaps count as real ground: roughly the straight A-to-gate distance
  const straight = stepMetres(A, [4.764, 52.31])
  assert.ok(Math.abs(route.metres - straight) < 5, `${route.metres} vs ${straight}`)
})

test('an unmapped stretch wider than the ceiling still refuses honestly', () => {
  const graph = walkGraph([
    path([A, B], [0]),
    path(
      [
        [4.771, 52.31],
        [4.772, 52.31],
      ],
      [0],
    ), // ~680 m away: another building
  ])
  assert.equal(planGateRoute(graph, A, { ref: 'H1', lng: 4.772, lat: 52.31, levels: [0] }), null)
})

test('two fragments sew to each other even when the main network is far away', () => {
  // the Heathrow shape: a big network in one corner, and two pier fragments
  // beside each other half a kilometre from it
  const main = []
  for (let i = 0; i < 12; i++) main.push([4.75 + i * 0.0001, 52.302])
  const graph = walkGraph([
    path(main, [0]),
    path(
      [
        [4.76, 52.31],
        [4.761, 52.31],
      ],
      [0],
    ),
    path(
      [
        [4.7612, 52.3101],
        [4.762, 52.3101],
      ],
      [0],
    ), // ~25 m from the first
  ])
  const route = planGateRoute(graph, [4.76, 52.31], {
    ref: 'T9',
    lng: 4.762,
    lat: 52.3101,
    levels: [0],
  })
  assert.ok(route, 'neighbouring fragments should not need the main network to reach each other')
})

test('nodes standing in the same hall are connected through it', () => {
  // two corridors dead-ending in one long walkable hall, too far apart for
  // gap-stitching: only walking across the hall can join them
  const hall = {
    type: 'Feature',
    properties: { kind: 'walk', levels: [0], stair: false, name: '', ref: '', cat: '' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [4.7515, 52.3095],
          [4.7605, 52.3095],
          [4.7605, 52.3105],
          [4.7515, 52.3105],
          [4.7515, 52.3095],
        ],
      ],
    },
  }
  const graph = walkGraph([
    path(
      [
        [4.75, 52.31],
        [4.752, 52.31],
      ],
      [0],
    ), // ends inside the hall's west edge
    path(
      [
        [4.76, 52.31],
        [4.762, 52.31],
      ],
      [0],
    ), // begins inside its east edge, ~545 m away
    hall,
  ])
  const route = planGateRoute(graph, [4.75, 52.31], {
    ref: 'C2',
    lng: 4.762,
    lat: 52.31,
    levels: [0],
  })
  assert.ok(route, 'the hall should carry the walk between the two corridors')
  assert.ok(route.steps.some(s => s.via === 'hall'))
})

test('the drawn walk reaches the actual gate and the actual start', () => {
  const graph = walkGraph([path([A, B, C], [0])])
  const start = [4.7599, 52.31] // a few metres shy of the corridor
  const gate = { ref: 'D9', lng: 4.762, lat: 52.3104, levels: [0] } // ~44 m off its end
  const route = planGateRoute(graph, start, gate)

  assert.ok(route)
  assert.deepEqual([route.steps[0].lng, route.steps[0].lat], start)
  const last = route.steps[route.steps.length - 1]
  assert.deepEqual([last.lng, last.lat], [gate.lng, gate.lat])
  const walked = stepMetres(start, A) + stepMetres(A, C) + stepMetres(C, [gate.lng, gate.lat])
  assert.ok(Math.abs(route.metres - walked) < 2, `${route.metres} vs ${walked}`)
})
