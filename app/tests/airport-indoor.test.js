import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoIndoorMove,
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
  auto: null,
  dismissed: null,
  routing: false,
}

test('zooming into an airport opens its inside; into a hotel opens nothing', () => {
  assert.deepEqual(autoIndoorMove({ ...quiet, view: AT_AIRPORT }), { open: SCHIPHOL })
  assert.equal(autoIndoorMove({ ...quiet, view: { center: [4.935, 52.3793], zoom: 15 } }), null)
  assert.equal(autoIndoorMove({ ...quiet, view: { center: [4.7639, 52.3105], zoom: 14 } }), null)
})

test('a terminal dismissed by hand stays closed until the camera has left', () => {
  assert.equal(autoIndoorMove({ ...quiet, view: AT_AIRPORT, dismissed: 's1' }), null)
  // zooming right out lifts the dismissal…
  assert.deepEqual(
    autoIndoorMove({ ...quiet, view: { center: [4.7639, 52.3105], zoom: 12 }, dismissed: 's1' }),
    { reset: true },
  )
})

test('only what opened by itself closes by itself, and never mid-route', () => {
  const zoomedOut = { center: [4.7639, 52.3105], zoom: 12 }
  assert.deepEqual(autoIndoorMove({ ...quiet, view: zoomedOut, active: SCHIPHOL, auto: 's1' }), {
    close: true,
  })
  // opened from the card's button: stays put
  assert.equal(autoIndoorMove({ ...quiet, view: zoomedOut, active: SCHIPHOL, auto: null }), null)
  // a gate route is up: stays put
  assert.equal(
    autoIndoorMove({ ...quiet, view: zoomedOut, active: SCHIPHOL, auto: 's1', routing: true }),
    null,
  )
  // wandered kilometres away while still zoomed in: folds up too
  assert.deepEqual(
    autoIndoorMove({
      ...quiet,
      view: { center: [4.85, 52.31], zoom: 15 },
      active: SCHIPHOL,
      auto: 's1',
    }),
    { close: true },
  )
})
