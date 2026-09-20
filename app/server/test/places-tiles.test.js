import assert from 'node:assert/strict'
import test from 'node:test'
import { cellsForBounds } from '../src/places/cells.js'
import {
  EAGER_ZOOMS,
  tileBounds,
  tileX,
  tileY,
  tilesForBounds,
  tilesToBuild,
} from '../src/places/tiles.js'

/* The slippy grid, asserted rather than eyeballed.
 *
 * Reported from the road: panning across a lot of the map is slow. The fix is
 * to build the squares before anybody asks for them, and the whole of "which
 * squares" is this arithmetic — so a sign error here is a minute per cell
 * spent building tiles of the wrong piece of the planet while the ones on
 * screen stay cold.
 */

test('the grid puts the known corners where everyone agrees they are', () => {
  // Null Island is the corner of the four middle tiles at any zoom.
  assert.equal(tileX(0, 1), 1)
  assert.equal(tileY(0, 1), 1)
  // The far west and the far north are the origin.
  assert.equal(tileX(-180, 5), 0)
  assert.equal(tileY(85, 5), 0)
  // And the far east is the last column, never one past it.
  assert.equal(tileX(179.999, 5), 2 ** 5 - 1)
})

test('north is a smaller row than south, which is the sign error to make', () => {
  /* Latitude counts up the map and the tile grid counts down it. Getting this
     backwards builds every tile except the ones on screen. */
  assert.ok(tileY(52.4, 14) < tileY(52.3, 14), 'further north is a lower row')
  assert.ok(tileX(4.9, 14) > tileX(4.8, 14), 'further east is a higher column')
})

test('a box is covered completely, and by nothing outside it', () => {
  const box = { west: 4.85, south: 52.35, east: 4.95, north: 52.4 }
  const tiles = tilesForBounds(box, 14)
  assert.ok(tiles.length > 0)
  /* Every corner of the box is in a tile of the answer, which is the only
     property that matters: a covering with a hole is a blank patch of map. */
  for (const [lng, lat] of [
    [box.west, box.south],
    [box.west, box.north],
    [box.east, box.south],
    [box.east, box.north],
  ]) {
    const want = { z: 14, x: tileX(lng, 14), y: tileY(lat, 14) }
    assert.ok(
      tiles.some(tile => tile.x === want.x && tile.y === want.y),
      `${lng},${lat} falls outside the covering`,
    )
  }
  // And no duplicates, or a warm pass builds the same square twice.
  const keys = new Set(tiles.map(tile => `${tile.z}/${tile.x}/${tile.y}`))
  assert.equal(keys.size, tiles.length)
})

test('a degree of the world is a minute of building, not a week', () => {
  /* The number that decides whether warming ahead of demand is a good idea at
     all. Four and a half thousand for a whole cell across the panning zooms
     is about a minute; the same over zooms 15 to 17 would be a quarter of a
     million, which is why EAGER_ZOOMS stops at 14. */
  const cell = { west: 4, south: 52, east: 5, north: 53 }
  const tiles = tilesToBuild(cell)
  assert.ok(tiles.length > 1000, `${tiles.length} is too few to be a whole cell`)
  assert.ok(tiles.length < 8000, `${tiles.length} would be minutes per cell, not one`)
  assert.deepEqual([...EAGER_ZOOMS].sort(), [11, 12, 13, 14])
  // Shallowest first, so an interrupted build has done the zooms a pan uses.
  assert.equal(tiles[0].z, 11)
  assert.equal(tiles.at(-1).z, 14)
})

test('a box at the edge of the world stays on the board', () => {
  const pole = { west: -180, south: 84, east: 180, north: 90 }
  for (const tile of tilesForBounds(pole, 3)) {
    assert.ok(tile.x >= 0 && tile.x < 2 ** 3, `x ${tile.x}`)
    assert.ok(tile.y >= 0 && tile.y < 2 ** 3, `y ${tile.y}`)
  }
  assert.ok(Number.isFinite(tileY(90, 10)), 'the pole is a number, not a NaN')
  assert.ok(Number.isFinite(tileY(-90, 10)))
})

/* ---- a tile is only as true as its ground ------------------------------ */

test('a tile knows which cells it sits on', () => {
  /* The inverse of tileX and tileY, and the thing that lets a square ask
     whether its ground has been ingested. North is the smaller row. */
  const amsterdam = tileBounds(14, tileX(4.89, 14), tileY(52.37, 14))
  assert.ok(amsterdam.west <= 4.89 && 4.89 < amsterdam.east)
  assert.ok(amsterdam.south < 52.37 && 52.37 <= amsterdam.north)
  assert.ok(amsterdam.north > amsterdam.south, 'north is north of south')
  /* A z11 square is about twenty kilometres, so it sits on one cell unless it
     straddles a degree — which is the case the cache check exists for. */
  assert.deepEqual(cellsForBounds(tileBounds(11, tileX(4.89, 11), tileY(52.37, 11))), ['N52E004'])
  assert.ok(cellsForBounds(tileBounds(2, 1, 1)).length > 1)
})

test('the whole world is one tile at zoom zero', () => {
  const world = tileBounds(0, 0, 0)
  assert.equal(Math.round(world.west), -180)
  assert.equal(Math.round(world.east), 180)
  assert.ok(world.north > 85 && world.north < 85.1)
  assert.ok(world.south < -85 && world.south > -85.1)
})
