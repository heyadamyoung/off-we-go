/* What each places query costs on the box it runs on.
 *
 * The map's own path was measured and fixed: a tile is a primary key lookup
 * and answers in two milliseconds. The paths behind a login were not, because
 * the only probe we had runs on a GitHub runner and has no session — so
 * "searching for places takes seconds" could not be confirmed or denied from
 * anywhere. The answer was a deduction, and a deduction is what cost us the
 * eight hours the sweep spent crash-looping while every test passed.
 *
 * This measures them from inside, where no session is needed because there is
 * no HTTP: it imports the very functions the routes call — not a copy of
 * their SQL, which would be a second spelling drifting away from the first —
 * and times them against this deployment's database.
 *
 *     docker compose exec -T api node server/scripts/places-timings.mjs
 *
 * Twice each, because the two numbers are different questions: the first is
 * what the unlucky first caller pays with nothing in the buffer cache, the
 * second is what everybody after pays. On a box loading the planet the gap
 * between them is the whole story.
 *
 * Read-only. Every statement here is a select; nothing it does can change a
 * row, which is why it is safe to run against production on every deploy.
 */

import pg from 'pg'
import {
  CONFIDENCE_FLOOR,
  LABEL_ZOOMS,
  MAX_RADIUS_METRES,
  VIEW_WEIGHT,
} from '../src/places/rank.js'
import {
  nearbyPlaces,
  placeTile,
  placesInView,
  readPlaceTile,
  searchPlaces,
} from '../src/places/store.js'
import { zoomForBounds } from '../src/places/tiles.js'
import { STANDING, centreOf, tileFor } from '../src/places/viewpoints.js'

const say = line => console.log(`timings: ${line}`)

/* A census runs inside a deploy step with four minutes for everything it
   does, and an in-view query over a city was measured at 3.7 seconds. Five
   cities of six probes each could spend the lot, so the run has a deadline
   and stops at it rather than being killed halfway with nothing printed. */
const BUDGET_MS = Number(process.env.PLACES_TIMINGS_BUDGET_MS) || 45_000
/* What a typeahead sends: the fourth keystroke of a word that is in every
   city on earth, which is the worst case a trigram index has, and a
   two-letter prefix, which takes the other branch entirely. */
const TYPED = ['muse', 'ri']
/* The zoom a tile is measured at: far enough in that a square is a
   neighbourhood rather than a county, which is where somebody panning
   actually is. */
const TILE_ZOOM = 14
/** What the nearby route asks the database for: five candidates per record
    shown, because ranking is about kind and confidence as well as distance. */
const NEARBY_WANT = 100
const SEARCH_WANT = 50

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('timings: no DATABASE_URL — this runs inside the box, beside the database')
  process.exit(64)
}
/* Two connections, and no more. This is a measurement, and a measurement
   that takes connections away from the people being measured changes what it
   is measuring. */
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 10_000 })

const ms = () => Number(process.hrtime.bigint() / 1_000_000n)

/**
 * One question, asked twice.
 *
 * Errors are caught and reported rather than thrown: a statement timeout on
 * one probe must not cost the census the other eleven, and "this one could
 * not be answered in time" is itself the measurement.
 */
async function twice(run) {
  try {
    const first = ms()
    const rows = await run()
    const cold = ms() - first
    const second = ms()
    await run()
    return { cold, warm: ms() - second, rows: Array.isArray(rows) ? rows.length : rows }
  } catch (error) {
    return { error: String(error?.message || error) }
  }
}

const show = (name, found) =>
  found.error
    ? `${name} ${found.error}`
    : `${name} ${found.cold}ms then ${found.warm}ms (${found.rows})`

const started = ms()
const over = () => ms() - started > BUDGET_MS

for (const view of STANDING) {
  if (over()) {
    say(`stopped at the ${Math.round(BUDGET_MS / 1000)}s budget with ${view.name} unmeasured`)
    break
  }
  const { lng, lat } = centreOf(view)
  const parts = []

  for (const q of TYPED) {
    if (over()) break
    parts.push(
      show(
        `search "${q}"`,
        await twice(() => searchPlaces(pool, { q, near: { lng, lat }, limit: SEARCH_WANT })),
      ),
    )
  }

  if (!over()) {
    parts.push(
      show(
        'nearby',
        await twice(() =>
          nearbyPlaces(pool, {
            lat,
            lng,
            radius: 1_000,
            floor: CONFIDENCE_FLOOR,
            limit: NEARBY_WANT,
          }),
        ),
      ),
    )
  }

  if (!over()) {
    const zoom = zoomForBounds(view, LABEL_ZOOMS)
    parts.push(
      show(
        `in-view z${zoom}`,
        await twice(() =>
          placesInView(pool, view, {
            zoom,
            floor: CONFIDENCE_FLOOR,
            floorWeight: 0,
            weights: VIEW_WEIGHT,
          }),
        ),
      ),
    )
  }

  if (!over()) {
    const at = tileFor(lng, lat, TILE_ZOOM)
    parts.push(
      show(
        `tile z${TILE_ZOOM} kept`,
        await twice(async () => (await readPlaceTile(pool, at))?.length ?? 0),
      ),
    )
    parts.push(
      show(
        'tile built',
        await twice(
          async () =>
            (await placeTile(pool, at, { floor: CONFIDENCE_FLOOR, weights: VIEW_WEIGHT })).length,
        ),
      ),
    )
  }

  say(`${view.name}  ${parts.join(' · ')}`)
}

/* The widening a sparse nearby query walks, measured once rather than per
   city: it is four round trips out to 50 km, and it is the shape most likely
   to be slow somewhere nobody has ingested. */
if (!over()) {
  const { lng, lat } = centreOf(STANDING[2])
  const wide = await twice(() =>
    nearbyPlaces(pool, {
      lat,
      lng,
      radius: MAX_RADIUS_METRES,
      floor: CONFIDENCE_FLOOR,
      limit: NEARBY_WANT,
    }),
  )
  say(show(`widened to ${MAX_RADIUS_METRES / 1000}km`, wide))
}

await pool.end()
