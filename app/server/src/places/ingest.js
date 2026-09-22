/* The road from a public bucket into `places`, one cell at a time.
 *
 * Everything this module does is in service of four promises, and every
 * awkward-looking decision below is one of them being kept:
 *
 * 1. A reader never sees half a cell. The rows, their provenance and the
 *    coverage row that says "ready" all commit together, so a query landing
 *    mid-ingest gets either the old cell or the new one and never the seven
 *    thousand rows that had arrived by then. That is why the load is a COPY
 *    into temp staging tables followed by one transaction, rather than a
 *    stream of upserts: upserts are visible as they land.
 *
 * 2. Running a cell twice changes nothing. The natural keys are Overture's
 *    GERS id in `places` and (source, upstream_id) in `place_sources`, and
 *    every write is an upsert on one of them. Re-running after a crash, or
 *    ingesting a cell that overlaps one already done, converges.
 *
 * 3. A stop's place reference never dangles. When upstream drops or merges a
 *    record, the place row goes but a row in `place_redirects` stays, and a
 *    stop pointing at the old id is moved to the successor before the delete
 *    rather than being quietly nulled by the foreign key.
 *
 * 4. A run that dies continues. Progress goes into `place_coverage.cursor`
 *    while the reads are happening and the status machine is
 *    pending → ingesting → ready | empty | failed, so `--resume` skips what is
 *    done and re-attempts what is not.
 *
 * Two things about the geometry that cost us an evening each.
 *
 * `cellBounds` is inclusive at both edges and `parquet.js inside()` tests
 * `>=` and `<=`, which is right for an arbitrary user query box and means a
 * place at exactly 5.0000 is read for N52E004 *and* for N52E005. Ingest two
 * adjacent cells and the second insert dies on `places_gers_id_key`. The fix
 * is not to loosen the constraint or narrow the box: it is that after
 * normalising, a cell keeps only the places whose own `cellKey()` is that
 * cell. Floor semantics put every point in exactly one cell, so the filter is
 * provably non-overlapping, and it has the second virtue of guaranteeing that
 * the `cell` column of a row agrees with the coverage row that produced it.
 *
 * And the merge is per cell, which means a pair of records for the same
 * shopfront straddling a cell edge — one at 4.9999, one at 5.0001 — stays two
 * records rather than one. That is two hundred metres of a hundred-and-eleven
 * kilometre edge, and the alternative is a load that has to lock two cells at
 * once. The price is named rather than hidden.
 *
 * On the orphan sweep: a cell that reads as empty when it previously held
 * eleven thousand places is far more likely to be a bad afternoon on the
 * network than a town that vanished, so the sweep refuses to run when a
 * cell's count collapses past RETAIN_RATIO, and the cell fails loudly instead.
 * Deleting a city because S3 hiccuped is not a mistake you get to make twice.
 */

import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { from as copyFrom } from 'pg-copy-streams'
import { cellBounds, cellKey, cellsForBounds, cellsForPoints, isCellKey } from './cells.js'
import { COLUMNS as FSQ_COLUMNS, placesFromFsq } from './fsq.js'
import {
  OSM_DATASETS,
  OSM_LICENSE,
  OVERTURE_LICENSE,
  COLUMNS as OVERTURE_COLUMNS,
  placesFromOverture,
} from './overture.js'
import { qualityReport } from './quality.js'
import { retryAfterMs } from './retry.js'
import { EARLIEST_ZOOM, LABEL_ZOOMS, MARKS_PER_TILE, VIEW_WEIGHT, ZOOM_POLICY } from './rank.js'
import { assignLabelZoom } from './store.js'
import { MATCH_METRES, bestMatch, mergeFields } from './resolve.js'

/** Which source wins a field when both have one, before confidence is
    considered. Overture first because its record is itself a merge with a
    measured confidence; Foursquare's is derived (see fsq.js). */
export const SOURCE_ORDER = Object.freeze(['overture', 'fsq', 'osm'])

/** What this pipeline produces, as a number that changes when the answer
 * does.
 *
 * `--resume` skips a cell that is already `ready`, which is right when the
 * only thing that has changed is how far the run got, and wrong every time
 * the ingest itself changes: the cells done before the change keep rows of
 * the old shape for ever, and nothing anywhere compares them. A planet half
 * ingested by one version and half by another is a database nobody can reason
 * about, and it is invisible — the coverage rows all say `ready`.
 *
 * So the generation is written into `place_coverage.versions` beside the
 * release versions, and a cell counts as done only when it was produced by
 * the generation now running. Bump it when the rows this pipeline writes stop
 * being the rows it used to write, and the next run re-ingests what it must,
 * once, by itself.
 *
 *   1  the original per-cell ingest
 *   2  a source row per upstream dataset rather than one per source, each
 *      under its own dataset's licence, and a label_zoom on every place
 */
export const PLACE_PIPELINE = 2

/** A cell whose new place count falls below this share of what it held is not
    loaded: the read is assumed broken rather than the world. */
export const RETAIN_RATIO = 0.5

/** How often the cursor is written while a cell is being read. Often enough
    that a crash loses seconds of context, rarely enough that a planet run is
    not an update storm on one row. */
export const CURSOR_EVERY_MS = 2000

/* Candidate buckets for the merge. 0.01° is about 1.1 km north-south and less
   east-west, so a 3×3 neighbourhood always contains everything within
   MATCH_METRES (200 m) and usually little else. Without it, matching ten
   thousand Foursquare rows against ten thousand Overture rows is a hundred
   million distance calculations per cell. */
const BUCKET_DEGREES = 0.01

const bucketKey = (lng, lat) =>
  `${Math.floor(lng / BUCKET_DEGREES)}:${Math.floor(lat / BUCKET_DEGREES)}`

function bucketIndex(places) {
  const buckets = new Map()
  for (const place of places) {
    const key = bucketKey(place.lng, place.lat)
    const held = buckets.get(key)
    if (held) held.push(place)
    else buckets.set(key, [place])
  }
  return buckets
}

function nearby(buckets, place) {
  const x = Math.floor(place.lng / BUCKET_DEGREES)
  const y = Math.floor(place.lat / BUCKET_DEGREES)
  const found = []
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const held = buckets.get(`${x + dx}:${y + dy}`)
      if (held) found.push(...held)
    }
  }
  return found
}

/**
 * The records of one cell, grouped into the places they describe.
 *
 * Deterministic: the base source is walked in upstream-id order and each
 * other record joins the best base it matches or stands alone, so the same
 * inputs always produce the same clusters whatever order the reader returned
 * them in.
 *
 * @param {object[]} base    the source that owns the canonical key (Overture)
 * @param {object[]} others  every other source's records for the same cell
 */
export function clusterPlaces(base, others) {
  const sorted = [...base].sort((a, b) => (a.upstreamId < b.upstreamId ? -1 : 1))
  const clusters = sorted.map(place => ({
    key: place.gersId || `${place.source}:${place.upstreamId}`,
    gersId: place.gersId || null,
    records: [place],
  }))
  const byBase = new Map(clusters.map(cluster => [cluster.records[0], cluster]))
  const buckets = bucketIndex(sorted)
  for (const place of [...others].sort((a, b) => (a.upstreamId < b.upstreamId ? -1 : 1))) {
    const candidates = nearby(buckets, place)
    const found = bestMatch(place, candidates)
    if (found) byBase.get(found.match)?.records.push(place)
    else {
      clusters.push({
        key: `${place.source}:${place.upstreamId}`,
        gersId: place.gersId || null,
        records: [place],
      })
    }
  }
  return clusters
}

/**
 * A cluster as the row that goes into `places` and the rows that go into
 * `place_sources`.
 *
 * The merged confidence is the highest of its sources', not an average: two
 * sources describing the same shopfront is corroboration, and averaging would
 * make a well-known café less certain the moment a second, thinner source
 * mentioned it. It is not raised above the best either — agreement is not
 * evidence we have measured.
 */
export function rowsFromCluster(cluster, cell) {
  const { merged, credit } = mergeFields(cluster.records, SOURCE_ORDER)
  const categorySource = Object.entries(credit).find(([, fields]) => fields.includes('category'))
  const fromCategory =
    cluster.records.find(record => record.source === categorySource?.[0]) || cluster.records[0]
  const place = {
    key: cluster.key,
    gersId: cluster.gersId,
    name: merged.name,
    alternateNames: merged.alternateNames || [],
    lng: merged.lng,
    lat: merged.lat,
    category: merged.category || 'other',
    categoryRaw: fromCategory?.categoryRaw ?? null,
    address: merged.address ?? null,
    website: merged.website ?? null,
    phone: merged.phone ?? null,
    hours: merged.hours ?? null,
    operating: merged.operating ?? null,
    confidence: Math.max(...cluster.records.map(record => Number(record.confidence) || 0)),
    cell,
  }
  /* One row per dataset that named this place, not one per source.
   *
   * Overture is itself a merge: a place it publishes carries a list of the
   * datasets that named it — meta, Foursquare, Microsoft, OpenStreetMap,
   * AllThePlaces — each with its own record id. We computed that list
   * (overture.js upstreamIds) and then wrote one row holding only the GERS
   * uuid, which threw away two things worth keeping. The licence trail, which
   * is an obligation rather than a nicety: it is the OSM-derived records that
   * oblige us under ODbL, and rolling every licence into one comma-joined
   * string on one row says which licences apply without saying to what. And
   * the one honest measure of prominence in open data that carries no
   * ratings: how many independent datasets bothered to name a place. Every
   * row in the database had exactly one source, measured, so that signal read
   * as a constant.
   *
   * A record with no dataset list — Foursquare's own release, a source that
   * does not publish one — keeps its single row, which is the same shape. */
  const sources = cluster.records.flatMap(record => {
    const licenses = record.licenses || []
    /* Only Overture expands, because only Overture is itself a merge. Every
       other source namespaces its ids with its own name — `fsq:...` — which
       is the same single record said twice, and rewriting a stored
       upstream_id is how a re-ingest stops recognising what it already has. */
    const held =
      record.source === 'overture' && record.upstreamIds?.length
        ? record.upstreamIds
        : [record.upstreamId]
    const common = {
      key: cluster.key,
      source: record.source,
      version: record.version,
      confidence: Number(record.confidence) || 0,
      fields: credit[record.source] || [],
    }
    return held.map(upstreamId => ({
      ...common,
      upstreamId,
      /* The licence this dataset's contribution carries, rather than every
         licence the place carries. An OSM-derived row is the one that obliges
         us under ODbL, and now it is the row that says so. */
      license: licenseFor(record.source, upstreamId, licenses),
    }))
  })
  return { place, sources }
}

/** Which licence one upstream record is under.
 *
 * Only Overture's records are decided by their dataset, and getting that
 * wrong is how a licence notice becomes a lie. Overture is a merge and names
 * the dataset each of its records came from, so `openstreetmap:n123` obliges
 * us under ODbL and everything else it publishes is CDLA Permissive. Every
 * other source prefixes its ids with its own name — `fsq:...` — and that
 * prefix says nothing about a licence; Foursquare's open release is Apache,
 * whatever its ids look like. So for anybody but Overture the record's own
 * licences stand, exactly as they did before.
 *
 * @param {string} source      which of our sources this record came from
 * @param {string} upstreamId  `dataset:record`
 * @param {string[]} licenses  what the record itself said
 */
export function licenseFor(source, upstreamId, licenses = []) {
  const held = (licenses || []).join(', ') || 'unknown'
  if (source !== 'overture') return held
  const id = String(upstreamId ?? '')
  if (!id.includes(':')) return held
  return OSM_DATASETS.test(id.split(':')[0]) ? OSM_LICENSE : OVERTURE_LICENSE
}

/* ---- COPY encoding ----------------------------------------------------
   CSV rather than the text format because the escaping rules are shorter and
   an unquoted empty field is exactly NULL, which is what an absent website
   is. Every value is quoted, so an empty string stays an empty string and a
   name containing a comma, a quote or a newline survives.

   The array columns do not travel as array literals. A Postgres array literal
   inside a COPY stream needs two levels of escaping — the array parser's
   (backslash and quote inside each element) and then the copy format's on top
   — and getting either level wrong is invisible until real data arrives: a
   Roman library named `Biblioteca "Gen. C.A. Michele Mola" della Scuola` took
   down a twenty-four cell load at arrayfuncs.c:669, a thousand rows into a
   COPY. So `alternate_names` and `fields` cross as JSON, which needs only the
   ordinary text escaping that `csv` already does, and become text[] in the
   INSERT below via jsonb_array_elements_text. Malformed JSON then fails the
   statement loudly instead of quietly producing a different array. */

/* Two characters Postgres will not hold, whatever we do with quoting.
 *
 * U+0000 is not a legal byte in a UTF-8 text column at all, and JSON.stringify
 * writes it as the escape `\u0000`, which jsonb refuses with "unsupported
 * Unicode escape sequence". A lone surrogate — half of a pair, which does
 * happen in open data that has been round-tripped through a bad encoder — is
 * silently replaced in a text column and rejected outright in jsonb.
 *
 * Either one aborts the COPY, and a COPY is one cell: a single bad byte in a
 * single name would lose the whole of Rome, permanently, since the failure is
 * deterministic and every retry hits the same row. This is the same shape of
 * bug as the array literal that lost a twenty-four-cell load, and the answer
 * is the same: fix it at the one place every value passes through, not at the
 * twenty places values are made.
 *
 * Stripped rather than refused, because the alternative to a name with a NUL
 * in it is no name at all. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
const clean = value => String(value).replaceAll('\u0000', '').replace(LONE_SURROGATE, '\uFFFD')

/** The same, through a structure, before it is stringified into jsonb. */
const scrub = value => {
  if (typeof value === 'string') return clean(value)
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, held]) => [clean(key), scrub(held)]))
  }
  return value
}

const csv = value =>
  value === null || value === undefined ? '' : `"${clean(value).replaceAll('"', '""')}"`

const json = value =>
  value === null || value === undefined ? '' : csv(JSON.stringify(scrub(value)))

const placeLine = place =>
  [
    csv(place.key),
    csv(place.gersId),
    csv(place.name),
    json(place.alternateNames || []),
    csv(place.lng),
    csv(place.lat),
    csv(place.category),
    csv(place.categoryRaw),
    json(place.address),
    csv(place.website),
    csv(place.phone),
    json(place.hours),
    csv(place.confidence),
    csv(place.operating),
    csv(place.cell),
  ].join(',') + '\n'

const sourceLine = source =>
  [
    csv(source.key),
    csv(source.source),
    csv(source.license),
    csv(source.upstreamId),
    csv(source.version),
    csv(source.confidence),
    json(source.fields || []),
  ].join(',') + '\n'

async function copyInto(client, sql, lines) {
  const stream = client.query(copyFrom(sql))
  await pipeline(Readable.from(lines), stream)
}

const STAGE = `
  create temp table stage_places (
    key text primary key, gers_id text, name text not null,
    alternate_names jsonb not null, lng double precision not null,
    lat double precision not null, category text not null, category_raw text,
    address jsonb, website text, phone text, hours jsonb,
    confidence real not null, operating text, cell text not null
  ) on commit drop;
  create temp table stage_sources (
    key text not null, source text not null, license text not null,
    upstream_id text not null, version text not null, confidence real,
    fields jsonb not null
  ) on commit drop;
  create temp table stage_keys (
    key text primary key, gers_id text, place_id uuid, by_gers boolean not null default false
  ) on commit drop;
  create temp table stage_orphans (id uuid primary key, new_id uuid) on commit drop;`

/* Resolving every staged row to the id of the place it is. Three passes, in
   this order and no other:
     by GERS id     — the canonical key, and the only one that is unique
     by upstream id — how a place only Foursquare knows is recognised again
     a fresh uuid   — genuinely new
   The de-duplication in the middle exists because a re-clustering can send
   two staged rows at one existing place; the row that owns it by GERS id
   keeps it, because that id is a unique constraint and cannot be moved
   anywhere else, and the other takes a new id. */
const RESOLVE = `
  insert into stage_keys (key, gers_id) select key, gers_id from stage_places;

  update stage_keys k set place_id = p.id, by_gers = true
    from places p where k.gers_id is not null and p.gers_id = k.gers_id;

  update stage_keys k set place_id = m.place_id from (
    select ss.key, min(ps.place_id::text)::uuid as place_id
    from stage_sources ss
    join place_sources ps on ps.source = ss.source and ps.upstream_id = ss.upstream_id
    group by ss.key
  ) m where m.key = k.key and k.place_id is null;

  update stage_keys k set place_id = null
  from (
    select key, row_number() over (
      partition by place_id order by (not by_gers), (gers_id is null), key
    ) as rank
    from stage_keys where place_id is not null
  ) r where r.key = k.key and r.rank > 1;

  update stage_keys set place_id = gen_random_uuid() where place_id is null;`

const UPSERT_PLACES = `
  insert into places (
    id, gers_id, name, alternate_names, geom, category, category_raw,
    address, website, phone, hours, confidence, operating, cell,
    first_seen, last_refreshed)
  select k.place_id, sp.gers_id, sp.name,
         coalesce(array(select jsonb_array_elements_text(sp.alternate_names)), '{}'),
         st_setsrid(st_makepoint(sp.lng, sp.lat), 4326)::geography,
         sp.category, sp.category_raw, sp.address, sp.website, sp.phone, sp.hours,
         sp.confidence, sp.operating, sp.cell, now(), now()
  from stage_places sp join stage_keys k on k.key = sp.key
  on conflict (id) do update set
    gers_id = excluded.gers_id, name = excluded.name,
    alternate_names = excluded.alternate_names, geom = excluded.geom,
    category = excluded.category, category_raw = excluded.category_raw,
    address = excluded.address, website = excluded.website, phone = excluded.phone,
    hours = excluded.hours, confidence = excluded.confidence,
    operating = excluded.operating, cell = excluded.cell, last_refreshed = now()`

const UPSERT_SOURCES = `
  insert into place_sources (
    place_id, source, license, upstream_id, version, confidence, fields, recorded_at)
  select k.place_id, ss.source, ss.license, ss.upstream_id, ss.version, ss.confidence,
         coalesce(array(select jsonb_array_elements_text(ss.fields)), '{}'), now()
  from stage_sources ss join stage_keys k on k.key = ss.key
  on conflict (place_id, source, upstream_id) do update set
    license = excluded.license, version = excluded.version,
    confidence = excluded.confidence, fields = excluded.fields, recorded_at = now()`

/**
 * An ingest bound to a database and a pair of releases.
 *
 * @param {object} options
 * @param {import('pg').Pool} options.pool
 * @param {{readBox: Function}} options.reader        from places/parquet.js
 * @param {{overture?: {version: string, index: object}, fsq?: {version: string, index: object}}} options.releases
 * @param {(line: string, detail?: object) => void} [options.log]
 * @param {() => Date} [options.now]
 * @param {boolean} [options.dryRun]
 * @param {number} [options.concurrency]
 */
export function createIngest({
  pool,
  reader,
  releases,
  log = () => {},
  now = () => new Date(),
  dryRun = false,
  concurrency = 1,
}) {
  const sources = ['overture', 'fsq'].filter(source => releases?.[source]?.index)
  if (!sources.length) throw new Error('places: an ingest needs at least one release with an index')
  const versions = {
    ...Object.fromEntries(sources.map(source => [source, releases[source].version])),
    /* Which ingest wrote these rows, not only which release they came from. */
    pipeline: PLACE_PIPELINE,
  }
  const controller = new AbortController()
  /* The cursor is written from inside `onGroup`, which the reader calls
     synchronously and cannot await. Keeping the promise means the failure
     path can wait for the last write to land before it records the failure —
     otherwise "where it died" is a race with dying. */
  let cursorWrite = Promise.resolve()

  const columnsFor = source => (source === 'overture' ? OVERTURE_COLUMNS : FSQ_COLUMNS)
  const normalise = (source, rows, release) =>
    source === 'overture' ? placesFromOverture(rows, release) : placesFromFsq(rows, release)

  /** The cursor, written while a cell is being read so a crash leaves a note
      about where it was rather than only that it was somewhere. */
  async function writeCursor(cell, cursor) {
    if (dryRun) return
    await pool
      .query(
        /* `started_at` moves with the cursor, so it is a heartbeat and not
           just a start time. The drain reclaims a cell whose `started_at` is
           old — see places/worker.js — and without this a dense cell that
           honestly takes longer than that would be reclaimed out from under a
           run that was working perfectly well, and the two would then race to
           insert the same gers_id. */
        'update place_coverage set cursor = $2, started_at = now() where cell = $1',
        [cell, cursor],
      )
      .catch(error => log(`places: cursor for ${cell} not written: ${error.message}`))
  }

  async function readSource(source, cell, bounds) {
    const release = releases[source]
    let groups = 0
    let rows = 0
    let wroteAt = 0
    const read = await reader.readBox(release.index, bounds, columnsFor(source), {
      signal: controller.signal,
      onGroup: count => {
        groups += 1
        rows += count
        const at = Date.now()
        if (at - wroteAt < CURSOR_EVERY_MS) return
        wroteAt = at
        cursorWrite = writeCursor(cell, {
          phase: 'read',
          source,
          groups,
          rows,
          at: now().toISOString(),
        })
      },
    })
    const normalised = normalise(source, read, release)
    /* The edge filter. See the header: inclusive bounds put a place sitting
       exactly on a meridian into both neighbouring cells, and cellKey's floor
       semantics put it into exactly one. */
    const mine = normalised.places.filter(place => place.cell === cell)
    return { places: mine, read: read.length, skipped: normalised.skipped, groups, rows }
  }

  /** Defensive de-duplication before the COPY: two rows with one GERS id
      cannot both be inserted, and the failure would be a constraint violation
      halfway through a transaction rather than a number in a log. The keeper
      is the most confident, ties by key, so it is the same one every run. */
  function dedupe(rows) {
    const byKey = new Map()
    let dropped = 0
    for (const row of rows) {
      const held = byKey.get(row.place.key)
      if (!held) {
        byKey.set(row.place.key, row)
        continue
      }
      dropped += 1
      if (
        row.place.confidence > held.place.confidence ||
        (row.place.confidence === held.place.confidence &&
          row.sources[0]?.upstreamId < held.sources[0]?.upstreamId)
      ) {
        byKey.set(row.place.key, row)
      }
    }
    return { rows: [...byKey.values()], dropped }
  }

  async function markStarted(cell, bounds) {
    if (dryRun) return
    await pool.query(
      `insert into place_coverage (cell, west, south, east, north, status, requested_at, started_at, attempts)
       values ($1, $2, $3, $4, $5, 'ingesting', now(), now(), 1)
       on conflict (cell) do update set
         status = 'ingesting', started_at = now(),
         attempts = place_coverage.attempts + 1, error = null`,
      [cell, bounds.west, bounds.south, bounds.east, bounds.north],
    )
  }

  /** How many times in a row this cell has failed, the increment for this
      attempt included — markStarted made it before the read began. */
  async function attemptsFor(cell) {
    const { rows } = await pool
      .query('select attempts from place_coverage where cell = $1', [cell])
      .catch(() => ({ rows: [] }))
    return Number(rows[0]?.attempts ?? 1)
  }

  async function markFailed(cell, error) {
    if (dryRun) return
    await pool
      .query(
        /* The cursor is deliberately left as it is: it is the note about where
           this attempt got to, and it is what `--resume` reports.

           `next_attempt_at` is when the drain may take this cell again, and
           writing it here rather than in the drain is deliberate: the row
           itself carries when it is next due, so a cell is never eligible
           merely because nobody has looked at it recently. The schedule grows
           with the consecutive-failure count that markStarted has already
           incremented, and the last step repeats, so a cell is put off but
           never abandoned. */
        `update place_coverage
            set status = 'failed', error = $2,
                next_attempt_at = now() + make_interval(secs => $3::double precision)
          where cell = $1`,
        [
          cell,
          String(error?.message || error).slice(0, 500),
          retryAfterMs(await attemptsFor(cell)) / 1000,
        ],
      )
      /* Said, not swallowed: a cell left `ingesting` with no error on it is a
         cell only the thirty-minute reaper will ever move, and an operator
         reading the log needs to know the note was not written. */
      .catch(problem => log(`places: ${cell} could not be marked failed: ${problem.message}`))
  }

  /**
   * One cell's rows, in one transaction.
   *
   * Everything a reader could notice — the places, their sources, the
   * redirects, the coverage row — moves between BEGIN and COMMIT. That is
   * promise 1 in the header, and it is why the staging tables are temp tables
   * inside this same transaction rather than a real table loaded first.
   */
  async function loadCell(cell, rows, report) {
    const client = await pool.connect()
    const loaded = { inserted: 0, redirected: 0, swept: false, tilesSwept: 0, marked: 0 }
    try {
      await client.query('begin')
      await client.query(STAGE)
      await copyInto(
        client,
        `copy stage_places (key, gers_id, name, alternate_names, lng, lat, category,
           category_raw, address, website, phone, hours, confidence, operating, cell)
         from stdin with (format csv)`,
        rows.map(row => placeLine(row.place)),
      )
      await copyInto(
        client,
        `copy stage_sources (key, source, license, upstream_id, version, confidence, fields)
         from stdin with (format csv)`,
        rows.flatMap(row => row.sources.map(sourceLine)),
      )
      await client.query(RESOLVE)

      /* What the cell held before this run, for the collapse guard below. */
      const held = await client.query('select count(*)::int as count from places where cell = $1', [
        cell,
      ])
      const before = held.rows[0].count
      /* The collapse guard, and it refuses rather than half-loads.
       *
       * A read that comes back with a fraction of what the cell held is a
       * truncated read, not a cell that emptied: upstream does not delete
       * ninety per cent of Amsterdam between releases. Sweeping on that would
       * delete everything the read missed.
       *
       * The guard used to only skip the sweep, and only throw when the read
       * returned literally nothing. So a read that returned three thousand of
       * eleven thousand places carried on: it upserted its three thousand,
       * left the other eight thousand stale beside them, and then wrote the
       * coverage row `ready` at the current release with a place_count
       * counted from the table rather than from the read. Stale for ever —
       * `isStale` is false, the refresh sweep skips it, `--resume` skips it,
       * and nothing anywhere compares the count to what was read. Silence is
       * the one thing this must not do, so it throws, the transaction rolls
       * back, and the cell is marked `failed` with this sentence on the row. */
      if (before > 0 && rows.length < before * RETAIN_RATIO) {
        throw new Error(
          `read returned ${rows.length} place(s) for ${cell}, which holds ${before}; ` +
            `that is below ${Math.round(RETAIN_RATIO * 100)}% and reads as a truncated read, ` +
            `not a cell that emptied — refusing to load it`,
        )
      }
      await client.query(
        `insert into stage_orphans (id)
           select p.id from places p
           where p.cell = $1 and not exists (select 1 from stage_keys k where k.place_id = p.id)`,
        [cell],
      )
      /* Where an orphan's upstream records now live, worked out before any
           place_sources row is moved, because moving them is what would hide
           the answer. */
      await client.query(`
          update stage_orphans o set new_id = m.place_id from (
            select distinct on (ps.place_id) ps.place_id as old_id, k.place_id
            from place_sources ps
            join stage_sources ss on ss.source = ps.source and ss.upstream_id = ps.upstream_id
            join stage_keys k on k.key = ss.key
            where ps.place_id <> k.place_id
            order by ps.place_id, k.place_id
          ) m where m.old_id = o.id`)

      await client.query(UPSERT_PLACES)
      /* A source record that has moved to another place must not describe two.
         Deleted first so the upsert below cannot collide with its own past. */
      await client.query(`
        delete from place_sources ps using stage_sources ss, stage_keys k
        where ss.key = k.key and ps.source = ss.source
          and ps.upstream_id = ss.upstream_id and ps.place_id <> k.place_id`)
      await client.query(UPSERT_SOURCES)
      /* The attribution line for the whole layer, written where the licences
         themselves are. Three values in the life of this layer, so this is a
         no-op on all but the first cell of a release — and it is the reason
         the map does not ask `select distinct license` over every source row
         it holds to print one sentence. See migration 053. */
      await client.query(
        `insert into place_licenses (license)
         select distinct license from stage_sources
         where license is not null and license <> ''
         on conflict (license) do nothing`,
      )
      /* A source that no longer describes a place we just loaded — only for
         the sources this run actually read, so a run without Foursquare does
         not throw away what Foursquare said last month. */
      await client.query(
        `delete from place_sources ps using stage_keys k
         where ps.place_id = k.place_id and ps.source = any($1::text[])
           and not exists (
             select 1 from stage_sources ss
             where ss.key = k.key and ss.source = ps.source and ss.upstream_id = ps.upstream_id)`,
        [sources],
      )

      {
        const redirected = await client.query(`
          insert into place_redirects (old_id, new_id, reason, at)
          select o.id, o.new_id, case when o.new_id is null then 'gone' else 'merged' end, now()
          from stage_orphans o
          on conflict (old_id) do update set
            new_id = excluded.new_id, reason = excluded.reason, at = now()
          returning old_id`)
        loaded.redirected = redirected.rowCount || 0
        /* An older redirect pointing at a place that is going away follows it
           to its successor, so a chain stays walkable instead of being
           cascaded out of existence by the delete below. */
        await client.query(`
          update place_redirects r set
            new_id = o.new_id,
            reason = case when o.new_id is null then 'gone' else 'merged' end, at = now()
          from stage_orphans o where r.new_id = o.id`)
        /* The stop moves with the place. The foreign key would null it, which
           is safe but loses an itinerary entry that upstream only renamed. */
        await client.query(`
          update stops s set place_id = o.new_id
          from stage_orphans o where s.place_id = o.id and o.new_id is not null`)
        await client.query('delete from places p using stage_orphans o where p.id = o.id')
      }

      const counted = await client.query(
        'select count(*)::int as count from places where cell = $1',
        [cell],
      )
      loaded.inserted = counted.rows[0].count
      /* Always, now that a read which did not sweep is a read that threw. The
         field stays so the report and its tests keep their shape. */
      loaded.swept = true
      const bounds = cellBounds(cell)
      /* Which of these places earn a mark, and from how far away.
       *
       * Inside the transaction and before the tiles are dropped, because the
       * two belong together: a cell whose places are committed without their
       * zooms is a cell of rows no tile will draw, and a tile rebuilt from a
       * cell whose zooms are half-written would be built from a moment that
       * never existed.
       *
       * Ranked within this cell, which is a little generous at the seams — a
       * square straddling two cells is ranked against the half we hold. The
       * planet pass (places-ingest.mjs --rezoom) does the same arithmetic
       * over the whole world and is the authority; this is what keeps a cell
       * from being invisible in the meantime. */
      loaded.marked = await assignLabelZoom(client, bounds, {
        earliest: EARLIEST_ZOOM,
        weights: VIEW_WEIGHT,
        perTile: MARKS_PER_TILE,
        zooms: LABEL_ZOOMS,
      })
      /* The tiles over this ground are now describing a city that has
       * changed, so they go — inside the same transaction as the places they
       * were built from, because a tile surviving a rollback would be a tile
       * of rows that were never committed.
       *
       * This is the whole of what keeps "a tile is built once" from becoming
       * "a tile is wrong for ever". They rebuild on the next request for
       * each, which for the squares anybody is actually looking at is the
       * next time they look.
       *
       * Counted rather than assumed: a sweep that quietly matches nothing is
       * indistinguishable from a sweep that worked, right up until somebody
       * asks why the map still shows last month. */
      const sweptTiles = await client
        .query(
          `delete from place_tiles t
           using (select ST_MakeEnvelope($1, $2, $3, $4, 4326) as box) c
           where ST_Transform(ST_TileEnvelope(t.z, t.x, t.y), 4326) && c.box`,
          [bounds.west, bounds.south, bounds.east, bounds.north],
        )
        .catch(problem => {
          /* Before migration 044 there is no such table, and an ingest that
             refuses to load a city because it cannot drop a cache it does not
             have is worse than a stale tile. */
          log(`places: ${cell} tiles not swept — ${problem.message}`)
          return { rowCount: 0 }
        })
      loaded.tilesSwept = sweptTiles.rowCount ?? 0
      await client.query(
        `insert into place_coverage (
           cell, west, south, east, north, status, versions, place_count, quality,
           cursor, requested_at, started_at, last_refresh, attempts, error, zoom_policy)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, null, now(), now(), now(), 0,
                 null, $10::smallint)
         on conflict (cell) do update set
           status = excluded.status, versions = excluded.versions,
           /* This cell's places were just given their zooms, two statements
              up and inside this same transaction, so the rule they were given
              under is known here and nowhere else. Without it the backfill
              would queue every cell the sweep loads and place it a second
              time for nothing. */
           zoom_policy = excluded.zoom_policy,
           place_count = excluded.place_count, quality = excluded.quality,
           /* Attempts go back to zero. The column counts consecutive failures
              and is what the drain backs off on, so leaving it to climb across
              a year of monthly refreshes put every cell past the cap: the
              first time one then failed, the worker abandoned it for good. */
           attempts = 0,
           /* And nothing is owed: a cell that has just been read is not
              waiting on a backoff from the last time it did not. */
           next_attempt_at = null,
           cursor = null, last_refresh = now(), error = null`,
        [
          cell,
          bounds.west,
          bounds.south,
          bounds.east,
          bounds.north,
          loaded.inserted > 0 ? 'ready' : 'empty',
          JSON.stringify(versions),
          loaded.inserted,
          JSON.stringify(report),
          ZOOM_POLICY,
        ],
      )
      await client.query('commit')
      return loaded
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * One cell, from records already read to a committed transaction.
   *
   * Two things arrive here and only one of them is a query. The cell path
   * asks the bucket for a square's worth of rows. The sweep reads the release
   * once and posts every row into the square it falls in, so by the time a
   * square gets here its records were gathered from the same groups that
   * served its neighbours (see sweep.js). Both then want exactly the same
   * thing — cluster, de-duplicate, count, and write it in one transaction
   * with the collapse guard, the orphan redirects, the coverage row and the
   * tile sweep — which is why that is written here once rather than twice
   * with a drift between them nobody notices for a month.
   *
   * @param {string} cell
   * @param {() => Promise<Record<string, {places: object[], read: number,
   *          skipped?: number, groups?: number}>>} gather
   */
  async function finishCell(cell, gather) {
    if (!isCellKey(cell)) throw new Error(`places: not a cell key: ${cell}`)
    const started = Date.now()
    const bounds = cellBounds(cell)
    await markStarted(cell, bounds)
    try {
      const read = await gather()
      /* The sources this cell actually has records from, which is not always
         every source the ingest was built with: a sweep reads one. */
      const named = sources.filter(source => read[source])
      const base = read.overture?.places || []
      const others = named
        .filter(source => source !== 'overture')
        .flatMap(source => read[source].places)
      const clusters = clusterPlaces(base, others)
      const { rows, dropped } = dedupe(clusters.map(cluster => rowsFromCluster(cluster, cell)))
      const report = qualityReport(rows.map(row => row.place))
      await writeCursor(cell, { phase: 'load', places: rows.length, at: now().toISOString() })
      const loaded = dryRun
        ? { inserted: rows.length, redirected: 0, swept: false }
        : await loadCell(cell, rows, report)
      const outcome = {
        cell,
        status: loaded.inserted > 0 ? 'ready' : 'empty',
        places: loaded.inserted,
        merged: rows.length ? base.length + others.length - rows.length : 0,
        dropped,
        redirected: loaded.redirected,
        swept: loaded.swept,
        read: Object.fromEntries(named.map(source => [source, read[source].read])),
        groups: named.reduce((total, source) => total + (read[source].groups || 0), 0),
        ms: Date.now() - started,
        quality: report,
      }
      log(
        `${cell} ${outcome.status} ${outcome.places} places (${named
          .map(source => `${source} ${read[source].read}`)
          .join(', ')}, merged ${outcome.merged}) in ${(outcome.ms / 1000).toFixed(1)}s`,
        outcome,
      )
      return outcome
    } catch (error) {
      await cursorWrite.catch(() => {})
      await markFailed(cell, error)
      log(`${cell} failed: ${error.message}`)
      return {
        cell,
        status: 'failed',
        places: 0,
        error: String(error.message || error),
        ms: Date.now() - started,
      }
    }
  }

  /**
   * One cell, end to end: read it from the bucket, then write it.
   * @param {string} cell
   */
  async function ingestCell(cell) {
    if (!isCellKey(cell)) throw new Error(`places: not a cell key: ${cell}`)
    const bounds = cellBounds(cell)
    return finishCell(cell, async () => {
      const read = {}
      for (const source of sources) {
        if (controller.signal.aborted) throw new Error('places: ingest interrupted')
        read[source] = await readSource(source, cell, bounds)
      }
      return read
    })
  }

  /**
   * One row group's records, normalised, for a sweep to post into squares.
   *
   * Here rather than in the script because this is where a source's columns
   * and its normaliser are already paired: sweep.js is handed records that
   * know which square they are in and never learns what Parquet or Overture
   * is, and the caller does not have to keep a second copy of that pairing in
   * step with this one.
   *
   * @param {{url: string, size: number}} part
   * @param {{s: number, e: number}} group
   */
  /* One row group's rows, with two ways to be stopped: the run being asked to
     stop, and this read taking too long.
   *
     The second was missing, and a planet run paid for it. The reader plumbs a
     signal into every fetch it makes, and the only one it was ever given was
     the run's own stop controller — which fires when somebody stops the run
     and at no other time. So a range read against a socket that connected and
     then went silent hung for ever: no bytes, no error, nothing for the
     sweep's retry-and-set-aside machinery to catch, because that machinery
     only sees reads that *fail*. Production had a run twenty-seven minutes
     still with zero groups set aside, which is exactly what that looks like.

     `AbortSignal.any` because both reasons must work: composing them means a
     deploy stopping the sweep still stops it instantly, and a dead socket
     stops costing more than its deadline. */
  async function readSwept(part, group, { deadlineMs = 0 } = {}) {
    const source = sources[0]
    const deadline = deadlineMs > 0 ? AbortSignal.timeout(deadlineMs) : null
    const signal = deadline ? AbortSignal.any([controller.signal, deadline]) : controller.signal
    const rows = await reader.readGroup(part, group, columnsFor(source), { signal })
    return normalise(source, rows, releases[source]).places
  }

  /**
   * One cell, from records a sweep has already read out of the release.
   *
   * Refused outright when the ingest carries more than one source, and the
   * refusal is the point rather than a caution. Two sources are clustered
   * together inside a cell, and the load then deletes the `place_sources`
   * rows of every source it was built with that this run did not produce —
   * so a single-source sweep loading into a two-source ingest would throw
   * away everything the other source said about every place it touched, in
   * the same transaction that made the cell look freshly ingested. The cell
   * path already does the right thing with two sources; this says so.
   *
   * @param {string} cell
   * @param {object[]} places  normalised records, all of them in this cell
   */
  async function loadSwept(cell, places) {
    if (sources.length !== 1) {
      throw new Error(
        `places: a sweep reads one source and this ingest has ${sources.join(' and ')} — ` +
          'two sources are clustered together inside a cell, so sweeping one of them ' +
          'would drop what the other said; ingest these cells the cell-at-a-time way',
      )
    }
    return finishCell(cell, async () => ({
      [sources[0]]: { places, read: places.length, skipped: 0, groups: 0 },
    }))
  }

  /** The cells already finished, so `--resume` can skip them, and the cursor
      of anything left half-done, so a run can say where it is picking up. */
  /* `ingesting` counts as done for a resume: another process — the in-process
     drain, or an earlier run still going — is inside that cell's transaction,
     and starting a second read of it ends with both trying to insert the same
     gers_id and whichever commits second dying on the unique key. A row left
     `ingesting` by a process that is gone is reclaimed by the reaper in
     places/worker.js rather than by being raced. */
  async function progressFor(cells) {
    if (dryRun) return { done: new Set(), cursors: new Map() }
    const { rows } = await pool.query(
      'select cell, status, cursor, versions from place_coverage where cell = any($1::text[])',
      [cells],
    )
    /* Done means done by this pipeline. A cell ingested by an older one holds
       rows of a shape this version no longer writes, and skipping it is how a
       planet ends up half one thing and half another with every coverage row
       saying `ready`. It is re-read, once, and then it is done for good. */
    const current = row => Number(row.versions?.pipeline ?? 1) === PLACE_PIPELINE
    return {
      done: new Set(
        rows
          .filter(
            row =>
              (row.status === 'ready' && current(row)) ||
              (row.status === 'empty' && current(row)) ||
              row.status === 'ingesting',
          )
          .map(row => row.cell),
      ),
      cursors: new Map(rows.filter(row => row.cursor).map(row => [row.cell, row.cursor])),
    }
  }

  /**
   * A list of cells, `concurrency` at a time.
   *
   * @param {string[]} cells
   * @param {{resume?: boolean, onCell?: Function}} [options]
   */
  async function ingestCells(cells, { resume = false, onCell = () => {} } = {}) {
    const wanted = [...new Set(cells)].filter(isCellKey)
    const { done, cursors } = resume
      ? await progressFor(wanted)
      : { done: new Set(), cursors: new Map() }
    const queue = wanted.filter(cell => !done.has(cell))
    const results = []
    const skipped = wanted.length - queue.length
    let at = 0
    const worker = async () => {
      while (at < queue.length && !controller.signal.aborted) {
        const cell = queue[at++]
        const resumedFrom = cursors.get(cell) || null
        if (resumedFrom) log(`${cell} resuming from ${JSON.stringify(resumedFrom)}`)
        const outcome = { ...(await ingestCell(cell)), resumedFrom }
        results.push(outcome)
        onCell(outcome)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    return { results, skipped, interrupted: controller.signal.aborted, versions }
  }

  return {
    ingestCell,
    ingestCells,
    readSwept,
    loadSwept,
    progressFor,
    versions,
    sources,
    /** Stop after the cell in flight. The coverage row stays `ingesting` with
        its cursor, which is exactly what `--resume` looks for. */
    stop: () => controller.abort(),
    aborted: () => controller.signal.aborted,
  }
}

/**
 * Which cells a run covers, from whichever way the caller asked.
 *
 * The planet is not a special path: it is every cell a release's row groups
 * could put a place in, which is as close to "every land cell" as we can get
 * without shipping a coastline. Cells are returned west to east so
 * consecutive work hits the same parts and row groups and the reader's warm
 * footers earn their keep.
 *
 * Measured, and stated rather than implied: the 2026-08-19.0 release yields
 * 53,333 candidate cells out of the grid's 64,800, against perhaps 25,000
 * that hold any land. It is an upper bound and a loose one, because a row
 * group holds twenty thousand rows sorted by longitude, so its bounding box
 * is a narrow strip of longitude spanning nearly every latitude, and the
 * union of four thousand such strips is everything but the poles. The cells
 * it wrongly includes cost a read each and record themselves `empty`, and
 * `--resume` means they are only paid for once. A planet run that wanted to
 * be quick would sweep the row groups and bucket rows by cell rather than
 * asking cell by cell; that is a different program, and this one is the one
 * that can be stopped, resumed and reasoned about a cell at a time.
 *
 * @param {object} region
 * @param {string[]} [region.cells]
 * @param {{west,south,east,north}} [region.bbox]
 * @param {boolean} [region.planet]
 * @param {Array<{lng: number, lat: number}>} [region.points]  a trip's stops
 * @param {object} [region.index]  a release index, required for the planet
 */
export function cellsForRegion({ cells, bbox, planet, points, index } = {}) {
  if (cells?.length) return [...new Set(cells)].filter(isCellKey).sort()
  if (bbox) return cellsForBounds(bbox).sort()
  if (points?.length) return cellsForPoints(points)
  if (planet) {
    if (!index) throw new Error('places: a planet run needs a release index to know where data is')
    const found = new Set()
    for (const part of index.parts) {
      for (const group of part.groups) {
        for (const cell of cellsForBounds({
          west: group.xmin,
          south: group.ymin,
          east: group.xmax,
          north: group.ymax,
        })) {
          found.add(cell)
        }
      }
    }
    return [...found].sort((a, b) => {
      const left = cellBounds(a)
      const right = cellBounds(b)
      return left.west - right.west || left.south - right.south
    })
  }
  return []
}

/** The cells a trip's stops touch, for the predictive tier. */
export async function cellsForTrip(pool, tripId) {
  const { rows } = await pool.query(
    'select lng, lat from stops where trip_id = $1 and lng is not null and lat is not null',
    [tripId],
  )
  return cellsForPoints(rows.map(row => ({ lng: Number(row.lng), lat: Number(row.lat) })))
}

/* The two indexes that cost the most to maintain during a bulk load and the
   least to do without while one is running: the trigram GIN over names, which
   is rewritten for every row, and the category browse index. The GiST index
   on geom stays — a nearby query with no geometry index is not degraded, it
   is a sequential scan of the planet — and so does the unique index behind
   gers_id, because idempotency is built on it.

   Only for a planet-scale run, and the caller is told, because search is
   genuinely worse until `resumeIndexes` finishes. */
/** The three `pauseIndexes` drops, named once so the rebuild and the
    invalid-index sweep below cannot disagree about which they are. They did:
    the sweep listed two of the three, so a failed build of
    `places_search_prefix_idx` left an INVALID index that `if not exists`
    skipped for ever afterwards — and a two-letter typeahead went back to a
    sequential scan of the planet with an index in the catalogue insisting it
    was fine. A list written twice is a list that is wrong once. */
export const PAUSED_INDEXES = Object.freeze([
  'places_search_name_idx',
  'places_category_idx',
  'places_search_prefix_idx',
])

export async function pauseIndexes(pool) {
  for (const name of PAUSED_INDEXES) await pool.query(`drop index if exists ${name}`)
}

export async function resumeIndexes(pool) {
  /* A CONCURRENTLY build that fails leaves the index behind marked INVALID,
     and `if not exists` then happily skips it on every later run — so search
     would stay on a sequential scan with an index sitting there saying it
     exists. Any invalid one is dropped first. */
  await pool.query(
    `do $$
    declare broken text;
    begin
      for broken in
        select c.relname from pg_index i
        join pg_class c on c.oid = i.indexrelid
        where not i.indisvalid
          and c.relname = any(array[${PAUSED_INDEXES.map(name => `'${name}'`).join(', ')}])
      loop
        execute format('drop index if exists %I', broken);
      end loop;
    end $$`,
  )
  await pool.query(
    'create index concurrently if not exists places_search_name_idx on places using gin (search_name gin_trgm_ops)',
  )
  await pool.query(
    'create index concurrently if not exists places_category_idx on places (category, confidence desc)',
  )
  await pool.query(
    'create index concurrently if not exists places_search_prefix_idx on places (search_name text_pattern_ops)',
  )
  await pool.query('analyze places')
}

/** The cell a point is in, re-exported so callers do not import two modules to
    ask one question. */
export { cellKey, MATCH_METRES }
