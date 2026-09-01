import test from 'node:test'
import assert from 'node:assert/strict'
import {
  facing, globeZoom, greatCircle, legFeatures,
} from '../src/features/home/model/globe-core.ts'
import {
  globeScene, isPast, pickCurrentTrip, tripPlaces, tripProgress,
} from '../src/features/home/model/trip-globe.ts'

test('a great circle between two names for the same place does not divide by zero', () => {
  const points = greatCircle([4.9, 52.4], [4.9, 52.4])
  assert.deepEqual(points, [[4.9, 52.4]])
})

test('a great circle starts and ends where it was asked to, bending in between', () => {
  const points = greatCircle([0, 0], [90, 0], 10)
  assert.equal(points.length, 11)
  assert.deepEqual(points[0].map(Math.round), [0, 0])
  assert.deepEqual(points[10].map(Math.round), [90, 0])
  assert.ok(points.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)))
})

test('a great circle arcs polewards rather than running along the parallel', () => {
  // Amsterdam to Vancouver: the short way is over Greenland, not due west.
  const points = greatCircle([4.9, 52.4], [-123.1, 49.3], 40)
  assert.ok(Math.max(...points.map(point => point[1])) > 60)
})

test('a leg over the date line keeps counting rather than racing back round', () => {
  const points = greatCircle([170, 10], [-170, 10], 20)
  const steps = points.slice(1).map((point, index) => point[0] - points[index][0])
  assert.ok(steps.every(step => Math.abs(step) < 180), 'no 360-degree jump mid-line')
  assert.ok(points[points.length - 1][0] > 180, 'the far end carries on past 180')
})

test('a place on the far side of the planet is not facing the camera', () => {
  assert.equal(facing([0, 0], [0, 0]), true)
  assert.equal(facing([0, 0], [80, 0]), true)
  assert.equal(facing([0, 0], [180, 0]), false)
  assert.equal(facing([0, 0], [95, 0]), false)
})

test('legs are split by whether both ends have been visited', () => {
  const { walked, planned } = legFeatures([
    { name: 'A', lng: 0, lat: 0, done: true },
    { name: 'B', lng: 10, lat: 10, done: true },
    { name: 'C', lng: 20, lat: 20 },
  ])
  assert.equal(walked.features.length, 1)
  assert.equal(planned.features.length, 1)
  assert.equal(walked.features[0].geometry.type, 'LineString')
  assert.ok(walked.features[0].geometry.coordinates.length > 2, 'densified for the globe')
})

test('a trip with nowhere to go draws no legs at all', () => {
  const { walked, planned } = legFeatures([{ name: 'A', lng: 0, lat: 0, done: true }])
  assert.deepEqual(walked.features, [])
  assert.deepEqual(planned.features, [])
})

test('the globe is zoomed to stand as tall as the space it is given', () => {
  // MapLibre doubles the planet every zoom step, so twice the height is one more.
  assert.ok(Math.abs(globeZoom(1600) - globeZoom(800) - 1) < 1e-9)
  assert.ok(globeZoom(900) > globeZoom(400))
  assert.ok(globeZoom(100000) <= 4.5, 'clamped rather than zoomed through the surface')
  assert.ok(globeZoom(0) >= 0.5)
})

/* ---------------------------------------------------------------- trips */

const trip = (over = {}) => ({
  id: 't', slug: 't', title: 'Trip', startsOn: '2026-09-03', endsOn: '2026-09-19',
  places: [], ...over,
})

test('a trip knows whether it is coming up, running or finished', () => {
  assert.equal(tripProgress(trip(), '2026-09-01').state, 'upcoming')
  assert.equal(tripProgress(trip(), '2026-09-06').state, 'live')
  assert.equal(tripProgress(trip(), '2026-09-30').state, 'past')
  assert.equal(isPast(trip(), '2026-09-30'), true)
})

test('the day counter is one-based and counts the last day in', () => {
  assert.deepEqual(tripProgress(trip(), '2026-09-03'), { day: 1, days: 17, state: 'live' })
  assert.deepEqual(tripProgress(trip(), '2026-09-19'), { day: 17, days: 17, state: 'live' })
})

test('a trip with no dates is not claimed to be running', () => {
  const undated = tripProgress(trip({ startsOn: null, endsOn: null, dayCount: 4 }), '2026-09-06')
  assert.deepEqual(undated, { day: 0, days: 4, state: 'upcoming' })
})

test('the trip to lead with is the live one, then the next, then the last', () => {
  const past = trip({ id: 'past', startsOn: '2025-01-01', endsOn: '2025-01-05' })
  const live = trip({ id: 'live' })
  const soon = trip({ id: 'soon', startsOn: '2027-01-01', endsOn: '2027-01-05' })
  assert.equal(pickCurrentTrip([past, live, soon], '2026-09-06').id, 'live')
  assert.equal(pickCurrentTrip([past, soon], '2026-09-06').id, 'soon')
  assert.equal(pickCurrentTrip([past], '2026-09-06').id, 'past')
  assert.equal(pickCurrentTrip([], '2026-09-06'), null)
})

test('stops in the same place become one dot, keeping the fact it was visited', () => {
  const places = tripPlaces(trip({
    places: [
      { name: 'Hotel', lng: 4.9, lat: 52.37, status: 'done' },
      { name: 'Cafe across the street', lng: 4.9001, lat: 52.3701, status: 'planned' },
      { name: 'Edinburgh', lng: -3.19, lat: 55.95, status: 'planned' },
    ],
  }))
  assert.equal(places.length, 2)
  assert.equal(places[0].done, true)
  assert.equal(places[1].name, 'Edinburgh')
})

test('a stop with no usable coordinate is left off the globe', () => {
  const places = tripPlaces(trip({
    places: [{ name: 'Nowhere', lng: NaN, lat: 52 }, { name: 'Utrecht', lng: 5.11, lat: 52.09 }],
  }))
  assert.deepEqual(places.map(place => place.name), ['Utrecht'])
})

test('only the ends of the arc are labelled, and a there-and-back trip gets one label', () => {
  const across = tripPlaces(trip({
    places: [
      { name: 'A', lng: 0, lat: 0 }, { name: 'B', lng: 10, lat: 10 }, { name: 'C', lng: 20, lat: 20 },
    ],
  }))
  assert.deepEqual(across.map(place => !!place.label), [true, false, true])

  const roundTrip = tripPlaces(trip({
    places: [
      { name: 'Home', lng: 0, lat: 0 }, { name: 'Away', lng: 10, lat: 10 },
      { name: 'Home again', lng: 0, lat: 0 },
    ],
  }))
  assert.deepEqual(roundTrip.map(place => !!place.label), [false, false, true])
})

test('the scene joins home to the trip and only claims a live position while it runs', () => {
  const profile = { homePlace: 'Regina, Saskatchewan', homeLat: 50.45, homeLng: -104.6 }
  const live = globeScene(trip({
    places: [
      { name: 'Amsterdam', lng: 4.9, lat: 52.37, status: 'done' },
      { name: 'Edinburgh', lng: -3.19, lat: 55.95, status: 'planned' },
    ],
  }), profile)
  assert.equal(live.home.name, 'Regina')
  assert.equal(live.places.length, 3, 'home, then both stops')
  assert.equal(live.places[0].label, false, 'home is labelled once, by its own marker')

  const finished = globeScene(trip({
    endsOn: '2020-01-01', startsOn: '2019-12-01',
    places: [{ name: 'Amsterdam', lng: 4.9, lat: 52.37, status: 'done' }],
  }), profile)
  assert.equal(finished.live, null)
  assert.equal(finished.places.length, 3, 'home, the stop, and home again')
})

test('with no trip the globe still knows where home is', () => {
  const scene = globeScene(null, { homePlace: 'Regina', homeLat: 50.45, homeLng: -104.6 })
  assert.equal(scene.places.length, 1)
  assert.equal(scene.live, null)
})

test('a profile with no home base draws no home marker', () => {
  // A name on its own is not a position: half a coordinate cannot be plotted.
  assert.equal(globeScene(null, { homePlace: 'Regina' }).home, null)
  assert.equal(globeScene(null, {}).home, null)
  assert.deepEqual(globeScene(null, {}).places, [])
})
