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
import { COLUMNS as OVERTURE_COLUMNS, placesFromOverture } from './overture.js'
import { qualityReport } from './quality.js'
import { MATCH_METRES, bestMatch, mergeFields } from './resolve.js'

/** Which source wins a field when both have one, before confidence is
    considered. Overture first because its record is itself a merge with a
    measured confidence; Foursquare's is derived (see fsq.js). */
export const SOURCE_ORDER = Object.freeze(['overture', 'fsq', 'osm'])

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
  const sources = cluster.records.map(record => ({
    key: cluster.key,
    source: record.source,
    /* Both licences where both apply: a record Overture took from
       OpenStreetMap obliges us under ODbL *and* under CDLA, and dropping
       either from the trail is how an attribution notice goes missing. */
    license: (record.licenses || []).join(', ') || 'unknown',
    upstreamId: record.upstreamId,
    version: record.version,
    confidence: Number(record.confidence) || 0,
    fields: credit[record.source] || [],
  }))
  return { place, sources }
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

const csv = value =>
  value === null || value === undefined ? '' : `"${String(value).replaceAll('"', '""')}"`

const json = value => (value === null || value === undefined ? '' : csv(JSON.stringify(value)))

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
  const versions = Object.fromEntries(sources.map(source => [source, releases[source].version]))
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
      .query('update place_coverage set cursor = $2 where cell = $1', [cell, cursor])
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

  async function markFailed(cell, error) {
    if (dryRun) return
    await pool
      .query(
        /* The cursor is deliberately left as it is: it is the note about where
           this attempt got to, and it is what `--resume` reports. */
        `update place_coverage set status = 'failed', error = $2 where cell = $1`,
        [cell, String(error?.message || error).slice(0, 500)],
      )
      .catch(() => {})
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
    const loaded = { inserted: 0, redirected: 0, swept: false }
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
      const sweep = before === 0 || rows.length >= before * RETAIN_RATIO
      if (!sweep && rows.length === 0) {
        throw new Error(
          `read returned no places for ${cell}, which holds ${before}; refusing to empty it`,
        )
      }

      if (sweep) {
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
      }

      await client.query(UPSERT_PLACES)
      /* A source record that has moved to another place must not describe two.
         Deleted first so the upsert below cannot collide with its own past. */
      await client.query(`
        delete from place_sources ps using stage_sources ss, stage_keys k
        where ss.key = k.key and ps.source = ss.source
          and ps.upstream_id = ss.upstream_id and ps.place_id <> k.place_id`)
      await client.query(UPSERT_SOURCES)
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

      if (sweep) {
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
      loaded.swept = sweep
      const bounds = cellBounds(cell)
      await client.query(
        `insert into place_coverage (
           cell, west, south, east, north, status, versions, place_count, quality,
           cursor, requested_at, started_at, last_refresh, attempts, error)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, null, now(), now(), now(), 1, null)
         on conflict (cell) do update set
           status = excluded.status, versions = excluded.versions,
           place_count = excluded.place_count, quality = excluded.quality,
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
   * One cell, end to end.
   * @param {string} cell
   */
  async function ingestCell(cell) {
    if (!isCellKey(cell)) throw new Error(`places: not a cell key: ${cell}`)
    const started = Date.now()
    const bounds = cellBounds(cell)
    await markStarted(cell, bounds)
    try {
      const read = {}
      for (const source of sources) {
        if (controller.signal.aborted) throw new Error('places: ingest interrupted')
        read[source] = await readSource(source, cell, bounds)
      }
      const base = read.overture?.places || []
      const others = sources
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
        read: Object.fromEntries(sources.map(source => [source, read[source].read])),
        groups: sources.reduce((total, source) => total + read[source].groups, 0),
        ms: Date.now() - started,
        quality: report,
      }
      log(
        `${cell} ${outcome.status} ${outcome.places} places (${sources
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

  /** The cells already finished, so `--resume` can skip them, and the cursor
      of anything left half-done, so a run can say where it is picking up. */
  async function progressFor(cells) {
    if (dryRun) return { done: new Set(), cursors: new Map() }
    const { rows } = await pool.query(
      'select cell, status, cursor from place_coverage where cell = any($1::text[])',
      [cells],
    )
    return {
      done: new Set(
        rows.filter(row => row.status === 'ready' || row.status === 'empty').map(row => row.cell),
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
export async function pauseIndexes(pool) {
  await pool.query('drop index if exists places_search_name_idx')
  await pool.query('drop index if exists places_category_idx')
}

export async function resumeIndexes(pool) {
  await pool.query(
    'create index concurrently if not exists places_search_name_idx on places using gin (search_name gin_trgm_ops)',
  )
  await pool.query(
    'create index concurrently if not exists places_category_idx on places (category, confidence desc)',
  )
  await pool.query('analyze places')
}

/** The cell a point is in, re-exported so callers do not import two modules to
    ask one question. */
export { cellKey, MATCH_METRES }
