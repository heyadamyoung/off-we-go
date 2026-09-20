/* The world, cut into one-degree cells.
 *
 * Everything about coverage pivots on a region key, and the key has to answer
 * three questions cheaply: which cell is this point in, which cells does this
 * trip touch, and what are this cell's bounds. A named-region scheme (the
 * Geofabrik extracts the routing engine uses, see ../coverage.js) answers the
 * first two only by point-in-polygon against a downloaded index, and its
 * regions differ in size by four orders of magnitude — Vatican City and
 * Russia are both "a region", which makes "ingest the region this stop is in"
 * mean anything from a second to a day.
 *
 * A fixed grid answers all three with arithmetic, is the same everywhere, and
 * makes a planet run a queue of equal-ish units of work that can be retried
 * one at a time. One degree is the size that matters: about 111 km tall, and
 * 111 km wide at the equator narrowing to nothing at the poles, so a cell is
 * a comfortable "around here" for a traveller and small enough that ingesting
 * one on demand is seconds, not minutes. The whole planet is 64,800 cells, of
 * which the ~25,000 with any land are the only ones that will ever hold rows.
 *
 * Keys read as a position, not a number: N52E004, S34W059. Floor semantics
 * throughout, so cells tile the plane without gap or overlap and a point on a
 * boundary belongs to exactly one.
 */

/** Latitudes beyond this have no places and break the grid's arithmetic. */
const MAX_LATITUDE = 90
const MIN_LATITUDE = -90
/** Columns in the grid: one per degree of longitude. */
const COLUMNS = 360

const pad = (value, width) => String(Math.abs(value)).padStart(width, '0')

/** Longitude wrapped into [-180, 180), so 181 and -179 are the same meridian. */
export function wrapLongitude(lng) {
  const wrapped = ((((Number(lng) + 180) % 360) + 360) % 360) - 180
  /* -180 and 180 are the same line; name it once, at the west end. */
  return Object.is(wrapped, -0) ? 0 : wrapped
}

/** Latitude clamped to the poles rather than wrapped: there is no 91st degree. */
export const clampLatitude = lat => Math.min(MAX_LATITUDE, Math.max(MIN_LATITUDE, Number(lat)))

/**
 * The cell a point falls in.
 * @param {number} lng
 * @param {number} lat
 * @returns {string} e.g. "N52E004"
 */
export function cellKey(lng, lat) {
  const x = wrapLongitude(lng)
  const y = clampLatitude(lat)
  /* The north pole itself would floor to a 91st row of cells; it belongs to
     the last real one. */
  const row = Math.min(Math.floor(y), MAX_LATITUDE - 1)
  const column = Math.floor(x)
  return `${row < 0 ? 'S' : 'N'}${pad(row, 2)}${column < 0 ? 'W' : 'E'}${pad(column, 3)}`
}

const KEY = /^([NS])(\d{2})([EW])(\d{3})$/

/** Whether a string is a cell key this module could have produced. */
export const isCellKey = value => KEY.test(String(value ?? ''))

/**
 * A cell's south-west corner and its bounds.
 * @param {string} key
 * @returns {{west: number, south: number, east: number, north: number}}
 */
export function cellBounds(key) {
  const found = KEY.exec(String(key ?? ''))
  if (!found) throw new Error(`not a cell key: ${key}`)
  const [, ns, latitude, ew, longitude] = found
  const south = (ns === 'S' ? -1 : 1) * Number(latitude)
  const west = (ew === 'W' ? -1 : 1) * Number(longitude)
  return { west, south, east: west + 1, north: south + 1 }
}

/**
 * Every cell a bounding box touches, in a stable order (south to north, west
 * to east) so two callers asking the same question queue the same work.
 *
 * A box that crosses the antimeridian is given as west > east, which is how
 * every map library states it; the walk then runs off the end of the world
 * and comes back at the other side rather than sweeping the long way round
 * and returning three hundred and sixty degrees of ocean.
 *
 * How wide the box is comes from the edges as given, before either is
 * wrapped. Wrapping first throws that away: -180 and 180 are the same
 * meridian, so a box spanning the whole planet and a box of zero width
 * arrive as the same pair of numbers, and a walk that stops when it meets
 * the east edge stops immediately. That returned one column for the world,
 * which is what a zoomed-out map asks for.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @returns {string[]}
 */
export function cellsForBounds(bounds) {
  const south = Math.floor(clampLatitude(bounds.south))
  const north = Math.min(Math.floor(clampLatitude(bounds.north)), MAX_LATITUDE - 1)
  const west = Math.floor(wrapLongitude(bounds.west))
  const columns = columnCount(bounds)
  const keys = []
  for (let y = south; y <= north; y += 1) {
    for (let step = 0; step < columns; step += 1) keys.push(cellKey(west + step, y))
  }
  return [...new Set(keys)]
}

/** How many one-degree columns a box covers: 1 for a point, 360 for the
    planet, and the short way round for a box that crosses the antimeridian. */
function columnCount(bounds) {
  const rawWest = Number(bounds.west)
  const rawEast = Number(bounds.east)
  if (!Number.isFinite(rawWest) || !Number.isFinite(rawEast)) return 1
  /* Given as a span of a full turn or more — a whole-world viewport, or a
     radius so large the caller widened it to everything — the answer is every
     column, whatever the two edges wrap to. */
  if (Math.abs(rawEast - rawWest) >= 360) return COLUMNS
  const west = Math.floor(wrapLongitude(rawWest))
  const east = Math.floor(wrapLongitude(rawEast))
  return ((((east - west) % COLUMNS) + COLUMNS) % COLUMNS) + 1
}

/** The cells a set of points falls in, deduplicated and ordered. */
export function cellsForPoints(points) {
  const keys = new Set()
  for (const point of points || []) {
    const lng = point?.lng ?? point?.[0]
    const lat = point?.lat ?? point?.[1]
    if (Number.isFinite(lng) && Number.isFinite(lat)) keys.add(cellKey(lng, lat))
  }
  return [...keys].sort()
}

/**
 * The cells within `metres` of a point — the ones a nearby search could read
 * from once its radius is allowed to widen. A degree of latitude is 111.32 km
 * everywhere; a degree of longitude is that times the cosine of the latitude,
 * which is why a cell near Tromsø is a sliver and one in Quito is a square.
 */
export function cellsWithin(lng, lat, metres) {
  const latitude = clampLatitude(lat)
  const north = metres / 111_320
  /* Near the poles the cosine goes to zero and the longitude span to
     infinity; past 89° take the whole row rather than divide by almost
     nothing. */
  const cosine = Math.cos((latitude * Math.PI) / 180)
  const east = Math.abs(cosine) < 0.02 ? 180 : north / cosine
  /* The edges go unwrapped, so cellsForBounds can see how wide the box is.
     Near the poles this span is the whole 360 degrees, and wrapping it first
     would have handed over two identical numbers. */
  return cellsForBounds({
    west: Number(lng) - east,
    east: Number(lng) + east,
    south: latitude - north,
    north: latitude + north,
  })
}

/** Whether a trip's stops sit inside cells we are told are covered. */
export function missingCells(wanted, covered) {
  const have = new Set(covered || [])
  return (wanted || []).filter(cell => !have.has(cell))
}
