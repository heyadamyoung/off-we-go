/* Every SQL statement the places layer serves from, in one file.
 *
 * It is one file because the index and the query have to agree, and they only
 * agree if they are written next to each other. Two of those agreements are
 * load-bearing and neither of them fails loudly:
 *
 *   1. `search_name` is a generated column holding `place_searchable(name)`,
 *      and the GIN trigram index is on that column. A query that folds the
 *      user's letters any other way — `lower()`, `unaccent()` on its own, or
 *      nothing at all — compares folded text against unfolded and returns an
 *      empty list. Not an error: an empty list. So `place_searchable($1)`
 *      appears on the query side of every name comparison below, and nowhere
 *      is a name compared without it.
 *   2. `order by geom <-> point` over the GiST index is a k-nearest-neighbour
 *      scan; `order by ST_Distance(...)` over the same rows is a sort of
 *      everything inside the radius. Measured on one cell of 168,523 places:
 *      1 km p50 1.5 ms / p95 2.6 ms, and 22 ms in a dense city centre. The
 *      `<->` is the reason, and `ST_Distance` appears only in the select list,
 *      where it costs nothing, never in the order by.
 *
 * What is deliberately not here: anything ingestion writes. Coverage rows are
 * read here and marked `pending` here, because a query that misses is how a
 * cell gets asked for — but claiming a cell, writing its row counts, its
 * quality report or its cursor belongs to the ingest, and a serving process
 * that could do those things is a serving process that can corrupt them.
 *
 * Every statement is parameterised. The only interpolated strings are the
 * column lists, which are constants in this file.
 */

import { cellBounds, cellsForBounds } from './cells.js'
import { LABEL_ZOOMS } from './rank.js'
import { tileBounds } from './tiles.js'

/* The select list, written once. `geom` is a geography; ST_X/ST_Y want a
   geometry, and the cast is free — it is the same stored point. */
const PLACE_COLUMNS = `p.id, p.gers_id, p.name, p.alternate_names,
  ST_X(p.geom::geometry) as lng, ST_Y(p.geom::geometry) as lat,
  p.cell, p.category, p.category_raw, p.address, p.website, p.phone, p.hours,
  p.operating, p.confidence, p.label_zoom, p.first_seen, p.last_refreshed`

const COVERAGE_COLUMNS = `cell, west, south, east, north, status, versions,
  place_count, quality, requested_at, started_at, last_refresh, attempts, error`

/** How many redirects will be followed before we call it a cycle. Upstream
    merges chain — a merged into b, b into c — but never deeply, and a loop
    written by a bad ingest must not become an infinite loop here. */
export const REDIRECT_HOPS = 8

const iso = value => (value ? new Date(value).toISOString() : null)
const numberOrNull = value => (value === null || value === undefined ? null : Number(value))

/** One row of `places`, in the shape the rest of the layer speaks. */
export const placeRow = row =>
  row && {
    id: row.id,
    gersId: row.gers_id ?? null,
    name: row.name,
    alternateNames: row.alternate_names ?? [],
    lng: Number(row.lng),
    lat: Number(row.lat),
    cell: row.cell,
    category: row.category,
    categoryRaw: row.category_raw ?? null,
    address: row.address ?? null,
    website: row.website ?? null,
    phone: row.phone ?? null,
    hours: row.hours ?? null,
    operating: row.operating ?? null,
    confidence: Number(row.confidence),
    /* The zoom this place earned among its neighbours, computed once at
       ingest. Null on a row that predates that pass; the API turns that into
       the floor zoom rather than into a place nobody can see. */
    labelZoom: numberOrNull(row.label_zoom),
    firstSeen: iso(row.first_seen),
    lastRefreshed: iso(row.last_refreshed),
    /* Present only on the queries that compute them; null rather than absent
       so a caller can tell "not asked" from "zero metres away". */
    metres: numberOrNull(row.metres),
    similarity: numberOrNull(row.similarity),
  }

/** One row of `place_sources` — who said so, under which licence. */
export const sourceRow = row => ({
  source: row.source,
  license: row.license,
  upstreamId: row.upstream_id,
  version: row.version,
  confidence: numberOrNull(row.confidence),
  fields: row.fields ?? [],
  recordedAt: iso(row.recorded_at),
})

/** One row of `place_coverage`. */
export const coverageRow = row => ({
  cell: row.cell,
  bounds: {
    west: Number(row.west),
    south: Number(row.south),
    east: Number(row.east),
    north: Number(row.north),
  },
  status: row.status,
  versions: row.versions ?? {},
  placeCount: Number(row.place_count ?? 0),
  quality: row.quality ?? null,
  requestedAt: iso(row.requested_at),
  startedAt: iso(row.started_at),
  lastRefresh: iso(row.last_refresh),
  attempts: Number(row.attempts ?? 0),
  error: row.error ?? null,
})

/* ---- search ----------------------------------------------------------- */

/* Two clauses, both of which the one GIN trigram index serves:
   `%` is similarity above pg_trgm's threshold, which is what catches a
   misspelling, and `like 'letters%'` is the prefix a typeahead is actually
   for — three letters have one trigram and score too low for `%` alone, so
   without the prefix clause a search stays empty until the fourth keystroke.

   `similarity` comes back in the select list and the ordering is left to
   rank.js. It could be done here with `order by sim desc`, and then the rule
   that a prefix beats a shorter fuzzy match, and that nearness biases without
   deciding, would live in a string no test can reach. */
/* Trigrams need three characters to exist, so below three the `%` operator
 * can use no index and an OR of an indexable arm with an unindexable one is a
 * sequential scan of the whole table. A two-letter typeahead must not be that.
 *
 * So a short query is a different statement: the prefix branch alone, walked
 * in the index's own order and stopped at the limit, which is bounded work
 * whatever the table holds. The answer is the first few names beginning with
 * what was typed rather than the best few — which is the honest thing a
 * two-letter query can be answered with, and the caller ranks them afterwards
 * like any other candidates. Three characters in, the real search takes over. */
const TRIGRAM_MINIMUM = 3

const SEARCH_PREFIX_SQL = `
  select ${PLACE_COLUMNS},
    similarity(p.search_name, place_searchable($1)) as similarity,
    case when $2::double precision is null then null
         else ST_Distance(p.geom, ST_MakePoint($2::double precision, $3::double precision)::geography)
    end as metres
  from places p
  where p.search_name like place_searchable($6) || '%' escape '\\'
    and ($4::text[] is null or p.cell = any($4::text[]))
  order by p.search_name
  limit $5`

const SEARCH_SQL = `
  select ${PLACE_COLUMNS},
    similarity(p.search_name, place_searchable($1)) as similarity,
    case when $2::double precision is null then null
         else ST_Distance(p.geom, ST_MakePoint($2::double precision, $3::double precision)::geography)
    end as metres
  from places p
  where (p.search_name % place_searchable($1)
         or p.search_name like place_searchable($6) || '%' escape '\\')
    and ($4::text[] is null or p.cell = any($4::text[]))
  order by similarity desc, p.confidence desc, p.id
  limit $5`

/**
 * Candidates for a typeahead. Unordered as far as the caller is concerned:
 * rank.js `rankSearch` decides what comes first.
 *
 * When `cells` is given the search runs twice — once inside the trip's cells,
 * once over everything — and the two are merged. Restricting to the trip's
 * geography alone would lose the Rijksmuseum for somebody planning from home;
 * not restricting at all would lose the café round the corner, because a
 * planet's worth of better trigram matches sit in front of it. Two bounded
 * index scans cost less than one unbounded one with a big limit.
 *
 * @param {{query: Function}} db
 * @param {{q: string, near?: {lng: number, lat: number}|null, cells?: string[]|null, limit?: number}} input
 */
/* What a person typed is a name, not a pattern.
 *
 * The prefix branch below is a LIKE, and `%` and `_` are wildcards inside one.
 * Unescaped, `?q=%` becomes `search_name like '%%'` — every row in the table,
 * with `similarity()` evaluated over each of them and a top-N sort on the
 * result. Measured on 60,000 rows that is a parallel sequential scan; at the
 * seventy-three million this layer is built for it is minutes of one of ten
 * connections, from a single GET, twice over when a trip narrows the search.
 * Ten of those and the whole API is out of connections.
 *
 * So the pattern is escaped and the fuzzy branch is not: `%` typed into a
 * search box is a character somebody is looking for, and pg_trgm's operator
 * treats it as one. */
const likeLiteral = value => String(value).replace(/[\\%_]/g, '\\$&')

export async function searchPlaces(db, { q, near = null, cells = null, limit = 10 } = {}) {
  const text = String(q ?? '').trim()
  if (!text) return []
  const pattern = likeLiteral(text)
  const statement = text.length < TRIGRAM_MINIMUM ? SEARCH_PREFIX_SQL : SEARCH_SQL
  const lng = near ? Number(near.lng) : null
  const lat = near ? Number(near.lat) : null
  const point = Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : [null, null]
  const passes = []
  const local = Array.isArray(cells) && cells.length ? cells : null
  if (local) passes.push(local)
  passes.push(null)

  const found = new Map()
  for (const scope of passes) {
    const result = await db.query(statement, [text, point[0], point[1], scope, limit, pattern])
    for (const row of result.rows) if (!found.has(row.id)) found.set(row.id, placeRow(row))
  }
  return [...found.values()]
}

/* ---- one place -------------------------------------------------------- */

const BY_ID_SQL = `select ${PLACE_COLUMNS} from places p where p.id = $1`
const BY_GERS_SQL = `select ${PLACE_COLUMNS} from places p where p.gers_id = $1`
/** Our own primary key. Anything else that reaches `placeById` is treated as a
    GERS id — see below on why both open the same door. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOURCES_SQL = `
  select place_id, source, license, upstream_id, version, confidence, fields, recorded_at
  from place_sources where place_id = $1 order by source, upstream_id`
const REDIRECT_SQL = 'select old_id, new_id, reason, at from place_redirects where old_id = $1'

/**
 * A place by id, following upstream's merges.
 *
 * A stop keeps a `place_id` for as long as the trip exists, and upstream
 * reissues its ids every month. Three answers, and the caller needs all
 * three to be different: the record; the record it was merged into, said so
 * (`redirectedFrom`), because a stop pointing at the loser of a merge must
 * still open; and `{gone: true}` for a place that genuinely closed, which is
 * a thing to tell a traveller and not the same as "no such id".
 *
 * A GERS id opens the same door as our uuid. 043 calls it "the canonical join
 * key across releases", and it is the only id a degraded answer can carry —
 * a record read straight out of Parquet has no row here to have a uuid. One
 * endpoint that takes both means a stop filed from a degraded list opens by
 * the same id after its cell is ingested, instead of the client having to
 * notice which kind of answer it was looking at.
 *
 * @param {{query: Function}} db
 * @param {string} id
 * @returns {Promise<null|{gone: true, id: string, reason: string, at: string|null}|object>}
 */
export async function placeById(db, id) {
  if (!UUID.test(String(id ?? ''))) {
    /* Redirects are keyed by our uuid, so there is no chain to follow here:
       upstream's own merges arrive as a changed row, not as a redirect. */
    const result = await db.query(BY_GERS_SQL, [id])
    if (!result.rows[0]) return null
    const place = placeRow(result.rows[0])
    const sources = await db.query(SOURCES_SQL, [place.id])
    return { ...place, sources: sources.rows.map(sourceRow), redirectedFrom: null }
  }
  let current = id
  const seen = new Set()
  for (let hop = 0; hop < REDIRECT_HOPS; hop += 1) {
    if (seen.has(current)) break
    seen.add(current)
    const result = await db.query(BY_ID_SQL, [current])
    if (result.rows[0]) {
      const place = placeRow(result.rows[0])
      const sources = await db.query(SOURCES_SQL, [place.id])
      return {
        ...place,
        sources: sources.rows.map(sourceRow),
        redirectedFrom: current === id ? null : id,
      }
    }
    const moved = await db.query(REDIRECT_SQL, [current])
    const row = moved.rows[0]
    if (!row) return null
    if (!row.new_id) {
      return { gone: true, id, reason: row.reason, at: iso(row.at) }
    }
    current = row.new_id
  }
  /* A chain this long is a broken ingest, not a traveller's problem: the id
     resolves to nothing rather than to whatever the loop happened to hold. */
  return null
}

/* ---- nearby ----------------------------------------------------------- */

/* The measured shape, unchanged: ST_DWithin for the radius (index-accelerated
   over the GiST index), the distance in the select list only, and `<->` for
   the order so the scan stops at `limit` instead of sorting the neighbourhood.
   The category filter is a parameter rather than two statements so the plan is
   cached once. */
const NEARBY_SQL = `
  select ${PLACE_COLUMNS},
    ST_Distance(p.geom, ST_MakePoint($1::double precision, $2::double precision)::geography) as metres
  from places p
  where ST_DWithin(p.geom, ST_MakePoint($1::double precision, $2::double precision)::geography, $3::double precision)
    and p.confidence >= $4::real
    and ($6::text is null or p.category = $6::text)
  order by p.geom <-> ST_MakePoint($1::double precision, $2::double precision)::geography
  limit $5`

/**
 * Everything within `radius` metres, nearest first, for rank.js to reorder.
 * @param {{query: Function}} db
 * @param {{lat: number, lng: number, radius: number, category?: string|null, floor?: number, limit?: number}} input
 */
export async function nearbyPlaces(
  db,
  { lat, lng, radius, category = null, floor = 0, limit = 20 } = {},
) {
  const result = await db.query(NEARBY_SQL, [lng, lat, radius, floor, limit, category])
  return result.rows.map(placeRow)
}

/* Everything inside a map's viewport, for the pin layer.
 *
 * A box, not a radius, because that is the question a map asks: it has corners
 * and no centre worth measuring from. `ST_Intersects` against an envelope uses
 * the same GiST index the nearby query does.
 *
 * Ordered in the database rather than in JavaScript, and this is the one place
 * that is true. A city viewport holds tens of thousands of rows and the screen
 * wants a few hundred; fetching them all to sort them would be the whole point
 * of an index thrown away at the last step. So the weighting rank.js applies
 * per category is mirrored into a CASE here, multiplied by confidence, and the
 * limit does the rest. The two have to agree, and a test compares them value
 * by value so a change to one fails on the other.
 *
 * `floorWeight` is the zoomed-out view: above it only the things worth a pin
 * from orbit, below it everything.
 *
 * @param {{query: Function}} db
 * @param {{west,south,east,north}} bounds
 * @param {{limit?: number, floor?: number, floorWeight?: number, weights: Record<string, number>}} input
 */
export async function placesInView(
  db,
  bounds,
  { limit = 500, floor = 0, floorWeight = 0, weights } = {},
) {
  const kinds = Object.entries(weights || {})
  if (!kinds.length) throw new Error('places: a viewport query needs the category weights')
  /* Built from the weights the caller hands in, which come from rank.js. The
     keys are our own twenty category names, never user text — and they are
     checked against that list here rather than trusted, because a map query is
     the one statement in this file that composes any SQL at all. */
  for (const [category] of kinds) {
    if (!/^[a-z]+$/.test(category)) throw new Error(`places: not a category: ${category}`)
  }
  const weight = `case p.category ${kinds
    .map(([category, value]) => `when '${category}' then ${Number(value).toFixed(3)}`)
    .join(' ')} else 0.1 end`
  const sql = `
    select ${PLACE_COLUMNS}, ${weight} as kind, null::double precision as metres
    from places p
    where p.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
      and p.confidence >= $5::real
      and ${weight} >= $6::double precision
    order by (${weight}) * p.confidence desc, p.id
    limit $7`
  const result = await db.query(sql, [
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
    floor,
    floorWeight,
    limit,
  ])
  return result.rows.map(placeRow)
}

/** The sources behind a page of places, in one round trip rather than N. */
const SOURCES_FOR_SQL = `
  select place_id, source, license, upstream_id, version, confidence, fields, recorded_at
  from place_sources where place_id = any($1::uuid[]) order by source, upstream_id`

/**
 * @param {{query: Function}} db
 * @param {string[]} ids
 * @returns {Promise<Map<string, object[]>>}
 */
export async function sourcesFor(db, ids) {
  const wanted = [...new Set(ids || [])]
  const out = new Map(wanted.map(id => [id, []]))
  if (!wanted.length) return out
  const result = await db.query(SOURCES_FOR_SQL, [wanted])
  for (const row of result.rows) out.get(row.place_id)?.push(sourceRow(row))
  return out
}

/* Which licences a page of places is under, without the rows behind them.
 *
 * A map draws one attribution line for the whole layer, which is how OSM data
 * is attributed on every map that carries it — and it is what the licence
 * actually asks for. Three hundred pins each carrying their own provenance is
 * a join of three hundred rows to render one sentence: measured, it was most
 * of a 119 ms viewport query. The distinct list costs an index-only scan.
 *
 * Per-record provenance is still there, on `/api/places/:id`, which is where
 * somebody asking about one place gets it.
 */
const LICENSES_FOR_SQL = `
  select distinct license from place_sources where place_id = any($1::uuid[])`

export async function licensesFor(db, ids) {
  const wanted = [...new Set(ids || [])]
  if (!wanted.length) return []
  const result = await db.query(LICENSES_FOR_SQL, [wanted])
  return result.rows
    .map(row => row.license)
    .filter(Boolean)
    .sort()
}

/* ---- coverage --------------------------------------------------------- */

const COVERAGE_FOR_SQL = `
  select ${COVERAGE_COLUMNS} from place_coverage where cell = any($1::text[])`

/**
 * What we hold for these cells. Cells with no row come back absent, which the
 * caller reads as "never asked for" — a different thing from `pending`.
 * @param {{query: Function}} db
 * @param {string[]} cells
 * @returns {Promise<Map<string, object>>}
 */
export async function coverageFor(db, cells) {
  const wanted = [...new Set(cells || [])].filter(Boolean)
  if (!wanted.length) return new Map()
  const result = await db.query(COVERAGE_FOR_SQL, [wanted])
  return new Map(result.rows.map(row => [row.cell, coverageRow(row)]))
}

/* One statement for any number of cells, because a trip across Europe asks
   for a dozen at once and a round trip each would put the predictive path's
   cost on the write that triggered it.

   The two `case`s are the whole of the concurrency story:
   - a cell being ingested right now stays `ingesting`. Knocking it back to
     `pending` would let a second worker claim a cell the first is halfway
     through, and the ingest's own row counts would then be a race.
   - `requested_at` keeps the *earliest* ask. It is the queue's ordering key,
     and re-stamping it every time a trip is edited would send a cell that has
     waited a week to the back of the queue on the day somebody renames a
     stop. */
/* Somebody is waiting on this one. */
export const WANTED_NOW = 0
/* The planet, queued by nobody in particular. */
export const WANTED_EVENTUALLY = 1

const MARK_REQUESTED_SQL = `
  insert into place_coverage
    (cell, west, south, east, north, status, requested_at, priority)
  select c.cell, c.west, c.south, c.east, c.north, 'pending', $6::timestamptz, $7::smallint
  from unnest($1::text[], $2::float8[], $3::float8[], $4::float8[], $5::float8[])
    as c(cell, west, south, east, north)
  on conflict (cell) do update set
    status = case when place_coverage.status = 'ingesting' then place_coverage.status
                  else 'pending' end,
    requested_at = least(
      coalesce(place_coverage.requested_at, excluded.requested_at),
      excluded.requested_at),
    -- Asking promotes and never demotes. A traveller looking at a cell the
    -- planet backfill had merely queued moves it to the front; the backfill
    -- sweeping past a cell somebody is waiting on must not push it back.
    priority = least(place_coverage.priority, excluded.priority)
  returning cell, status, requested_at`

/**
 * Ask for these cells. Idempotent, and safe to call from a request path: one
 * statement, no read first, and nothing it does can block an ingest.
 *
 * @param {{query: Function}} db
 * @param {string[]} cells
 * @param {Date} [at]
 * @returns {Promise<Array<{cell: string, status: string, requestedAt: string|null}>>}
 */
export async function markRequested(db, cells, at = new Date(), priority = WANTED_NOW) {
  const wanted = [...new Set(cells || [])].filter(Boolean)
  if (!wanted.length) return []
  const bounds = wanted.map(cell => cellBounds(cell))
  const result = await db.query(MARK_REQUESTED_SQL, [
    wanted,
    bounds.map(box => box.west),
    bounds.map(box => box.south),
    bounds.map(box => box.east),
    bounds.map(box => box.north),
    at.toISOString(),
    priority,
  ])
  return result.rows.map(row => ({
    cell: row.cell,
    status: row.status,
    requestedAt: iso(row.requested_at),
  }))
}

/* The queue, as a read. Oldest ask first, which is the only ordering this
   table can express — see coverage.js on why a scheduler that wants
   "soonest departure first" has to join the trips itself. Failed cells are
   included so a drain can retry them; `attempts` is there to back off on. */
const QUEUE_SQL = `
  select ${COVERAGE_COLUMNS} from place_coverage
  where status = any($1::text[])
  order by requested_at asc nulls last, cell asc
  limit $2`

/**
 * Cells waiting to be ingested. A read, not a claim: the ingest claims by
 * moving a row to `ingesting` in its own transaction, which is not this
 * file's business.
 *
 * @param {{query: Function}} db
 * @param {{statuses?: string[], limit?: number}} [input]
 */
export async function pendingCells(db, { statuses = ['pending', 'stale'], limit = 50 } = {}) {
  const result = await db.query(QUEUE_SQL, [statuses, limit])
  return result.rows.map(coverageRow)
}

/* ---- a tile of places -------------------------------------------------- */

/* Why a tile and not a viewport.
 *
 * The viewport query above answers "what is in this box", and a map asks it
 * again every time the camera moves — a different box, a different top three
 * hundred, and dots at the edges appearing and vanishing for no reason a
 * person can see. Reported as janky, and it was: the instability had nothing
 * to do with which places deserve to be drawn and everything to do with the
 * question being asked afresh, with a different answer, sixty times a pan.
 *
 * A tile is the same question with a fixed frame. z/x/y names one square of
 * the world at one zoom, its contents are decided once, and panning back and
 * forth over it gets the identical answer — so the map can keep what it has
 * instead of reloading it. That is what every map that does not flicker does,
 * and it is why they do not flicker.
 *
 * Three things fall out of it for free:
 *   the zoom is known    so the query can drop the places that would not be
 *                        drawn at this zoom rather than sending three hundred
 *                        and having the client hide most of them.
 *   the answer is cacheable  one tile, one URL, one body, for everybody.
 *   the budget is per tile   "the best forty in this square" is a sentence
 *                        about a fixed area, so density is even instead of
 *                        being whatever a viewport happened to contain.
 */

/* How many places one tile carries is no longer decided here, and that is the
   change worth knowing about. It used to be this file's `limit 48`, applied
   to whatever the zoom tiers let through — which meant the cap did the
   thinning in a city and nothing did it on an island, and which square a mark
   fell in decided whether it survived. It is decided once now, per place, by
   where that place comes among its neighbours: places/rank.js LABEL_PER_TILE
   and store.js assignLabelZoom. A tile asks for everything at its zoom and
   gets about that many, evenly, because that is what the number on the row
   already arranged. */

/** The buffer, in tile units of 4096. A label sitting a few pixels outside a
    tile still has to be drawn, or every tile boundary becomes a seam of
    missing names. 64 is the common default and about 16 screen pixels. */
const TILE_BUFFER = 64

/**
 * One vector tile of places, as bytes MapLibre can read directly.
 *
 * @param {{query: Function}} db
 * @param {{z: number, x: number, y: number}} tile
 * @param {{floor?: number, limit?: number, zooms: Record<string, number>,
 *          weights: Record<string, number>}} options
 *   `zooms` is the zoom each category earns its dot at and `weights` is how
 *   they rank against each other — both from places/rank.js, composed into
 *   SQL here for the same reason placesInView composes its weights: the
 *   taxonomy lives in one file and this is where it is spent.
 * @returns {Promise<Buffer>} the tile, empty when nothing is in it
 */
export async function placeTile(db, { z, x, y }, { floor = 0, weights } = {}) {
  const kinds = Object.entries(weights || {})
  if (!kinds.length) throw new Error('places: a tile needs the category weights')
  for (const [category] of kinds) {
    if (!/^[a-z]+$/.test(category)) throw new Error(`places: not a category: ${category}`)
  }
  /* Which mark wins a collision, once MapLibre is drawing them. The zoom a
     place appears at is a column now; this is the only number still worked
     out per request, and it is the same weight the zoom pass ranked by. */
  const rank = `((case p.category ${kinds
    .map(([category, value]) => `when '${category}' then ${Number(value).toFixed(3)}`)
    .join(' ')} else 0.100 end) * (0.4 + 0.6 * least(1, greatest(0, p.confidence))))`
  const sql = `
    with bounds as (select ST_TileEnvelope($1, $2, $3) as box),
    picked as (
      -- The same short property names the GeoJSON path writes: n for the
      -- label, k for the kind, so one set of paint expressions draws both and
      -- neither has to know which source it came from. They are short because
      -- they ride on every feature of every tile.
      -- SQL comments rather than a JS block comment, because this whole
      -- statement is a template literal and a backtick in it ends the string.
      select p.id, p.name as n, p.category as k,
             coalesce(p.label_zoom, $5::real) as minzoom,
             round((${rank}) * 1000)::int as rank,
             p.geom::geometry as geom
      from places p, bounds b
      where p.geom && ST_Transform(b.box, 4326)::geography
        and p.confidence >= $4::real
        -- No limit, and that is the whole design rather than an oversight.
        -- label_zoom was chosen so that each square of each zoom holds about
        -- LABEL_PER_TILE marks (see assignLabelZoom); capping here on top of
        -- that is what used to make a mark visible at one zoom and gone at
        -- the next, because the cap fell differently on each square.
        -- A row from before the zoom pass has none yet, and it is drawn from
        -- the first zoom rather than the last. The floor was tried and is
        -- exactly wrong: every row is null the moment the column is added,
        -- so a deploy would have emptied the map everywhere but the pavement
        -- until a pass that takes an hour had run. Visible until it is
        -- placed is never worse than what came before; invisible until it is
        -- placed is an outage. The worker fills these in cell by cell.
        and coalesce(p.label_zoom, $5::real) <= $1::double precision
    )
    select coalesce(ST_AsMVT(tile, 'places', 4096, 'geom'), ''::bytea) as tile
    from (
      select id::text as id, n, k, minzoom, rank,
             ST_AsMVTGeom(ST_Transform(geom, 3857), b.box, 4096, ${TILE_BUFFER}, true) as geom
      from picked, bounds b
    ) as tile
    where tile.geom is not null`
  const result = await db.query(sql, [z, x, y, floor, LABEL_ZOOMS.from])
  return result.rows[0]?.tile ?? Buffer.alloc(0)
}

/* The slippy tile a point falls in, as SQL rather than as JavaScript.
 *
 * The same arithmetic as places/tiles.js tileX and tileY, which is why the
 * two are tested against each other: a sign error here silently ranks places
 * against the wrong neighbours, which looks like nothing at all until a city
 * is bare and a field is crowded. */
const TILE_X = (lng, z) => `floor((((${lng}) + 180) / 360) * power(2, ${z}))`
const TILE_Y = (lat, z) => `floor(
  (1 - ln(tan(radians(${lat})) + 1 / cos(radians(${lat}))) / pi()) / 2 * power(2, ${z}))`

/**
 * Give every place in a region the zoom it earns among its neighbours.
 *
 * For each zoom that thins, the places in each square of that zoom are put in
 * order of what they are worth and the best `perTile` of them that have not
 * already earned a zoom earn this one; everything still unclaimed lands on
 * the floor zoom, where a square is three hundred metres across and somebody
 * has asked for everything. The result is one number per row, and a tile is
 * then `label_zoom <= z` with no cap — so a mark that has appeared cannot
 * disappear as you zoom in. Monotonic by construction.
 *
 * One function, called two ways, and the difference is only how much
 * neighbourhood it can see. The ingest calls it with a cell's bounds inside
 * the cell's own transaction, so a square is never loaded without its marks
 * being placed; a square that straddles two cells is then ranked against the
 * half we have, which is a little generous at the seams. The planet pass
 * calls it with the whole world and is the authority. Same SQL either way,
 * because two implementations of one rule is how the seams stop matching the
 * middle.
 *
 * @param {{west,south,east,north}|null} bounds  null for the whole world
 * @param {{weights: Record<string, number>, perTile?: number,
 *          zooms?: {from: number, to: number, floor: number}}} options
 * @returns {Promise<number>} rows given a zoom
 */
export async function assignLabelZoom(db, bounds, { weights, perTile, zooms, earliest }) {
  const kinds = Object.entries(weights || {})
  if (!kinds.length) throw new Error('places: a zoom pass needs the category weights')
  for (const [category] of kinds) {
    if (!/^[a-z]+$/.test(category)) throw new Error(`places: not a category: ${category}`)
  }
  const ceilings = Object.entries(earliest || {})
  if (!ceilings.length) throw new Error('places: a zoom pass needs the category ceilings')
  for (const [category, zoom] of ceilings) {
    if (!/^[a-z]+$/.test(category)) throw new Error(`places: not a category: ${category}`)
    if (!Number.isInteger(zoom)) throw new Error(`places: not a zoom: ${category}=${zoom}`)
  }
  /* Composed, and checked above, exactly as placeTile composes the same
     table: these are the only two statements in this file that are not
     entirely parameters. */
  const weight = `(case p.category ${kinds
    .map(([category, value]) => `when '${category}' then ${Number(value).toFixed(3)}`)
    .join(' ')} else 0.100 end) * (0.4 + 0.6 * least(1, greatest(0, p.confidence)))`
  /* The ceiling: how prominent this kind of place may ever be. Composed the
     same way and checked the same way as the weights above. Density decides
     which of the places allowed at a zoom take its slots; this decides which
     are allowed there at all, because a café does not become a landmark by
     being the only one in an empty county. */
  const earliestAt = `(case p.category ${ceilings
    .map(([category, zoom]) => `when '${category}' then ${Number(zoom)}`)
    .join(' ')} else ${Number(earliest.other ?? zooms.floor)} end)`
  const lng = 'ST_X(p.geom::geometry)'
  const lat = 'ST_Y(p.geom::geometry)'
  /* No bounds means everywhere, and everywhere is not an envelope.
   *
   * The planet pass was written first as an envelope of the whole world cast
   * to geography, which matches nothing at all: a geography bounding box
   * wraps, so one spanning -180 to 180 degenerates rather than covering
   * everything. Measured, on two million rows: the world envelope matched
   * zero and a one-degree box matched 174,634. It is not a predicate that
   * needs widening; it is a predicate that should not be there. */
  const everywhere = !bounds
  const box = 'ST_MakeEnvelope($1, $2, $3, $4, 4326)'
  const within = everywhere ? 'true' : `p.geom && ${box}::geography`
  const at = n => (everywhere ? `$${n - 4}` : `$${n}`)
  const sql = `
    with claimed as (
      select id, min(z) as z from (
        select p.id, z,
               row_number() over (
                 partition by z, ${TILE_X(lng, 'z')}, ${TILE_Y(lat, 'z')}
                 order by ${weight} desc, p.id
               ) as place
        from places p, generate_series(${at(5)}::int, ${at(6)}::int) as z
        where ${within} and z >= ${earliestAt}
      ) ranked
      where place <= ${at(7)}::int
      group by id
    ),
    given as (
      update places p set label_zoom = c.z from claimed c where p.id = c.id
      returning p.id
    ),
    -- Everything the thinning zooms did not claim belongs to the floor, where
    -- a square is small enough that a selection is not what anybody wants.
    rest as (
      update places p set label_zoom = ${at(8)}::real
      where ${within} and not exists (select 1 from claimed c where c.id = p.id)
      returning p.id
    )
    select (select count(*) from given) + (select count(*) from rest) as placed`
  const { from, to, floor } = zooms
  const corners = everywhere ? [] : [bounds.west, bounds.south, bounds.east, bounds.north]
  const result = await db.query(sql, [...corners, from, to, perTile, floor])
  return Number(result.rows[0]?.placed) || 0
}

/**
 * A tile already built, or null when this square has never been asked for.
 *
 * The one query on the warm path, and the reason a tiled map is quick: a
 * primary key lookup returning bytes that are already encoded.
 *
 * @param {{query: Function}} db
 * @param {{z: number, x: number, y: number}} tile
 * @returns {Promise<Buffer|null>}
 */
export async function readPlaceTile(db, { z, x, y }) {
  const result = await db.query('select body from place_tiles where z = $1 and x = $2 and y = $3', [
    z,
    x,
    y,
  ])
  return result.rows[0]?.body ?? null
}

/**
 * What is underneath a tile: how many of the cells it sits on have been
 * ingested, how many are still owed, and when the newest of them last moved.
 *
 * A tile is only worth keeping if the ground under it is finished. This is
 * the question that says whether it is, and it exists because not asking it
 * cost a traveller a map: they panned over Scotland before Scotland was
 * ingested, every square they looked at was built empty, and every one of
 * those empties was then cached — in this table, and for an hour in their
 * browser, and for a day after that as stale-while-revalidate. The ground
 * filled in half an hour. The map did not.
 *
 * @param {{z: number, x: number, y: number}} tile
 * @returns {{covered: number, unready: number, refreshed: Date|null}}
 */
export async function tileGround(db, { z, x, y }) {
  /* By key, not by geometry.
   *
   * Which cells a tile sits on is arithmetic — the grid is one degree and the
   * tile's corners are known — so this is a primary key lookup on one to four
   * rows. Written first as an overlap test against every coverage row, which
   * is a sequential scan constructing sixty thousand envelopes per tile:
   * measured at 17.8ms against a planet-sized coverage table, on the cold
   * path, next to a tile build that costs 13ms. It more than doubled the cost
   * of a first look to answer a question the caller could already do in its
   * head. */
  const wanted = cellsForBounds(tileBounds(z, x, y))
  const { rows } = await db.query(
    `select count(*)::int as covered,
            count(*) filter (where status not in ('ready', 'empty'))::int as unready,
            max(last_refresh) as refreshed
     from place_coverage where cell = any($1::text[])`,
    [wanted],
  )
  const found = rows[0] || {}
  return {
    covered: Number(found.covered) || 0,
    unready: Number(found.unready) || 0,
    refreshed: found.refreshed || null,
    /* How many cells there are to be covered, so the caller can tell "all of
       them are ready" from "the one with a row is ready and the other three
       have never been asked for". */
    cells: wanted.length,
  }
}

/**
 * Keep a built tile, unless the ground moved while it was being built.
 *
 * Two things here that were not here before, and both were bugs rather than
 * omissions.
 *
 * `do update` rather than `do nothing`: a tile that is wrong could not be
 * replaced, only deleted, so one bad build was permanent.
 *
 * And `since` closes the race that made bad builds in the first place. The
 * route reads the places, encodes them, and writes the bytes back without
 * holding a transaction across the two — so an ingest could commit in
 * between, run clearPlaceTiles, and then have this insert land *after* the
 * delete, caching a tile of rows from before the ingest for ever. The caller
 * passes the moment it started reading; a cell under this tile that has been
 * refreshed since then means the bytes describe a past, and the right thing
 * to do with them is nothing. The next request builds it again.
 *
 * @param {Date|string|null} [since]  when the caller started reading
 */
export async function writePlaceTile(db, { z, x, y }, body, places = 0, since = null) {
  /* The same cells by key, for the same reason as tileGround above. */
  const wanted = cellsForBounds(tileBounds(z, x, y))
  const result = await db.query(
    `insert into place_tiles (z, x, y, body, places, built_at)
     select $1, $2, $3, $4, $5, now()
     where $6::timestamptz is null or not exists (
       select 1 from place_coverage
       where cell = any($7::text[]) and last_refresh > $6::timestamptz)
     on conflict (z, x, y) do update set
       body = excluded.body, places = excluded.places, built_at = excluded.built_at`,
    [z, x, y, body, places, since, wanted],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Throw away the tiles over a piece of ground, because the places under them
 * have changed.
 *
 * Called when a cell is ingested or refreshed. A tile nobody drops is a tile
 * that shows last month's city for ever, and this is the only thing standing
 * between "built once" and "wrong for ever".
 *
 * @param {{query: Function}} db
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @returns {Promise<number>} how many were dropped
 */
export async function clearPlaceTiles(db, bounds) {
  const result = await db.query(
    `delete from place_tiles t
     using (select ST_MakeEnvelope($1, $2, $3, $4, 4326) as box) c
     where ST_Transform(ST_TileEnvelope(t.z, t.x, t.y), 4326) && c.box`,
    [bounds.west, bounds.south, bounds.east, bounds.north],
  )
  return result.rowCount ?? 0
}
