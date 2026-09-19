import assert from 'node:assert/strict'
import test from 'node:test'
import { autoIndoorMove, cameraOverTerminal } from '../src/airport-camera-core.ts'
import {
  defaultLevel,
  indoorFeatures,
  isAirportStop,
  levelsOf,
  onLevel,
  overpassQueryFor,
  parseLevels,
} from '../src/airport-indoor-core.ts'

test('an airport is recognised by its name or keywords, a hotel is not', () => {
  assert.equal(isAirportStop({ name: 'Schiphol Airport', kw: 'airport,terminal' }), true)
  assert.equal(isAirportStop({ name: 'AMS', kw: 'airport' }), true)
  // The plane icon is a declaration all by itself: real stops get named
  // "Schiphol" or "EDI", which no wording regex can catch.
  assert.equal(isAirportStop({ name: 'Schiphol', icon: 'plane' }), true)
  assert.equal(isAirportStop({ name: 'Schiphol' }), false)
  assert.equal(isAirportStop({ name: 'Aéroport de Paris-Charles-de-Gaulle' }), true)
  assert.equal(isAirportStop({ name: 'Hotel Jakarta', kw: 'hotel,lobby' }), false)
  // "terminal" alone is a ferry terminal as often as an airport
  assert.equal(isAirportStop({ name: 'Ferry Terminal', kw: 'terminal' }), false)
  assert.equal(isAirportStop(null), false)
})

test('the Overpass query asks around the stop and brings geometry back', () => {
  const query = overpassQueryFor(4.7639, 52.3105)
  assert.match(query, /\(around:1500,52\.31050,4\.76390\)/)
  assert.match(query, /way\["indoor"\]/)
  assert.match(query, /node\["aeroway"="gate"\]/)
  assert.match(query, /footway\|corridor\|steps/)
  assert.match(query, /node\["highway"="elevator"\]/)
  // the desks and the security filter, for the walk on the day of the flight
  assert.match(
    query,
    /node\["aeroway"~"\^\(checkin\|check-in\|check_in\|security_check\|security\)\$"\]/,
  )
  assert.match(query, /way\["barrier"="security_check"\]/)
  assert.match(query, /out geom/)
})

test('level tags parse in all the shapes OSM writes them', () => {
  assert.deepEqual(parseLevels('1'), [1])
  assert.deepEqual(parseLevels('-1'), [-1])
  assert.deepEqual(parseLevels('0;1'), [0, 1])
  assert.deepEqual(parseLevels('0-2'), [0, 1, 2])
  assert.deepEqual(parseLevels('0.5'), [0.5])
  assert.deepEqual(parseLevels(''), [])
  assert.deepEqual(parseLevels('ground'), [])
  assert.deepEqual(parseLevels(undefined), [])
})

const OVERPASS = {
  elements: [
    {
      type: 'way',
      tags: { indoor: 'room', name: 'Lounge 2', level: '1' },
      geometry: [
        { lon: 4.76, lat: 52.31 },
        { lon: 4.761, lat: 52.31 },
        { lon: 4.761, lat: 52.311 },
        { lon: 4.76, lat: 52.31 },
      ],
    },
    {
      type: 'way',
      tags: { indoor: 'wall', level: '1' },
      geometry: [
        { lon: 4.76, lat: 52.31 },
        { lon: 4.762, lat: 52.312 },
      ],
    },
    {
      type: 'way',
      tags: { aeroway: 'terminal', name: 'Terminal' },
      geometry: [
        { lon: 4.75, lat: 52.3 },
        { lon: 4.77, lat: 52.3 },
        { lon: 4.77, lat: 52.32 },
        { lon: 4.75, lat: 52.3 },
      ],
    },
    { type: 'node', tags: { aeroway: 'gate', ref: 'D7', level: '1' }, lon: 4.7605, lat: 52.3106 },
    { type: 'node', tags: { amenity: 'toilets', level: '0' }, lon: 4.7601, lat: 52.3101 },
    // the walking network and its floor changes
    {
      type: 'way',
      tags: { highway: 'footway', level: '1' },
      geometry: [
        { lon: 4.758, lat: 52.3096 },
        { lon: 4.77, lat: 52.3096 },
      ],
    },
    {
      type: 'way',
      tags: { highway: 'steps', level: '0;1' },
      geometry: [
        { lon: 4.762, lat: 52.3096 },
        { lon: 4.7622, lat: 52.3097 },
      ],
    },
    { type: 'node', tags: { highway: 'elevator', level: '0;1' }, lon: 4.7625, lat: 52.3096 },
    // a landmark with a category
    {
      type: 'node',
      tags: { amenity: 'cafe', name: 'Café Rembrandt', level: '1' },
      lon: 4.7611,
      lat: 52.3118,
    },
    // tagged like a place but not an indoor thing: dropped
    { type: 'node', tags: { amenity: 'bench' }, lon: 4.76, lat: 52.31 },
  ],
}

test('Overpass elements become typed GeoJSON features', () => {
  const features = indoorFeatures(OVERPASS)
  const kinds = features.map(f => f.properties.kind)
  assert.deepEqual(kinds, [
    'room',
    'wall',
    'terminal',
    'gate',
    'poi',
    'path',
    'path',
    'lift',
    'poi',
  ])

  const [room, wall, terminal, gate, wc, walkway, stairs, lift, cafe] = features
  assert.equal(room.geometry.type, 'Polygon')
  assert.deepEqual(room.properties.levels, [1])
  assert.equal(wall.geometry.type, 'LineString')
  assert.equal(terminal.geometry.type, 'Polygon')
  assert.deepEqual(terminal.properties.levels, [])
  assert.equal(gate.geometry.type, 'Point')
  assert.equal(gate.properties.ref, 'D7')
  assert.equal(wc.properties.cat, 'wc')
  assert.equal(wc.properties.name, 'WC')
  assert.equal(walkway.geometry.type, 'LineString')
  assert.equal(stairs.properties.stair, true)
  assert.deepEqual(stairs.properties.levels, [0, 1])
  assert.equal(lift.properties.name, 'Lift')
  assert.deepEqual(lift.properties.levels, [0, 1])
  assert.equal(cafe.properties.cat, 'food')
})

test('a circular corridor stays a line for the graph, never a polygon', () => {
  const features = indoorFeatures({
    elements: [
      {
        type: 'way',
        tags: { highway: 'corridor', level: '1' },
        geometry: [
          { lon: 4, lat: 52 },
          { lon: 4.001, lat: 52 },
          { lon: 4.001, lat: 52.001 },
          { lon: 4, lat: 52 },
        ],
      },
    ],
  })
  assert.equal(features[0].geometry.type, 'LineString')
})

test('a gate mapped as an area still reads as one point', () => {
  const features = indoorFeatures({
    elements: [
      {
        type: 'way',
        tags: { aeroway: 'gate', ref: 'B2' },
        geometry: [
          { lon: 4, lat: 52 },
          { lon: 4.0002, lat: 52 },
          { lon: 4.0002, lat: 52.0002 },
          { lon: 4, lat: 52 },
        ],
      },
    ],
  })
  assert.equal(features[0].geometry.type, 'Point')
})

test('check-in desks and security filters are landmarks, however they were drawn', () => {
  const features = indoorFeatures({
    elements: [
      {
        type: 'node',
        tags: { aeroway: 'checkin', ref: '13-20', level: '0' },
        lon: 4.7628,
        lat: 52.3098,
      },
      { type: 'node', tags: { aeroway: 'security_check', level: '0' }, lon: 4.7638, lat: 52.31 },
      // named for what it is, tagged as nothing in particular
      { type: 'node', tags: { name: 'Bag drop KLM', level: '0' }, lon: 4.763, lat: 52.3099 },
      // desks drawn as a room: the room stays a room, and gains a point
      {
        type: 'way',
        tags: { indoor: 'room', name: 'Check-in 3', level: '0' },
        geometry: [
          { lon: 4.762, lat: 52.309 },
          { lon: 4.7622, lat: 52.309 },
          { lon: 4.7622, lat: 52.3092 },
          { lon: 4.762, lat: 52.3092 },
          { lon: 4.762, lat: 52.309 },
        ],
      },
      // a filter drawn as a line across the corridor
      {
        type: 'way',
        tags: { barrier: 'security_check' },
        geometry: [
          { lon: 4.764, lat: 52.3101 },
          { lon: 4.7641, lat: 52.3102 },
        ],
      },
    ],
  })
  assert.deepEqual(
    features.map(f => [f.properties.kind, f.properties.cat, f.properties.name]),
    [
      ['poi', 'checkin', 'Check-in 13-20'],
      ['poi', 'security', 'Security'],
      ['poi', 'checkin', 'Bag drop KLM'],
      ['room', 'checkin', 'Check-in 3'],
      ['poi', 'checkin', 'Check-in 3'],
      ['poi', 'security', 'Security'],
    ],
  )
  assert.equal(features[3].geometry.type, 'Polygon')
  assert.equal(features[4].geometry.type, 'Point')
  assert.equal(features[5].geometry.type, 'Point')
})

test('floors are listed once each and the map opens at ground level', () => {
  const features = indoorFeatures(OVERPASS)
  assert.deepEqual(levelsOf(features), [0, 1])
  assert.equal(defaultLevel([0, 1]), 0)
  assert.equal(defaultLevel([1, 2]), 1) // no ground floor mapped: lowest above ground
  assert.equal(defaultLevel([-2, -1]), -1) // all basement: the one nearest daylight
  assert.equal(defaultLevel([]), 0)
})

test('a floor shows its own features plus the ones on every floor', () => {
  const features = indoorFeatures(OVERPASS)
  const ground = onLevel(features, 0)
  const kinds = ground.features.map(f => f.properties.kind)
  // the unleveled terminal outline is always there, as is anything spanning
  // both floors — the stairs and the lift; level-1 rooms are not
  assert.deepEqual(kinds, ['terminal', 'poi', 'path', 'lift'])
  const first = onLevel(features, 1).features.map(f => f.properties.kind)
  assert.deepEqual(first, ['room', 'wall', 'terminal', 'gate', 'path', 'path', 'lift', 'poi'])
})

const SCHIPHOL = { id: 's1', name: 'Schiphol Airport', kw: 'airport', lng: 4.7639, lat: 52.3105 }
const HOTEL = { id: 's2', name: 'Hotel Jakarta', lng: 4.935, lat: 52.3793 }
const AT_AIRPORT = { center: [4.7639, 52.3105], zoom: 15 }
const quiet = {
  stops: [SCHIPHOL, HOTEL],
  active: null,
  routing: false,
}

test('zooming into an airport opens its inside; into a hotel opens nothing', () => {
  assert.deepEqual(autoIndoorMove({ ...quiet, view: AT_AIRPORT }), { open: SCHIPHOL })
  assert.equal(autoIndoorMove({ ...quiet, view: { center: [4.935, 52.3793], zoom: 15 } }), null)
  assert.equal(autoIndoorMove({ ...quiet, view: { center: [4.7639, 52.3105], zoom: 14 } }), null)
})

test('a terminal closes only when the camera leaves it, and never mid-route', () => {
  const zoomedOut = { center: [4.7639, 52.3105], zoom: 12 }
  assert.deepEqual(autoIndoorMove({ ...quiet, view: zoomedOut, active: SCHIPHOL }), {
    close: true,
  })
  // still looking at it: stays put, however it was opened
  assert.equal(autoIndoorMove({ ...quiet, view: AT_AIRPORT, active: SCHIPHOL }), null)
  // a line to somewhere in it is up, or the walk through it is on: stays put
  assert.equal(autoIndoorMove({ ...quiet, view: zoomedOut, active: SCHIPHOL, routing: true }), null)
  assert.equal(autoIndoorMove({ ...quiet, view: zoomedOut, active: SCHIPHOL, keep: true }), null)
  // wandered kilometres away while still zoomed in: folds up too
  assert.deepEqual(
    autoIndoorMove({ ...quiet, view: { center: [4.85, 52.31], zoom: 15 }, active: SCHIPHOL }),
    { close: true },
  )
  /* Panned a couple of kilometres at street level, with the terminal well off
     the screen: gone, the same as zooming out. Used to take four kilometres —
     screens and screens of city. A kilometre, the width of the terminal
     itself, stays. */
  const phone = { width: 390, height: 844 }
  const east = metres => [
    4.7639 + metres / (111_320 * Math.cos((52.3105 * Math.PI) / 180)),
    52.3105,
  ]
  assert.deepEqual(
    autoIndoorMove({
      ...quiet,
      view: { center: east(2500), zoom: 16 },
      active: SCHIPHOL,
      screen: phone,
    }),
    { close: true },
  )
  assert.equal(
    autoIndoorMove({
      ...quiet,
      view: { center: east(1000), zoom: 16 },
      active: SCHIPHOL,
      screen: phone,
    }),
    null,
  )
  /* A desk shows more, so it may pan further before the terminal is off it. */
  assert.equal(
    autoIndoorMove({
      ...quiet,
      view: { center: east(3000), zoom: 14 },
      active: SCHIPHOL,
      screen: { width: 1440, height: 900 },
    }),
    null,
  )
})

test('a bare-numbered gate out on the apron is a stand, kept but not a gate', () => {
  /* Pearson, as the probe read it: the terminal's gates inside its outline,
     the remote stands "541"–"547" tagged as gates nine hundred metres out,
     and Terminal 3's lettered gates far from any outline because its
     building is not a way the query brings back. */
  const ring = (lon, lat, size) => [
    { lon: lon - size, lat: lat - size },
    { lon: lon + size, lat: lat - size },
    { lon: lon + size, lat: lat + size },
    { lon: lon - size, lat: lat + size },
    { lon: lon - size, lat: lat - size },
  ]
  const terminal = {
    type: 'way',
    id: 1,
    tags: { aeroway: 'terminal', name: 'Terminal 1' },
    geometry: ring(4.7639, 52.3105, 0.004),
  }
  const gate = (id, ref, lon, lat) => ({
    type: 'node',
    id,
    tags: { aeroway: 'gate', ref },
    lon,
    lat,
  })
  const elements = [
    terminal,
    gate(2, 'D43', 4.7645, 52.3108), // inside the outline
    gate(3, '521', 4.765, 52.31), // inside, and a bare number is still a gate there
    gate(4, '541', 4.775, 52.302), // a bare number nine hundred metres out: a stand
    gate(5, 'A6', 4.775, 52.302), // lettered and far: a gate at a building the query missed
    gate(6, '101', 4.7684, 52.3105), // a bare number thirty metres outside the wall: a gate
  ]
  const kinds = Object.fromEntries(
    indoorFeatures({ elements })
      .filter(f => f.properties.kind !== 'terminal')
      .map(f => [f.properties.ref, f.properties.kind]),
  )
  assert.deepEqual(kinds, { D43: 'gate', 521: 'gate', 541: 'stand', A6: 'gate', 101: 'gate' })
  /* No outline at all, and every gate is a gate: there is nothing to be far from. */
  const bare = indoorFeatures({ elements: elements.slice(1) })
  assert.ok(bare.every(f => f.properties.kind === 'gate'))
  /* A floor outline counts as the building too. */
  const floored = indoorFeatures({
    elements: [{ ...terminal, tags: { indoor: 'level', level: '0' } }, ...elements.slice(1)],
  })
  assert.equal(floored.find(f => f.properties.ref === '541').properties.kind, 'stand')
  assert.equal(floored.find(f => f.properties.ref === '521').properties.kind, 'gate')
})

test('the floor picker follows the camera even when the walk keeps the terminal', () => {
  const schiphol = { id: 's', name: 'Schiphol', icon: 'plane', lng: 4.7639, lat: 52.3105 }
  assert.equal(cameraOverTerminal({ center: [4.7639, 52.3105], zoom: 16 }, schiphol), true)
  assert.equal(cameraOverTerminal({ center: [4.7639, 52.3105], zoom: 13.8 }, schiphol), true)
  assert.equal(
    cameraOverTerminal({ center: [4.7639, 52.3105], zoom: 9 }, schiphol),
    false,
    'zoomed away',
  )
  assert.equal(
    cameraOverTerminal({ center: [4.9, 52.37], zoom: 16 }, schiphol),
    false,
    'over the city',
  )
  assert.equal(
    cameraOverTerminal({ center: [4.8, 52.3105], zoom: 16 }, schiphol, { width: 390, height: 844 }),
    false,
    'panned off the terminal at street level',
  )
  assert.equal(cameraOverTerminal(null, schiphol), false)
  assert.equal(cameraOverTerminal({ center: [4.7639, 52.3105], zoom: 16 }, null), false)
})
