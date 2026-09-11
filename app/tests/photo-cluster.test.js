import assert from 'node:assert/strict'
import test from 'node:test'
import { clusterPhotos, degreesPerPixel, within } from '../src/photo-cluster-core.ts'

const photo = (id, lng, lat, extra = {}) => ({ id, lng, lat, by: '', seq: id, ...extra })

/* A day walking a city with the camera out: a thousand photographs within a
   few hundred metres of each other, every one of which used to become its own
   absolutely positioned element, re-projected on every frame. */
const cityWalk = (count, { lng = -0.1276, lat = 51.5074, spread = 0.01 } = {}) =>
  Array.from({ length: count }, (_, i) =>
    photo(i + 1, lng + ((i * 37) % 100) * (spread / 100), lat + ((i * 61) % 100) * (spread / 100)),
  )

test('a thousand loose photographs become a number of markers the screen sets', () => {
  const walk = cityWalk(1000)

  const wide = clusterPhotos(walk, [], { zoom: 11 })
  const close = clusterPhotos(walk, [], { zoom: 17 })

  assert.ok(wide.length < 30, `zoomed out should be a handful of stacks, got ${wide.length}`)
  assert.ok(
    close.length > wide.length,
    'and zooming in has to separate them, or the map is a lie about where things are',
  )
  assert.ok(close.length <= walk.length)

  // Nothing is lost, whatever the zoom: every photograph is in exactly one stack.
  for (const groups of [wide, close]) {
    const seen = groups.flatMap(group => group.items.map(item => item.id))
    assert.equal(new Set(seen).size, seen.length, 'no photograph is in two stacks')
    assert.equal(seen.length, walk.length, 'and none has been dropped')
  }
})

test('a stack sits where somebody stood, not on a grid intersection', () => {
  const pair = [photo(1, -0.1276, 51.5074), photo(2, -0.12761, 51.50741)]
  const [group] = clusterPhotos(pair, [], { zoom: 12 })
  assert.equal(group.items.length, 2, 'close enough to be one stack at this zoom')
  /* Anchored on the newest photograph in it. Snapping to the cell's centre
     would put the stack somewhere nobody actually was. */
  assert.equal(group.lng, pair[1].lng)
  assert.equal(group.lat, pair[1].lat)
  assert.equal(group.items[0].id, 2, 'newest first, which is what the stack shows')
})

test('what is off the screen is not drawn at all', () => {
  const here = cityWalk(200)
  const elsewhere = cityWalk(200, { lng: 139.69, lat: 35.68 })
  const bounds = { west: -0.2, south: 51.4, east: -0.05, north: 51.6 }

  const drawn = clusterPhotos([...here, ...elsewhere], [], { zoom: 13, bounds })
  const shown = drawn.flatMap(group => group.items.map(item => item.id))
  assert.ok(shown.length > 0)
  /* A marker outside the window costs exactly what one inside it costs and
     shows nobody anything. Tokyo is not on this screen. */
  assert.ok(
    drawn.every(group => group.lng > -1 && group.lng < 1),
    'nothing from the other side of the world was given a marker',
  )
})

test('photographs at a stop stay one tidy stack on the stop, at every zoom', () => {
  const stops = [{ id: 's1', name: 'Museum', lng: -0.1276, lat: 51.5194, day: '', seq: 0 }]
  const atStop = Array.from({ length: 300 }, (_, i) =>
    photo(i + 1, -0.1276 + i * 0.00001, 51.5194, { stopId: 's1' }),
  )

  for (const zoom of [10, 14, 18]) {
    const groups = clusterPhotos(atStop, stops, { zoom })
    assert.equal(groups.length, 1, `a stop is one stack, not ${groups.length}, at zoom ${zoom}`)
    assert.equal(groups[0].items.length, 300)
    // On the stop itself, so the stack points at the place rather than drifting.
    assert.equal(groups[0].lng, stops[0].lng)
    assert.equal(groups[0].lat, stops[0].lat)
  }
})

test('a photograph with no usable position is not put anywhere', () => {
  const mixed = [
    photo(1, -0.1276, 51.5074),
    photo(2, null, null),
    photo(3, undefined, undefined),
    photo(4, 999, 999),
    photo(5, Number.NaN, 51),
  ]
  const groups = clusterPhotos(mixed, [], { zoom: 12 })
  const shown = groups.flatMap(group => group.items.map(item => item.id))
  assert.deepEqual(shown, [1], 'inventing a location is worse than showing none')
})

test('the cell is a fixed size on screen, so it halves with every zoom level', () => {
  assert.ok(degreesPerPixel(0) > degreesPerPixel(10))
  // One zoom level is exactly half the ground per pixel.
  assert.ok(Math.abs(degreesPerPixel(12) / degreesPerPixel(13) - 2) < 1e-9)
})

test('a window straddling the date line still contains what is inside it', () => {
  // West greater than east is how a viewport across the antimeridian reads.
  const wrapped = { west: 170, south: -10, east: -170, north: 10 }
  assert.equal(within(wrapped, 175, 0), true)
  assert.equal(within(wrapped, -175, 0), true)
  assert.equal(within(wrapped, 0, 0), false, 'the other side of the world is not in view')
  assert.equal(within(null, 0, 0), true, 'no window means no culling')
})

/* ---- photographs with nothing to place them by ---------------------------

   The case that made "photos on the map" look like a feature that does not
   exist. A picture sent over WhatsApp, scanned, or taken with location off
   has no coordinates; unless somebody has filed it at a stop it has no place
   either, and the clusterer used to drop it — silently, for ever, however
   many of them there were. On a trip where most pictures arrive that way the
   map shows stops and nothing else. */

const TRIP = { startsOn: '2026-09-04', endsOn: '2026-09-06' }
const stopAt = (id, name, lng, lat, day) => ({ id, name, lng, lat, day })
const ITINERARY = [
  stopAt('rijks', 'Rijksmuseum', 4.8852, 52.36, '2026-09-05'),
  stopAt('vangogh', 'Van Gogh Museum', 4.8811, 52.3584, '2026-09-05'),
  stopAt('centraal', 'Centraal', 4.9003, 52.379, '2026-09-06'),
]
const unplaced = (id, when) => ({ id, by: '', seq: id, when, lng: null, lat: null })

test('a photograph with no location is placed at where the trip was that day', () => {
  const groups = clusterPhotos(
    [unplaced(1, '2026-09-05T11:00:00.000Z'), unplaced(2, '2026-09-05T15:00:00.000Z')],
    ITINERARY,
    { zoom: 13, range: TRIP },
  )
  assert.equal(groups.length, 1, 'one stack for the day, not one per picture')
  assert.deepEqual(groups[0].items.map(item => item.id).sort(), [1, 2])
  /* Between that day's two stops, not at one of them: the trip was at both,
     and picking either would put the pictures at a place it can name. */
  assert.ok(Math.abs(groups[0].lng - (4.8852 + 4.8811) / 2) < 1e-9)
  assert.ok(Math.abs(groups[0].lat - (52.36 + 52.3584) / 2) < 1e-9)
})

test('a stack placed by inference says that it was', () => {
  /* It must not look like a picture that knows where it was taken. */
  const [group] = clusterPhotos([unplaced(1, '2026-09-06T09:00:00.000Z')], ITINERARY, {
    zoom: 13,
    range: TRIP,
  })
  assert.equal(group.approximate, true)
  assert.equal(group.day, '2026-09-06')

  // Whereas one that does know says nothing of the kind.
  const [known] = clusterPhotos([photo(9, 4.8852, 52.36)], [], { zoom: 13, range: TRIP })
  assert.equal(known.approximate, undefined)
})

test('one stack per day, not one for the lot', () => {
  const groups = clusterPhotos(
    [
      unplaced(1, '2026-09-05T11:00:00.000Z'),
      unplaced(2, '2026-09-06T11:00:00.000Z'),
      unplaced(3, '2026-09-06T12:00:00.000Z'),
    ],
    ITINERARY,
    { zoom: 13, range: TRIP },
  )
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map(group => group.day).sort(), ['2026-09-05', '2026-09-06'])
})

test('a photograph already filed at a stop is placed there, not by its day', () => {
  /* Filing one is the exact answer, and it has to beat the guess — which is
     also what makes the guess worth drawing: it is the thing you tap to fix. */
  const groups = clusterPhotos(
    [{ id: 1, by: '', seq: 1, stopId: 'centraal', when: '2026-09-05T11:00:00.000Z' }],
    ITINERARY,
    { zoom: 13, range: TRIP },
  )
  assert.equal(groups.length, 1)
  assert.equal(groups[0].approximate, undefined)
  assert.equal(groups[0].lng, 4.9003)
})

test('a day the trip never went anywhere places nothing', () => {
  /* Better off the map than at the middle of a trip it was not on. */
  assert.deepEqual(
    clusterPhotos([unplaced(1, '2026-10-30T11:00:00.000Z')], ITINERARY, {
      zoom: 13,
      range: TRIP,
    }),
    [],
  )
  // And a photograph that does not even know when it was taken.
  assert.deepEqual(clusterPhotos([unplaced(2, null)], ITINERARY, { zoom: 13, range: TRIP }), [])
})

test('an inferred stack is windowed like any other', () => {
  /* A marker outside the viewport costs the same as one inside it and shows
     nobody anything. */
  const elsewhere = { west: -1, south: 50, east: 0, north: 51 }
  assert.deepEqual(
    clusterPhotos([unplaced(1, '2026-09-05T11:00:00.000Z')], ITINERARY, {
      zoom: 13,
      range: TRIP,
      bounds: elsewhere,
    }),
    [],
  )
})
