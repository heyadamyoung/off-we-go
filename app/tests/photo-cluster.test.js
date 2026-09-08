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
