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
/**
 * The corners of one tile, in degrees — the inverse of tileX and tileY.
 *
 * Needed because a tile has to be able to say which one-degree cells it sits
 * on: a tile whose ground has not been ingested yet must not be cached, and
 * "has this ground been ingested" is a question about cells. Kept beside its
 * inverse so a sign error in one is visible against the other.
 *
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {{west: number, south: number, east: number, north: number}}
 */
export function tileBounds(z, x, y) {
  const side = 2 ** z
  const lng = at => (at / side) * 360 - 180
  const lat = at => {
    const turn = Math.PI - (2 * Math.PI * at) / side
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(turn) - Math.exp(-turn)))
  }
  /* North is the smaller row, which is the thing to get wrong. */
  return { west: lng(x), east: lng(x + 1), south: lat(y + 1), north: lat(y) }
}

/**
 * The zoom a viewport is looking at, from its own width.
 *
 * A slippy tile at zoom z spans 360/2^z degrees of longitude, so a viewport
 * spanning `span` degrees is about `log2(360/span)` — the zoom at which it is
 * one tile wide. A phone shows one or two tiles across, which is close
 * enough: this decides which tier of marks belongs on screen, and being a
 * level out shows the next tier rather than the wrong thing.
 *
 * Clamped at the top and nowhere else. Above the floor there is nothing left
 * to thin, so 17 and 20 are the same question.
 *
 * It used to clamp at the bottom too — up to LABEL_ZOOMS.from — on the
 * argument that a continent view would otherwise filter to nothing and the
 * map would be empty where somebody wants the shape of a country. That is
 * true and it is not what the clamp did. A world-sized box came back as zoom
 * 11, which is one city's worth of thinning applied to the whole planet:
 * 3,962,880 tile squares in view at twenty-four marks each, ninety-five
 * million marks asked for. Nothing can draw that, so a limit was bolted on
 * top to cut it to three hundred — and a limit is a second answer to the
 * question `label_zoom` already answers, arbitrary where that one is ordered,
 * which is why panning changed what was on screen.
 *
 * Unclamped, the count is bounded by construction and the limit is not
 * needed. The zoom comes from the span, so a box can never be large and
 * zoomed-in at once: a city is 4 squares and about 96 marks, a district the
 * same, a street is the floor and draws everything in three hundred metres.
 * A continent is zoom 3, no place has earned 3, and the map draws no pins —
 * which is the honest answer. Country outlines are the basemap's job, and
 * `headline` is the thing that exists for "worth a dot from further out".
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @param {{floor: number}} zooms
 */
export function zoomForBounds(bounds, { floor }) {
  const span = Math.abs(Number(bounds?.east) - Number(bounds?.west))
  if (!Number.isFinite(span) || span <= 0) return floor
  const at = Math.round(Math.log2(360 / span))
  return Math.min(floor, at)
}

/**
 * The block of the zoom-z grid a box covers, as two inclusive ranges.
 *
 * The corners rather than the tiles, because at zoom 20 a one-degree cell is
 * about three thousand squares across and nine million of them altogether —
 * a number worth expressing and never worth listing. `tilesForBounds` walks
 * it when a caller really does want each one; a delete wants the range.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @param {number} z
 * @returns {{z: number, x0: number, x1: number, y0: number, y1: number}}
 */
export function tileRange(bounds, z) {
  const side = 2 ** z
  const clamp = value => Math.min(side - 1, Math.max(0, value))
  const left = clamp(tileX(bounds.west, z))
  const right = clamp(tileX(bounds.east, z))
  /* North is a smaller row number than south: the grid counts down the map
     while latitude counts up it, and getting this the wrong way round is the
     classic way to build every tile except the ones somebody is looking at. */
  const top = clamp(tileY(bounds.north, z))
  const bottom = clamp(tileY(bounds.south, z))
  return {
    z,
    x0: Math.min(left, right),
    x1: Math.max(left, right),
    y0: Math.min(top, bottom),
    y1: Math.max(top, bottom),
  }
}

export function tilesForBounds(bounds, z) {
  const { x0, x1, y0, y1 } = tileRange(bounds, z)
  const tiles = []
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
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
