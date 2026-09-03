import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boundsOfPoints,
  latToY,
  lngToX,
  MAX_TILES,
  saveRegion,
  tileUrl,
  tilesForBounds,
  tooWideToSave,
} from '../src/offline-region-core.ts'

// Amsterdam, roughly the sample trip's spread.
const AMS = [
  [4.8852, 52.36],
  [4.9, 52.372],
  [4.8712, 52.3584],
]

/* Addresses checked against an independent implementation of the standard Web
   Mercator tile formula, not against this one. */
test('a tile is named the way every slippy map names it', () => {
  assert.deepEqual([lngToX(-180, 0), latToY(85.0511, 0)], [0, 0])
  assert.deepEqual([lngToX(0, 1), latToY(0, 1)], [1, 1])
  assert.deepEqual([lngToX(4.8852, 14), latToY(52.36, 14)], [8414, 5385], 'Amsterdam')
  assert.deepEqual([lngToX(-0.1276, 12), latToY(51.5072, 12)], [2046, 1362], 'London')
})

test('a latitude past the projection is pulled back rather than sent off the map', () => {
  assert.equal(latToY(89.9, 3), latToY(85.0511, 3))
  assert.ok(latToY(-89.9, 3) < 2 ** 3)
})

test('the bounds sit around the stops with a little air', () => {
  const bounds = boundsOfPoints(AMS, 0.02)

  assert.ok(bounds.west < 4.8712 && bounds.east > 4.9)
  assert.ok(bounds.south < 52.3584 && bounds.north > 52.372)
})

test('a trip with nothing placed yet has no region to save', () => {
  assert.equal(boundsOfPoints([]), null)
  assert.equal(boundsOfPoints([[Number.NaN, 5]]), null)
})

test('a city trip comes to a sensible number of tiles', () => {
  const tiles = tilesForBounds(boundsOfPoints(AMS))

  assert.ok(tiles.length > 20, `expected a real region, got ${tiles.length}`)
  assert.ok(tiles.length < MAX_TILES, `expected a city to fit, got ${tiles.length}`)
  // Coarse zooms first, so the map fills in from the whole country downwards.
  assert.equal(tiles[0].z, 8)
  assert.equal(tiles.at(-1).z, 14)
})

test('every tile named is a tile that exists at its zoom', () => {
  for (const { z, x, y } of tilesForBounds(boundsOfPoints(AMS))) {
    assert.ok(x >= 0 && x < 2 ** z, `x out of range at z${z}`)
    assert.ok(y >= 0 && y < 2 ** z, `y out of range at z${z}`)
  }
})

test('a trip drawn across a continent is refused rather than half-saved', () => {
  const europe = { west: -10, south: 36, east: 30, north: 60 }

  assert.equal(tooWideToSave(europe), true)
  assert.equal(tooWideToSave(boundsOfPoints(AMS)), false)
})

test('the cap is a hard stop, not a target', () => {
  assert.equal(tilesForBounds({ west: -180, south: -85, east: 180, north: 85 }).length, MAX_TILES)
})

test('a tile address becomes a URL the way the tile index says', () => {
  assert.equal(
    tileUrl('https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf', { z: 14, x: 8425, y: 5405 }),
    'https://tiles.openfreemap.org/planet/14/8425/5405.pbf',
  )
})

test('saving fetches every tile once and counts them off as it goes', async () => {
  const asked = []
  const seen = []

  const result = await saveRegion({
    tiles: [
      { z: 8, x: 1, y: 2 },
      { z: 9, x: 3, y: 4 },
      { z: 10, x: 5, y: 6 },
    ],
    template: '{z}/{x}/{y}',
    fetchTile: async url => {
      asked.push(url)
    },
    onProgress: p => seen.push(p.done),
    concurrency: 2,
  })

  assert.deepEqual(asked.sort(), ['10/5/6', '8/1/2', '9/3/4'])
  assert.deepEqual(result, { done: 3, total: 3 })
  assert.deepEqual(seen, [1, 2, 3], 'progress is reported as each one lands')
})

test('a tile the server will not give is a gap in the map, not a failed save', async () => {
  const result = await saveRegion({
    tiles: [
      { z: 8, x: 1, y: 2 },
      { z: 8, x: 1, y: 3 },
    ],
    template: '{z}/{x}/{y}',
    fetchTile: async url => {
      if (url.endsWith('3')) throw new Error('502')
    },
  })

  assert.deepEqual(result, { done: 2, total: 2 })
})

test('cancelling stops it where it stands rather than running to the end', async () => {
  const controller = new AbortController()
  let asked = 0

  const result = await saveRegion({
    tiles: Array.from({ length: 50 }, (_, index) => ({ z: 10, x: index, y: 1 })),
    template: '{z}/{x}/{y}',
    fetchTile: async () => {
      asked++
      if (asked === 3) controller.abort()
    },
    signal: controller.signal,
    concurrency: 1,
  })

  assert.ok(result.done < 50, `stopped early, got ${result.done}`)
  assert.equal(result.total, 50)
})

test('saving nothing is not an error', async () => {
  const result = await saveRegion({ tiles: [], template: '{z}', fetchTile: async () => {} })

  assert.deepEqual(result, { done: 0, total: 0 })
})
