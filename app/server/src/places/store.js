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

import { cellBounds } from './cells.js'

/* The select list, written once. `geom` is a geography; ST_X/ST_Y want a
   geometry, and the cast is free — it is the same stored point. */
const PLACE_COLUMNS = `p.id, p.gers_id, p.name, p.alternate_names,
  ST_X(p.geom::geometry) as lng, ST_Y(p.geom::geometry) as lat,
  p.cell, p.category, p.category_raw, p.address, p.website, p.phone, p.hours,
  p.operating, p.confidence, p.first_seen, p.last_refreshed`

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
const MARK_REQUESTED_SQL = `
  insert into place_coverage (cell, west, south, east, north, status, requested_at)
  select c.cell, c.west, c.south, c.east, c.north, 'pending', $6::timestamptz
  from unnest($1::text[], $2::float8[], $3::float8[], $4::float8[], $5::float8[])
    as c(cell, west, south, east, north)
  on conflict (cell) do update set
    status = case when place_coverage.status = 'ingesting' then place_coverage.status
                  else 'pending' end,
    requested_at = least(
      coalesce(place_coverage.requested_at, excluded.requested_at),
      excluded.requested_at)
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
export async function markRequested(db, cells, at = new Date()) {
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
