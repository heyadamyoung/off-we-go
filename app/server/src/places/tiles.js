/* The slippy-map grid, as arithmetic.
 *
 * Which squares cover a piece of ground at a zoom. Pure, so the ranges can be
 * asserted exactly rather than eyeballed against a map, and separate from the
 * store because it is the one part of tiling that is neither SQL nor HTTP —
 * it is the same twenty lines every map has had since 2005.
 */

/** The deepest zoom worth pre-building.
 *
 * Panning is what was reported as slow, and panning happens at the zooms
 * where a screen is many squares: a city at 12 is a dozen tiles, a country at
 * 11 is dozens. Deeper than 14 a screen is four to six squares of a few
 * streets each, which is a handful of lookups nobody notices — and there are
 * sixteen times as many of them per level, so building a cell's worth eagerly
 * would be hundreds of thousands of tiles to save a few hundred lookups. */
export const EAGER_ZOOMS = Object.freeze([11, 12, 13, 14])

/** Longitude to tile column. */
export const tileX = (lng, z) => Math.floor(((Number(lng) + 180) / 360) * 2 ** z)

/** Latitude to tile row, in the Mercator the whole world agrees on. Clamped
    to the poles Mercator can express, because tan(90°) is not a number and a
    bounding box that reaches the pole is a legitimate thing to ask about. */
export const tileY = (lat, z) => {
  const clamped = Math.min(85.0511, Math.max(-85.0511, Number(lat)))
  const radians = (clamped * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** z,
  )
}

/**
 * Every tile covering a box at one zoom.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @param {number} z
 * @returns {Array<{z: number, x: number, y: number}>}
 */
export function tilesForBounds(bounds, z) {
  const side = 2 ** z
  const clamp = value => Math.min(side - 1, Math.max(0, value))
  const left = clamp(tileX(bounds.west, z))
  const right = clamp(tileX(bounds.east, z))
  /* North is a smaller row number than south: the grid counts down the map
     while latitude counts up it, and getting this the wrong way round is the
     classic way to build every tile except the ones somebody is looking at. */
  const top = clamp(tileY(bounds.north, z))
  const bottom = clamp(tileY(bounds.south, z))
  const tiles = []
  for (let x = Math.min(left, right); x <= Math.max(left, right); x += 1) {
    for (let y = Math.min(top, bottom); y <= Math.max(top, bottom); y += 1) {
      tiles.push({ z, x, y })
    }
  }
  return tiles
}

/**
 * Every tile covering a box across several zooms, shallowest first — so a
 * build that is interrupted has finished the zooms a pan uses most.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @param {number[]} [zooms]
 */
export function tilesToBuild(bounds, zooms = EAGER_ZOOMS) {
  return [...zooms].sort((a, b) => a - b).flatMap(z => tilesForBounds(bounds, z))
}
