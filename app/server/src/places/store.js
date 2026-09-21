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
 *   2. `order by geom <-> point` with a `limit` is a k-nearest-neighbour walk
 *      that stops at the limit. Put `ST_DWithin` in the same `where` and it
 *      stops being one: the planner has a radius to estimate from, picks a
 *      bitmap scan over the confidence index instead, and measures the
 *      distance to every place in the city. Measured on one cell of 302,979
 *      places — 1 km 71 ms, 5 km 507 ms, 20 km 583 ms. The radius belongs
 *      outside, where it filters a finished list of forty and cannot reach
 *      the plan: 1.3 ms, 1.6 ms, 1.7 ms for the same three.
 *   3. the zoom filter and the spatial index are one index and have to be
 *      written the same way, literal for literal — `ZOOM_AT` below is that
 *      string and every statement spends it verbatim. `coalesce(label_zoom,
 *      $5::real)` does not match an index on `coalesce(label_zoom, 17::real)`,
 *      and `<= $1::double precision` widens the column rather than narrowing
 *      the constant; either one loses the index condition and the query reads
 *      every place in the viewport to throw almost all of them away. That was
 *      98 ms for a phone-sized box over central Paris and 155 ms for a z11
 *      tile, against 2.1 ms and 1.5 ms once both halves are indexed. See
 *      migration 051, which holds the same two sentences from the other side.
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
import { tileBounds, tileRange } from './tiles.js'

/* Every zoom a tile can be stored at, which is every zoom the tile route
   will answer for — see tileQuery in routes.js. A tile at a zoom left out of
   this list would survive a clear and show last month's city for ever, so it
   is the route's range and not a guess at which zooms get used. */
const KEPT_ZOOMS = Array.from({ length: 21 }, (_, z) => z)

/* The select list, written once. `geom` is a geography; ST_X/ST_Y want a
   geometry, and the cast is free — it is the same stored point. */
const PLACE_COLUMNS = `p.id, p.gers_id, p.name, p.alternate_names,
  ST_X(p.geom::geometry) as lng, ST_Y(p.geom::geometry) as lat,
  p.cell, p.category, p.category_raw, p.address, p.website, p.phone, p.hours,
  p.operating, p.confidence, p.label_zoom, p.first_seen, p.last_refreshed`

/* What a map needs, which is much less. A pin is a dot, a label and the two
   numbers that decide when it is drawn and which of two dots wins — see
   `pin` in places/routes.js, which is the only reader. The wide list above
   carries `alternate_names`, `address` and `hours`, none of which a pin
   renders and all three of which are out-of-line values the heap has to be
   followed to read. */
const PIN_COLUMNS = `p.id, p.name,
  ST_X(p.geom::geometry) as lng, ST_Y(p.geom::geometry) as lat,
  p.category, p.confidence, p.label_zoom`

/* The zoom a place is drawn from, as the index holds it.
 *
 * Null means the placing pass has not reached this row yet, and the question
 * is what to draw in the meantime. It used to be LABEL_ZOOMS.from, which is
 * 11, which is a whole city — so a place nobody had ranked yet was treated as
 * the most prominent kind there is and drawn at every zoom from 11 inward.
 * That is the carpet of dots over Regina: not a cell that was placed badly, a
 * cell that had not been placed at all, and the sweep loads the planet far
 * faster than four cells a minute can rank it.
 *
 * Unknown prominence is the least prominence, not the most. LABEL_ZOOMS.floor
 * is 17, the pavement, where somebody is asking for everything rather than a
 * selection of it — so an unranked place waits there until the pass gives it a
 * real zoom, and until then a city reads as empty rather than as noise. Empty
 * is honest about what we know; the carpet was not.
 *
 * The constant is written out, because an expression index is matched on its
 * text: a parameter here, or the number spelled any other way, silently costs
 * every map query its index. Which is also why the index below is named after
 * the number — change this and the name changes, so an index built on the old
 * one can never be mistaken for a current one. */
const ZOOM_AT = `coalesce(p.label_zoom, ${LABEL_ZOOMS.floor}::real)`

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

/** One pin, which is what `PIN_COLUMNS` selects: everything a dot on a map
    is made of and nothing else. A separate shape from `placeRow` rather than
    a thinner call of it, because a record with `address: null` on it cannot
    be told from a place that has no address, and this one was never asked. */
export const pinRow = row =>
  row && {
    id: row.id,
    name: row.name,
    lng: Number(row.lng),
    lat: Number(row.lat),
    category: row.category,
    confidence: Number(row.confidence),
    labelZoom: numberOrNull(row.label_zoom),
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

const HERE = `ST_MakePoint($1::double precision, $2::double precision)::geography`

/* Nearest first, and the radius kept out of the plan.
 *
 * `order by geom <-> here limit n` is a walk outwards that stops when it has
 * n. Adding `ST_DWithin(..., radius)` to the same `where` is what stopped it
 * being one: the planner then has a radius to estimate selectivity from, it
 * guesses the whole neighbourhood qualifies, and picks a bitmap scan over the
 * confidence index that computes a geodetic distance for every place in the
 * city before sorting them. Measured on one cell of 302,979 places, from the
 * middle of Paris: 71 ms at 1 km, 507 ms at 5 km, 583 ms at 20 km — and the
 * nearby route walks up to four widening rungs, so a sights list was two
 * seconds of that. Spheroid against sphere made no difference; the radius
 * being in the `where` was the whole of it.
 *
 * Outside, the radius is arithmetic on a finished list of at most `limit`
 * rows and cannot reach the plan at all: 1.3 ms, 1.6 ms, 1.7 ms for the same
 * three. Nothing is lost by moving it — the rows arrive in distance order, so
 * everything past the first one outside the radius is outside it too.
 *
 * The outer `order by` is not the sort this was avoiding. `<->` on geography
 * orders by the sphere and `ST_Distance` reports the spheroid, which differ
 * by a fraction of a metre in a kilometre — enough to swap two places at the
 * same distance, so the list would come back all but sorted, which is worse
 * than either. Re-sorting at most `limit` rows by the number actually
 * reported costs nothing and makes the two agree exactly. What remains is
 * that a place within a fraction of a metre of the radius may fall either
 * side of it; nothing about a list of sights can tell.
 *
 * Two statements rather than one with `($6 is null or category = $6)`. That
 * `or` is unreadable to the planner — it cannot use either branch's
 * selectivity, and the plan it settles on is wrong for both. */
const nearbySelect = category => `
  select * from (
    select ${PLACE_COLUMNS}, ST_Distance(p.geom, ${HERE}) as metres
    from places p
    where p.confidence >= $4::real${category}
    order by p.geom <-> ${HERE}
    limit $5
  ) near
  where near.metres <= $3::double precision
  order by near.metres`

const NEARBY_SQL = nearbySelect('')
const NEARBY_IN_SQL = nearbySelect('\n      and p.category = $6::text')

/**
 * Everything within `radius` metres, nearest first, for rank.js to reorder.
 * @param {{query: Function}} db
 * @param {{lat: number, lng: number, radius: number, category?: string|null, floor?: number, limit?: number}} input
 */
export async function nearbyPlaces(
  db,
  { lat, lng, radius, category = null, floor = 0, limit = 20 } = {},
) {
  const result = category
    ? await db.query(NEARBY_IN_SQL, [lng, lat, radius, floor, limit, category])
    : await db.query(NEARBY_SQL, [lng, lat, radius, floor, limit])
  return result.rows.map(placeRow)
}

/* Everything inside a map's viewport, for the pin layer.
 *
 * A box, not a radius, because that is the question a map asks: it has corners
 * and no centre worth measuring from. `ST_Intersects` against an envelope uses
 * the same GiST index the nearby query does.
 *
 * Which of two marks wins the same piece of screen is decided in the database,
 * from the weighting rank.js applies per category mirrored into a CASE here
 * and multiplied by confidence. The two have to agree, and a test compares
 * them value by value so a change to one fails on the other. It is a sort of
 * the few dozen rows the zoom allows, not of the viewport: the cut was made
 * by `label_zoom` in the index, before any row was read.
 *
 * `floorWeight` is the zoomed-out view: above it only the things worth a pin
 * from orbit, below it everything.
 *
 * @param {{query: Function}} db
 * @param {{west,south,east,north}} bounds
 * @param {{limit?: number, floor?: number, floorWeight?: number, zoom: number,
 *          weights: Record<string, number>}} input
 */
export async function placesInView(db, bounds, { floor = 0, floorWeight = 0, weights, zoom } = {}) {
  const kinds = Object.entries(weights || {})
  if (!kinds.length) throw new Error('places: a viewport query needs the category weights')
  if (!Number.isFinite(zoom)) throw new Error('places: a viewport query needs the zoom it is at')
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
  /* What belongs at this zoom, not the best N of everything here.
   *
   * This used to rank by weight and cut at a limit, which is what the tile
   * query did before #189 and is the defect that removed: a cap decides by
   * whichever places happen to be in the box, so panning gives a different
   * arbitrary three hundred and a mark that was on screen vanishes when the
   * camera moves an inch. label_zoom already answers how much of a place
   * belongs on screen at a given scale; capping on top of it throws that
   * answer away and reintroduces the flicker.
   *
   * So: the zoom the viewport is looking at, and every place that has earned
   * it. No limit at all, because the zoom is one: it is derived from the
   * span, so a box can never be large and zoomed-in at once. A city is four
   * squares of whatever their kinds put there; a continent is zoom 3, no
   * place has earned 3, and nothing is drawn. The number that used to sit
   * here existed because zoomForBounds clamped a world-sized box up to zoom
   * 11 and asked for ninety-five million marks; it does not clamp any more,
   * and a cap on top of a rank is a second answer to a question the rank has
   * already answered better.
   *
   * Both halves of that go to the index together, which is the only reason it
   * is quick: PLACE_VIEW_INDEX is `gist (geom, coalesce(label_zoom, 17))`,
   * so the box and the zoom are one index condition and the eighty thousand
   * places a Paris viewport contains never leave the index. Fifty-six do.
   * ZOOM_AT is spent verbatim and compared against `real` for that reason —
   * see the agreements at the top of this file. */
  const sql = `
    select ${PIN_COLUMNS}, ${weight} as kind
    from places p
    where p.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
      and ${ZOOM_AT} <= $7::real
      and p.confidence >= $5::real
      and ${weight} >= $6::double precision
    order by (${weight}) * p.confidence desc, p.id`
  const result = await db.query(sql, [
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
    floor,
    floorWeight,
    zoom,
  ])
  return result.rows.map(pinRow)
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

/* Which licences this deployment holds places under.
 *
 * A map draws one attribution line for the whole layer, which is how OSM data
 * is attributed on every map that carries it — and it is what the licence
 * actually asks for. This used to be asked per viewport, by handing the ids of
 * the places in view to `select distinct license from place_sources`: three
 * hundred pins each carrying their own provenance is a join of three hundred
 * rows to render one sentence, and it was most of a 119 ms viewport query.
 *
 * Then the cap went, because a zoom decides what is drawn and nothing
 * truncates it, and the same join became seventeen hundred uuids over Toronto
 * for a sentence that was never going to differ from Dublin's.
 *
 * So the licences are kept as they are written — see migration 053 and the
 * statement in the cell transaction that writes them — and this reads three
 * rows. The answer is a property of the layer, which is what the line on the
 * map has always claimed to be.
 *
 * Per-record provenance is still there, on `/api/places/:id`, which is where
 * somebody asking about one place gets it.
 */
const LICENSES_HELD_SQL = 'select license from place_licenses order by license'

export async function licensesHeld(db) {
  const result = await db.query(LICENSES_HELD_SQL)
  return result.rows.map(row => row.license).filter(Boolean)
}

/* The seed, for a planet that was loaded before the table existed.
 *
 * This is the scan the design exists to avoid, run once by the worker after a
 * release is live rather than on the read path or in a deploy. `on conflict do
 * nothing` so a second run is free, and the worker stops calling it once the
 * table has rows. */
export async function seedLicensesHeld(db) {
  const result = await db.query(
    `insert into place_licenses (license)
     select distinct license from place_sources
     where license is not null and license <> ''
     on conflict (license) do nothing`,
  )
  return result.rowCount || 0
}

/* ---- the index the map is served from ----------------------------------- */

/** The index every map query is written against, in one place.
 *
 * Built by the worker rather than by a migration, and built CONCURRENTLY,
 * because a GiST index over ten million places takes longer than a boot is
 * allowed to take — see migration 051, which used to hold this and cost five
 * releases in a row. CONCURRENTLY cannot run inside a transaction, so the
 * caller must not wrap it in one.
 *
 * `ZOOM_AT` without the alias, because an index has no table to alias and the
 * planner matches an expression index on its text. Spelling it from the same
 * constant the queries spend is what makes that certain. */
/* Named after the constant inside it, deliberately.
 *
 * The planner matches an expression index by its text, so the index and every
 * query that wants it have to spell ZOOM_AT identically. Nothing about that
 * fails loudly: an index built on the old spelling stays valid, stays in the
 * catalogue, and is simply never chosen — the map goes back to a sequential
 * scan over ten million rows and says nothing about why.
 *
 * So the name carries the number. Change ZOOM_AT's default and this is a
 * different index with a different name, which the worker finds missing and
 * builds, and the one it replaced is dropped by name below. There is no state
 * in which a stale index is mistaken for a current one. */
export const PLACE_VIEW_INDEX = `places_view_z${LABEL_ZOOMS.floor}_idx`
export const PLACE_VIEW_INDEX_SQL = `create index concurrently if not exists ${PLACE_VIEW_INDEX}
  on places using gist (geom, (${ZOOM_AT.replace(/\bp\./g, '')}))`

/** The indexes it replaces, dropped once it is built and valid — never
    before, so a build that fails cannot take the working index with it.
    `places_geom_idx` is the geometry-only original: measured, the two are
    indistinguishable on every other statement in this file — nearest-first
    50.7 ms against 50.1 ms — so keeping both is a gigabyte of disk and a
    second write on every ingested row to buy nothing. `places_view_idx` is
    the same index as this one built on the old default of 11, which is the
    one this replaces. */
export const PLACE_INDEXES_REPLACED = Object.freeze(['places_geom_idx', 'places_view_idx'])

/** Whether an index is there and usable. An index left behind by a failed
    CONCURRENTLY build exists but is `indisvalid = false`, and a query will
    not use it — so "there" has to mean valid, or the worker would look at a
    broken index and decide its work was done. */
export async function indexIsReady(db, name) {
  const { rows } = await db.query(
    `select i.indisvalid as valid
       from pg_class c join pg_index i on i.indexrelid = c.oid
      where c.relname = $1`,
    [name],
  )
  if (!rows.length) return null
  return Boolean(rows[0].valid)
}

/* ---- the zoom pass, a cell at a time ------------------------------------ */

/* Which cells still hold places placed under some other rule.
 *
 * The pass used to be one statement over every place in the world, and the
 * reason it is a queue now is that the statement never finished: a restart —
 * which is every deploy — threw the whole thing away and began again. A cell
 * is the unit of work because a cell is already the unit of ingest, so what
 * the backfill does to a cell is exactly what loading that cell would have
 * done to it, rather than a second and grander rule that only ever runs on a
 * box nobody redeploys.
 *
 * `ingesting` is the only status left out, and for a reason rather than for
 * tidiness: that cell is inside somebody else's transaction, which will place
 * it and stamp it on the way through. Every other status is fair game —
 * filtering on `ready` would leave a cell that failed halfway with rows on
 * the map and no zoom on them, which is exactly the state this exists for.
 *
 * Coverage is the queue because coverage is the only row that records which
 * rule a cell was placed under. Every place has one: the ingest writes the
 * places and the coverage row in the same transaction, which is asserted
 * next door in places-ingest.test.js.
 */
/* Two things about this query are the difference between a pass that walks
 * the planet and one that stops on its first bad batch.
 *
 * `except` is asked of the database rather than filtered afterwards. The
 * caller keeps the cells this run could not place, and it used to drop them
 * from the rows this returned — so when every cell in a batch failed, the
 * filter emptied the batch, the loop read that as "nothing left to do" and
 * ended. Nothing in the database had changed, so the next tick asked the same
 * question, got the same rows, filtered them all out and stopped again. A
 * handful of cells that will not place stood in front of the whole planet,
 * for ever, silently — which is the exact failure the skipping was written to
 * prevent.
 *
 * And the densest first — a premise that changed under this line twice in an
 * hour, so both turns are written down.
 *
 * It was `place_count desc`. Then the pass stalled and the ordering looked
 * like the cause: the densest cell on Earth was eighteen seconds of window
 * function, so twelve thousand cells that take milliseconds each queued
 * behind twenty-five that take minutes, and on a box redeployed every few
 * minutes the pass got through about one of them — Toronto. So it became
 * `place_count asc`, and the planet's sparse cells drained inside an hour.
 *
 * What that bought was a map empty in every city. Cheapest first is last for
 * anywhere a person looks: the live probe found Amsterdam, Edinburgh, Dublin
 * and Regina answering with no pins at all — including a street-level
 * Amsterdam box, where a cafe is drawn from zoom 14 and there are hundreds —
 * because those cells were still behind thirteen thousand others.
 *
 * And the eighteen seconds is gone. assignLabelZoom is a CASE and an
 * assignment now rather than six zooms of window function, so a dense cell is
 * an index scan. The cost that justified `asc` no longer exists, and what is
 * left is what was always true: the map is worth most where the places are.
 *
 * `priority` still leads, which is what keeps this honest: a cell somebody is
 * looking at right now is priority 0 and goes before any of the backfill,
 * however big it is. */
const CELLS_AWAITING_ZOOM_SQL = `
  select cell, west, south, east, north, place_count
  from place_coverage
  where coalesce(zoom_policy, -1) <> $1::smallint
    and status <> 'ingesting'
    and cell <> all($3::text[])
  order by priority asc, place_count desc, cell asc
  limit $2`

/**
 * @param {{query: Function}} db
 * @param {{policy: number, limit?: number, except?: string[]}} input
 * @returns {Promise<{cell: string, west: number, south: number, east: number,
 *                    north: number, places: number}[]>}
 */
export async function cellsAwaitingZoom(db, { policy, limit = 25, except = [] }) {
  const { rows } = await db.query(CELLS_AWAITING_ZOOM_SQL, [policy, limit, [...except]])
  return rows.map(row => ({
    cell: row.cell,
    west: Number(row.west),
    south: Number(row.south),
    east: Number(row.east),
    north: Number(row.north),
    places: Number(row.place_count),
  }))
}

/** This cell's places are placed under this rule. Written in the same
    transaction as the placing, so a crash leaves the cell looking undone. */
export async function markZoomed(db, cells, policy) {
  const wanted = [...new Set(cells || [])].filter(Boolean)
  if (!wanted.length) return 0
  const result = await db.query(
    'update place_coverage set zoom_policy = $2::smallint where cell = any($1::text[])',
    [wanted, policy],
  )
  return result.rowCount ?? 0
}

/* A cell with nothing in it is placed the moment it is empty: there is no row
   to give a zoom to. One statement for all of them, because forty thousand
   cells of ocean are not forty thousand units of work. */
export async function markEmptyCellsZoomed(db, policy) {
  const result = await db.query(
    `update place_coverage set zoom_policy = $1::smallint
      where coalesce(zoom_policy, -1) <> $1::smallint and place_count = 0`,
    [policy],
  )
  return result.rowCount ?? 0
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
   what kind of place it is: places/rank.js EARLIEST_ZOOM and store.js
   assignLabelZoom. A tile asks for everything at its zoom and
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
             ${ZOOM_AT} as minzoom,
             round((${rank}) * 1000)::int as rank,
             p.geom::geometry as geom
      from places p, bounds b
      where p.geom && ST_Transform(b.box, 4326)::geography
        and p.confidence >= $4::real
        -- No limit, and that is the whole design rather than an oversight.
        -- label_zoom was chosen so that each square of each zoom holds about
        -- the zoom its kind earns (see assignLabelZoom); capping here on top of
        -- that is what used to make a mark visible at one zoom and gone at
        -- the next, because the cap fell differently on each square.
        -- A row from before the zoom pass has none yet, and it is drawn from
        -- the first zoom rather than the last. The floor was tried and is
        -- exactly wrong: every row is null the moment the column is added,
        -- so a deploy would have emptied the map everywhere but the pavement
        -- until a pass that takes an hour had run. Visible until it is
        -- placed is never worse than what came before; invisible until it is
        -- placed is an outage. The worker fills these in cell by cell.
        -- Against real, and the expression written exactly as the index
        -- has it. A ::double precision cast was here and it was not a
        -- detail: comparing a real column against a double widens the
        -- column, the index condition is lost, and a z11 tile over Paris
        -- went from 1.5 ms to 155 ms, reading eighty thousand rows to
        -- encode two thousand. (No backticks in here: the whole statement
        -- is a template literal and one of them would end the string.)
        and ${ZOOM_AT} <= $1::real
    )
    select coalesce(ST_AsMVT(tile, 'places', 4096, 'geom'), ''::bytea) as tile
    from (
      select id::text as id, n, k, minzoom, rank,
             ST_AsMVTGeom(ST_Transform(geom, 3857), b.box, 4096, ${TILE_BUFFER}, true) as geom
      from picked, bounds b
    ) as tile
    where tile.geom is not null`
  const result = await db.query(sql, [z, x, y, floor])
  return result.rows[0]?.tile ?? Buffer.alloc(0)
}

/* The slippy tile a point falls in, as SQL rather than as JavaScript.
 *
 * The same arithmetic as places/tiles.js tileX and tileY, which is why the
 * two are tested against each other: a sign error here silently ranks places
 * against the wrong neighbours, which looks like nothing at all until a city
 * is bare and a field is crowded. */
/**
 * Give every place the zoom its kind appears from.
 *
 * One lookup per row and nothing else: a museum is drawn from 11, a café from
 * 14, a launderette from 16, and that is true in Amsterdam and in Regina and
 * on Skye. The table is EARLIEST_ZOOM in rank.js and it is the whole rule.
 *
 * It used to be a ranking. For each zoom that thins, the places in each
 * square were put in order of what they are worth and the best
 * two dozen of them earned that zoom; everything else fell through to
 * the next. That is what a tiler does and it reads well on a screen, and it
 * had a property nobody wanted: a place's zoom depended on its neighbours. An
 * identical museum appeared at 12 in Regina and 15 in Amsterdam, and "the
 * zoom decides what is drawn" was not true — the crowd decided, and the zoom
 * only decided how big the crowd was allowed to be.
 *
 * So the quota is gone. At a zoom you get every place whose kind belongs
 * there, however many that is, which is the thing a person means when they
 * zoom in. Nothing downstream caps it either: the viewport query has no
 * limit, because the zoom a viewport derives from its own width already
 * bounds what can match.
 *
 * What is kept is the part that was load-bearing: one number per row, and a
 * tile is `label_zoom <= z`, so a mark that has appeared cannot disappear as
 * you zoom further in. Monotonic by construction, as before.
 *
 * And it is now a plain UPDATE rather than six zooms of window function over
 * every row in the region. The densest degree on Earth was measured at 18.2
 * seconds under the old rule, which is why the backfill never finished; this
 * is an index scan and an assignment. `is distinct from` so a re-run over a
 * region that is already right writes nothing at all.
 *
 * One function, called two ways: the ingest with a cell's bounds inside the
 * cell's own transaction, the backfill with the same. There are no seams to
 * get wrong any more, because no row's answer depends on any other row's.
 *
 * @param {{west,south,east,north}|null} bounds  null for the whole world
 * @param {{earliest: Record<string, number>, floor: number}} options
 * @returns {Promise<number>} rows whose zoom changed
 */
export async function assignLabelZoom(db, bounds, { earliest, floor }) {
  const ceilings = Object.entries(earliest || {})
  if (!ceilings.length) throw new Error('places: a zoom pass needs the category ceilings')
  for (const [category, zoom] of ceilings) {
    if (!/^[a-z]+$/.test(category)) throw new Error(`places: not a category: ${category}`)
    if (!Number.isInteger(zoom)) throw new Error(`places: not a zoom: ${category}=${zoom}`)
  }
  if (!Number.isInteger(floor)) throw new Error('places: a zoom pass needs the floor zoom')
  /* Composed, and checked above, exactly as placeTile composes the same
     table: these are the only statements in this file that are not entirely
     parameters. The values are our own twenty category names, never user
     text. */
  const at = `case p.category ${ceilings
    .map(([category, zoom]) => `when '${category}' then ${Number(zoom)}`)
    .join(' ')} else ${Number(earliest.other ?? floor)} end`

  /* No bounds means everywhere, and everywhere is not an envelope.
   *
   * The planet pass was written first as an envelope of the whole world cast
   * to geography, which matches nothing at all: a geography bounding box
   * wraps, so one spanning -180 to 180 degenerates rather than covering
   * everything. Measured, on two million rows: the world envelope matched
   * zero and a one-degree box matched 174,634. It is not a predicate that
   * needs widening; it is a predicate that should not be there. */
  const within = bounds ? 'p.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography' : 'true'
  const corners = bounds ? [bounds.west, bounds.south, bounds.east, bounds.north] : []
  const result = await db.query(
    `update places p set label_zoom = (${at})::real
      where ${within} and label_zoom is distinct from (${at})::real`,
    corners,
  )
  return result.rowCount ?? 0
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
export async function clearPlaceTiles(db, bounds, { zooms = KEPT_ZOOMS } = {}) {
  /* By the primary key, which is exactly what (z, x, y) is.
   *
   * It used to be `ST_Transform(ST_TileEnvelope(t.z, t.x, t.y), 4326) && box`,
   * which is a projection and an overlap computed per row — no index can
   * serve it, so every call read the whole tile table. One call per ingested
   * cell was already the wrong shape; the zoom backfill calls it once per
   * cell for eleven thousand cells, which would have been the table scanned
   * eleven thousand times.
   *
   * The same tiles, named rather than tested: at each zoom the box covers one
   * contiguous block of the grid, and its corners are arithmetic — see
   * tiles.js tileRange, which tilesForBounds is now written in terms of, so
   * the two cannot disagree about which squares a box covers. */
  const ranges = zooms.map(z => tileRange(bounds, z))
  const result = await db.query(
    `delete from place_tiles t
     using unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::int[])
       as r(z, x0, x1, y0, y1)
     where t.z = r.z and t.x between r.x0 and r.x1 and t.y between r.y0 and r.y1`,
    [
      ranges.map(range => range.z),
      ranges.map(range => range.x0),
      ranges.map(range => range.x1),
      ranges.map(range => range.y0),
      ranges.map(range => range.y1),
    ],
  )
  return result.rowCount ?? 0
}
