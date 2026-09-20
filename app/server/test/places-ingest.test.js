import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { cellBounds } from '../src/places/cells.js'
import { CLOSED_CONFIDENCE, fsqConfidence, placeFromFsq, placesFromFsq } from '../src/places/fsq.js'
import {
  cellsForRegion,
  clusterPlaces,
  createIngest,
  PLACE_PIPELINE,
} from '../src/places/ingest.js'
import { qualityReport } from '../src/places/quality.js'
import { privateDatabase } from './private-database.js'

/* The pipeline, end to end, against a real PostGIS and a bucket that is a
   JSON file. The reads are stubbed because what is being proved here is what
   happens to rows after they arrive — merging, loading, re-running, resuming
   — and every one of those is a question about the database, not about S3. */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'places')
const OVERTURE_ROWS = JSON.parse(await readFile(join(fixtures, 'overture-rows.json'), 'utf8'))
const FSQ_ROWS = JSON.parse(await readFile(join(fixtures, 'fsq-rows.json'), 'utf8'))

const RELEASE = { version: '2026-08-05' }
/* Every date in the fixtures is relative to this, so the derived Foursquare
   confidence is a fixed number rather than one that drifts as the suite ages. */
const NOW = Date.parse('2026-09-20T00:00:00Z')

const row = (rows, id) =>
  rows.find(entry => entry.fsq_place_id === id || entry.id === id) ||
  assert.fail(`no fixture row ${id}`)

/* ---- pure: one Foursquare row ---------------------------------------- */

test('a Foursquare row becomes a place, with the licence and category it has', () => {
  const place = placeFromFsq(row(FSQ_ROWS, 'fsq-cafe-zoom'), RELEASE, { now: NOW })
  assert.equal(place.source, 'fsq')
  assert.equal(place.upstreamId, 'fsq-cafe-zoom')
  /* No GERS id, and none invented: gers_id is unique in the schema and a made
     up one collides with a real one the moment Overture catches up. */
  assert.equal(place.gersId, null)
  assert.equal(place.name, 'Cafe Zoom')
  assert.equal(place.cell, 'N52E004')
  assert.equal(place.category, 'cafe')
  assert.equal(place.categoryRaw, 'Cafe, Coffee, and Tea House')
  assert.deepEqual(place.address, {
    freeform: 'Prinsengracht 1',
    locality: 'Amsterdam',
    region: 'Noord-Holland',
    postcode: '1015 AA',
    country: 'NL',
  })
  assert.equal(place.phone, '+31206392589')
  assert.equal(place.website, 'https://cafezoom.example')
  /* Two things Foursquare's open release does not publish, left unfilled
     rather than guessed. */
  assert.equal(place.hours, null)
  assert.deepEqual(place.alternateNames, [])
  assert.deepEqual(place.licenses, ['Apache-2.0'])
  assert.deepEqual(place.upstreamIds, ['fsq:fsq-cafe-zoom'])
  assert.equal(place.version, '2026-08-05')
})

test('the derived confidence is the formula in the comment, and nothing else', () => {
  /* Complete and refreshed seven weeks ago: 0.20 + 0.40 × 1 + 0.25 × 1. */
  const complete = fsqConfidence(row(FSQ_ROWS, 'fsq-cafe-zoom'), { now: NOW })
  assert.equal(complete.completeness, 1)
  assert.equal(complete.recency, 1)
  assert.equal(complete.confidence, 0.85)
  /* Four of six fields, refreshed nine weeks ago: 0.20 + 0.40 × (4/6) + 0.25. */
  const partial = fsqConfidence(row(FSQ_ROWS, 'fsq-zoom-coffee'), { now: NOW })
  assert.equal(partial.completeness, 4 / 6)
  assert.equal(partial.recency, 1)
  assert.equal(partial.confidence, 0.717)
  /* A record Foursquare has dated as closed is worth one thing only. */
  const closed = fsqConfidence(row(FSQ_ROWS, 'fsq-old-bar'), { now: NOW })
  assert.equal(closed.closed, true)
  assert.equal(closed.confidence, CLOSED_CONFIDENCE)
  /* Nothing derived reaches 1: the gap is the marker that it was derived. */
  assert.ok(complete.confidence < 1)
})

test('a closed place is kept, said to be closed, and a nameless one is dropped', () => {
  const { places, skipped } = placesFromFsq(
    [...FSQ_ROWS, { fsq_place_id: 'x', name: '  ', latitude: 1, longitude: 1 }],
    RELEASE,
    { now: NOW },
  )
  assert.equal(places.length, 3)
  assert.equal(skipped, 1)
  assert.equal(places.find(place => place.upstreamId === 'fsq-old-bar').operating, 'closed')
})

/* ---- pure: the quality report ---------------------------------------- */

test('the quality report counts what is there, as numbers', () => {
  const report = qualityReport([
    {
      category: 'cafe',
      website: 'a',
      phone: '1',
      hours: null,
      address: { locality: 'x' },
      confidence: 0.8,
    },
    {
      category: 'cafe',
      website: null,
      phone: '2',
      hours: null,
      address: { locality: 'x' },
      confidence: 0.6,
    },
    {
      category: 'museum',
      website: 'c',
      phone: null,
      hours: { mo: '9-5' },
      address: null,
      confidence: 0.2,
    },
    {
      category: 'museum',
      website: null,
      phone: null,
      hours: null,
      address: { locality: 'x' },
      confidence: 0.1,
    },
  ])
  assert.equal(report.count, 4)
  assert.deepEqual(report.byCategory, { cafe: 2, museum: 2 })
  assert.equal(report.withWebsite, 50)
  assert.equal(report.withPhone, 50)
  assert.equal(report.withHours, 25)
  assert.equal(report.withAddress, 75)
  assert.equal(report.meanConfidence, 0.425)
  /* Two of the four are under the floor a search applies; a count, because
     the question is "how many would a search refuse to show". */
  assert.equal(report.belowFloor, 2)
  /* Numbers, not strings: this lands in jsonb and gets compared with `>`. */
  assert.equal(typeof report.withWebsite, 'number')
})

test('an empty cell reports zeroes rather than dividing by nothing', () => {
  assert.deepEqual(qualityReport([]), {
    count: 0,
    byCategory: {},
    withWebsite: 0,
    withPhone: 0,
    withHours: 0,
    withAddress: 0,
    meanConfidence: 0,
    belowFloor: 0,
  })
})

/* ---- pure: clustering -------------------------------------------------- */

test('the same shopfront clusters; three hundred metres apart does not', () => {
  const base = [
    {
      source: 'overture',
      upstreamId: 'a',
      gersId: 'a',
      name: 'Café Zoom',
      lng: 4.89,
      lat: 52.37,
      category: 'cafe',
      confidence: 0.6,
    },
  ]
  const others = [
    {
      source: 'fsq',
      upstreamId: 'f1',
      name: 'Cafe Zoom',
      lng: 4.89002,
      lat: 52.37001,
      category: 'cafe',
      confidence: 0.85,
    },
    {
      source: 'fsq',
      upstreamId: 'f2',
      name: 'Zoom Coffee',
      lng: 4.89,
      lat: 52.3727,
      category: 'cafe',
      confidence: 0.7,
    },
  ]
  const clusters = clusterPlaces(base, others)
  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].records.length, 2)
  assert.equal(clusters[1].key, 'fsq:f2')
})

/* ---- the database ------------------------------------------------------ */

const baseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'
let databaseUrl = baseUrl
const unreachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  databaseUrl = await privateDatabase(baseUrl, 'places')
  return false
})()

const { createPostgresRepository } = await import('../src/postgres.js')

async function freshDatabase(t) {
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query('drop schema public cascade; create schema public')
  await admin.end()
  const repository = await createPostgresRepository({
    databaseUrl,
    adminEmail: 'owner@example.com',
  })
  await repository.migrate()
  await repository.close()
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
  t.after(() => pool.end())
  return pool
}

/** A reader whose bucket is a pair of arrays. The box test is the same
    inclusive one parquet.js applies, because that inclusiveness is exactly
    what the adjacent-cell test below is about. */
function readerFor({ overture = OVERTURE_ROWS, fsq = FSQ_ROWS } = {}, hooks = {}) {
  const rows = { overture, fsq }
  const reads = []
  const reader = {
    reads,
    readBox: async (index, bounds, _columns, { onGroup } = {}) => {
      const source = index.source
      reads.push({ source, bounds })
      await hooks.before?.(source, bounds)
      const found = (rows[source] || []).filter(entry => {
        const lng = source === 'overture' ? entry.bbox.xmin : entry.longitude
        const lat = source === 'overture' ? entry.bbox.ymin : entry.latitude
        return (
          lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north
        )
      })
      onGroup?.(found.length)
      await hooks.after?.(source, bounds)
      return found
    },
  }
  return reader
}

const releases = () => ({
  overture: { version: '2026-08-19.10', index: { source: 'overture', parts: [] } },
  fsq: { version: '2026-08-05', index: { source: 'fsq', parts: [] } },
})

const count = async (pool, sql, params = []) =>
  Number((await pool.query(sql, params)).rows[0].count)

test('an Overture place and a Foursquare place at one shopfront become one row with two sources', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  const outcome = await ingest.ingestCell('N52E004')
  assert.equal(outcome.status, 'ready')

  const { rows } = await pool.query(
    `select p.id, p.name, p.gers_id, p.category, p.website, p.phone, p.confidence,
            st_x(p.geom::geometry) as lng, st_y(p.geom::geometry) as lat
     from places p where p.gers_id = 'ov-cafe-zoom'`,
  )
  assert.equal(rows.length, 1)
  const place = rows[0]
  /* The canonical key is Overture's, and the position is the most confident
     source's rather than an average — averaging puts the pin in the road. */
  assert.equal(place.gers_id, 'ov-cafe-zoom')
  assert.equal(Number(place.lng), 4.89002)
  /* Overture had no telephone and no website; Foursquare did, so the merged
     record has both and neither source lost anything. */
  assert.equal(place.phone, '+31206392589')
  assert.equal(place.website, 'https://cafezoom.example')

  const sources = await pool.query(
    'select source, license, upstream_id, version, fields, confidence from place_sources where place_id = $1 order by source',
    [place.id],
  )
  assert.deepEqual(
    sources.rows.map(source => source.source),
    ['fsq', 'overture'],
  )
  const fsq = sources.rows.find(source => source.source === 'fsq')
  const overture = sources.rows.find(source => source.source === 'overture')
  assert.equal(fsq.license, 'Apache-2.0')
  assert.equal(fsq.upstream_id, 'fsq-cafe-zoom')
  assert.equal(fsq.version, '2026-08-05')
  /* Credit where it is due, field by field: Foursquare supplied the contact
     details, Overture only what Foursquare's higher confidence did not win. */
  assert.ok(fsq.fields.includes('phone'))
  assert.ok(fsq.fields.includes('website'))
  assert.ok(!overture.fields.includes('phone'))

  /* A record Overture took from OpenStreetMap carries both licences, because
     both oblige us. */
  /* One row per dataset that named the place, each under its own licence.
   *
   * This used to be one row carrying every licence the place was under, comma
   * joined — which says which licences apply without saying to what, and ODbL
   * is an obligation attached to particular records rather than to a place in
   * general. It also made "how many independent datasets named this" read as
   * one for every row in the database, which is the only measure of prominence
   * open data with no ratings has. */
  const museum = await pool.query(
    `select ps.license, ps.upstream_id from place_sources ps join places p on p.id = ps.place_id
     where p.gers_id = 'ov-museum' order by ps.upstream_id`,
  )
  assert.ok(museum.rows.length >= 1, 'the museum kept its upstream records')
  for (const row of museum.rows) {
    const osm = /^(openstreetmap|osm)/i.test(row.upstream_id)
    assert.equal(
      row.license,
      osm ? 'ODbL-1.0' : 'CDLA-Permissive-2.0',
      `${row.upstream_id} is under the licence its own dataset carries`,
    )
  }
  /* And the attribution a viewer is shown is still every licence that
     applies, gathered across the rows rather than baked into each. */
  const notices = new Set(museum.rows.map(row => row.license))
  assert.ok(notices.has('ODbL-1.0'), 'the OpenStreetMap-derived record still obliges us')
})

test('two genuinely different places three hundred metres apart stay two', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  await ingest.ingestCell('N52E004')
  /* The café merged, so its row is named by whichever source was most
     confident about it — here Foursquare's complete, freshly refreshed record
     at 0.85 over Overture's 0.61, which is mergeFields' rule and not this
     module's to override. The accented spelling is not lost: alternate names
     gather rather than compete, so a search for "Café Zoom" still lands. */
  const zoom = await pool.query(
    "select name, alternate_names, gers_id from places where cell = 'N52E004' and name like '%Zoom%' order by name",
  )
  assert.deepEqual(
    zoom.rows.map(place => place.name),
    ['Cafe Zoom', 'Zoom Coffee'],
  )
  assert.ok(zoom.rows[0].alternate_names.includes('Café Zoom'))
  /* The second is three hundred metres away and a different business: it
     stands alone, and a place only Foursquare knows carries no GERS id. */
  assert.equal(zoom.rows[0].gers_id, 'ov-cafe-zoom')
  assert.equal(zoom.rows[1].gers_id, null)
})

test('ingesting the same cell twice leaves exactly the same rows', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  const first = await ingest.ingestCell('N52E004')
  const placesAfterFirst = await count(pool, 'select count(*) as count from places')
  const sourcesAfterFirst = await count(pool, 'select count(*) as count from place_sources')
  const ids = await pool.query('select id from places order by id')

  const second = await ingest.ingestCell('N52E004')
  assert.equal(second.places, first.places)
  assert.equal(await count(pool, 'select count(*) as count from places'), placesAfterFirst)
  assert.equal(await count(pool, 'select count(*) as count from place_sources'), sourcesAfterFirst)
  /* Not merely the same number: the same rows. A second run that replaced
     every id would break every stop pointing at one. */
  const again = await pool.query('select id from places order by id')
  assert.deepEqual(again.rows, ids.rows)
  /* And nothing was mistaken for a place that had gone. */
  assert.equal(await count(pool, 'select count(*) as count from place_redirects'), 0)
})

test('two adjacent cells sharing a place on their edge load it exactly once', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  /* cellBounds is inclusive at both edges and parquet.js `inside` tests >= and
     <=, so a place at exactly 5.0000 is read for both of these. Without the
     cellKey filter the second insert dies on places_gers_id_key. */
  const west = cellBounds('N52E004')
  const east = cellBounds('N52E005')
  assert.equal(west.east, east.west, 'the fixture only proves anything if the cells share an edge')

  const first = await ingest.ingestCell('N52E004')
  const second = await ingest.ingestCell('N52E005')
  assert.equal(first.status, 'ready')
  assert.equal(second.status, 'ready')
  assert.notEqual(second.status, 'failed')

  const edge = await pool.query("select id, cell from places where gers_id = 'ov-on-the-edge'")
  assert.equal(edge.rows.length, 1)
  /* Floor semantics: the meridian belongs to the cell east of it. */
  assert.equal(edge.rows[0].cell, 'N52E005')
  /* And the western cell did not claim it, so its coverage count is honest. */
  const coverage = await pool.query(
    'select cell, place_count, status from place_coverage order by cell',
  )
  assert.deepEqual(
    coverage.rows.map(cell => [cell.cell, cell.status]),
    [
      ['N52E004', 'ready'],
      ['N52E005', 'ready'],
    ],
  )
  assert.equal(coverage.rows[1].place_count, 1)
})

test('a name full of quotes, backslashes, commas, braces and newlines survives the COPY', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  await ingest.ingestCell('N52E004')
  const { rows } = await pool.query(
    "select name, alternate_names from places where gers_id = 'ov-awkward'",
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Biblioteca "Gen.C.A. Michele Mola" della Scuola')
  /* Every one of these characters has broken a text[] literal in a COPY
     stream at some point; the array must come back exactly as it went in. */
  assert.deepEqual(rows[0].alternate_names, [
    'Biblioteca, {la} "Mola"',
    'Reading Room\nUpstairs',
    'Sala \\ Lettura, {chiusa}',
  ])
})

test('the cell stores a quality report and the status it earned', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  await ingest.ingestCell('N52E004')
  const { rows } = await pool.query(
    'select status, versions, place_count, quality, cursor, attempts, error from place_coverage where cell = $1',
    ['N52E004'],
  )
  const coverage = rows[0]
  assert.equal(coverage.status, 'ready')
  assert.equal(coverage.error, null)
  assert.equal(coverage.cursor, null, 'a finished cell has no cursor left over')
  assert.deepEqual(
    coverage.versions,
    {
      overture: '2026-08-19.10',
      fsq: '2026-08-05',
      pipeline: PLACE_PIPELINE,
    },
    'the releases it read, and the shape of the reading',
  )
  assert.equal(coverage.place_count, coverage.quality.count)
  assert.equal(coverage.quality.byCategory.cafe, 2)
  assert.equal(typeof coverage.quality.meanConfidence, 'number')

  /* A cell with nothing in it is `empty`, which is a different answer from
     `failed` and from never having been asked. */
  const empty = await ingest.ingestCell('S40W030')
  assert.equal(empty.status, 'empty')
  const ocean = await pool.query('select status, place_count from place_coverage where cell = $1', [
    'S40W030',
  ])
  assert.equal(ocean.rows[0].status, 'empty')
  assert.equal(ocean.rows[0].place_count, 0)
})

test('a cell an older pipeline wrote is read again, however ready it says it is', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const reader = readerFor()
  const ingest = createIngest({
    pool,
    reader,
    releases: releases(),
    now: () => new Date(NOW),
  })
  await ingest.ingestCell('N52E004')

  /* The shape a cell has when it was ingested before this version of the
     reading existed: `ready`, the right releases, no pipeline stamp at all. */
  await pool.query(`update place_coverage set versions = versions - 'pipeline' where cell = $1`, [
    'N52E004',
  ])
  const stale = await ingest.progressFor(['N52E004'])
  assert.equal(
    stale.done.has('N52E004'),
    false,
    'ready by an older pipeline is not done — its rows are the wrong shape',
  )

  reader.reads.length = 0
  const again = await ingest.ingestCells(['N52E004'], { resume: true })
  assert.equal(again.skipped, 0)
  assert.equal(again.results[0].status, 'ready')
  assert.ok(reader.reads.length > 0, 'and it really was read again')

  /* Re-read once, and then it is done for good. */
  const now = await ingest.progressFor(['N52E004'])
  assert.equal(now.done.has('N52E004'), true)
})

test('a run interrupted mid-cell resumes from its cursor and skips what is done', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  let fail = true
  const dying = readerFor(
    {},
    {
      after: async (source, bounds) => {
        /* Die after the first source of the second cell has been read and the
           cursor written — the shape of a process killed mid-cell. */
        if (fail && source === 'overture' && bounds.west === 5) {
          throw new Error('connection reset by peer')
        }
      },
    },
  )
  const first = createIngest({
    pool,
    reader: dying,
    releases: releases(),
    now: () => new Date(NOW),
  })
  const run = await first.ingestCells(['N52E004', 'N52E005'])
  assert.equal(run.results[0].status, 'ready')
  assert.equal(run.results[1].status, 'failed')

  const midway = await pool.query(
    'select status, cursor, attempts from place_coverage where cell = $1',
    ['N52E005'],
  )
  assert.equal(midway.rows[0].status, 'failed')
  assert.equal(midway.rows[0].attempts, 1)
  /* The cursor is the point of this: a crash leaves a note about where it
     was, not merely that it was somewhere. */
  assert.equal(midway.rows[0].cursor.phase, 'read')
  assert.equal(midway.rows[0].cursor.source, 'overture')

  fail = false
  const healthy = readerFor()
  const second = createIngest({
    pool,
    reader: healthy,
    releases: releases(),
    now: () => new Date(NOW),
  })
  const resumed = await second.ingestCells(['N52E004', 'N52E005'], { resume: true })
  assert.equal(resumed.skipped, 1, 'the cell that finished is not read again')
  assert.ok(
    healthy.reads.every(read => read.bounds.west === 5),
    'nothing re-read the cell that was already ready',
  )
  assert.equal(resumed.results.length, 1)
  assert.equal(resumed.results[0].cell, 'N52E005')
  assert.equal(resumed.results[0].status, 'ready')
  /* It knows where it is picking up from. */
  assert.equal(resumed.results[0].resumedFrom.phase, 'read')
  const after = await pool.query(
    'select status, cursor, attempts from place_coverage where cell = $1',
    ['N52E005'],
  )
  assert.equal(after.rows[0].status, 'ready')
  assert.equal(after.rows[0].cursor, null)
  /* Back to zero on success. The column counts *consecutive* failures — it is
     what the drain backs off on — so a count that only ever climbed would put
     every cell past the cap after a year of monthly refreshes, and the first
     time one then failed it would be abandoned for good. */
  assert.equal(after.rows[0].attempts, 0)
})

/* The half-read, which is the one the guard used to let through. A read that
   comes back with a fraction of what the cell holds used only to skip the
   sweep: it upserted its fraction, left the rest stale beside it, and wrote
   the coverage row `ready` at the current release with a count taken from the
   table rather than from the read. Stale for ever, and silent. */
test('a cell that reads back as a fraction of itself is refused too', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const full = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  await full.ingestCell('N52E004')
  const before = await count(pool, 'select count(*) as count from places')
  assert.ok(before >= 4, `${before} places to halve`)

  const partial = createIngest({
    pool,
    reader: readerFor({ overture: OVERTURE_ROWS.slice(0, 1), fsq: [] }),
    releases: releases(),
    now: () => new Date(NOW),
  })
  const outcome = await partial.ingestCell('N52E004')
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.error, /truncated read/)
  assert.equal(await count(pool, 'select count(*) as count from places'), before, 'nothing moved')
  const row = await pool.query('select status, versions from place_coverage where cell = $1', [
    'N52E004',
  ])
  assert.equal(row.rows[0].status, 'failed')
})

test('a place that goes upstream leaves a redirect, and the stop that named it still resolves', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  await ingest.ingestCell('N52E004')
  const museum = await pool.query("select id from places where gers_id = 'ov-museum'")
  const placeId = museum.rows[0].id

  await pool.query(
    "insert into trips (id, slug, title, day_count) values ('11111111-1111-1111-1111-111111111111', 'a-trip', 'A trip', 1)",
  )
  await pool.query(
    `insert into stops (id, trip_id, name, lng, lat, place_id)
     values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
             'The museum', 4.885, 52.369, $1)`,
    [placeId],
  )

  /* The next release no longer carries the museum. Everything else is there,
     so the collapse guard does not fire and the sweep runs. */
  const thinner = readerFor({ overture: OVERTURE_ROWS.filter(entry => entry.id !== 'ov-museum') })
  const refresh = createIngest({
    pool,
    reader: thinner,
    releases: releases(),
    now: () => new Date(NOW),
  })
  const outcome = await refresh.ingestCell('N52E004')
  assert.equal(outcome.status, 'ready')
  assert.equal(outcome.redirected, 1)

  const gone = await pool.query('select id from places where id = $1', [placeId])
  assert.equal(gone.rows.length, 0)
  /* Not deleted silently: the old id still answers, and says what happened. */
  const redirect = await pool.query(
    'select new_id, reason from place_redirects where old_id = $1',
    [placeId],
  )
  assert.equal(redirect.rows.length, 1)
  assert.equal(redirect.rows[0].reason, 'gone')
  assert.equal(redirect.rows[0].new_id, null)
  /* The stop survives with its own name, which is the whole point of the
     nullable foreign key. */
  const stop = await pool.query(
    "select name, place_id from stops where id = '22222222-2222-2222-2222-222222222222'",
  )
  assert.equal(stop.rows[0].name, 'The museum')
  assert.equal(stop.rows[0].place_id, null)
})

test('a cell that suddenly reads as empty is refused rather than emptied', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  await ingest.ingestCell('N52E004')
  const before = await count(pool, 'select count(*) as count from places')
  assert.ok(before > 0)

  /* A bad afternoon on the network looks exactly like a town that vanished.
     Deleting a city because S3 hiccuped is not a mistake you get to make. */
  const silent = readerFor({ overture: [], fsq: [] })
  const refresh = createIngest({
    pool,
    reader: silent,
    releases: releases(),
    now: () => new Date(NOW),
  })
  const outcome = await refresh.ingestCell('N52E004')
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.error, /refusing to load it/)
  assert.equal(await count(pool, 'select count(*) as count from places'), before)
  const coverage = await pool.query('select status, error from place_coverage where cell = $1', [
    'N52E004',
  ])
  assert.equal(coverage.rows[0].status, 'failed')
  assert.match(coverage.rows[0].error, /refusing to load it/)
})

test('a dry run reads, merges and reports, and writes nothing at all', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    dryRun: true,
    now: () => new Date(NOW),
  })
  const outcome = await ingest.ingestCell('N52E004')
  assert.ok(outcome.places > 0)
  assert.equal(outcome.quality.count, outcome.places)
  assert.equal(await count(pool, 'select count(*) as count from places'), 0)
  assert.equal(await count(pool, 'select count(*) as count from place_coverage'), 0)
})

test('a region is a list of cells however it was asked for', () => {
  assert.deepEqual(cellsForRegion({ cells: ['N52E004', 'nonsense', 'N52E004'] }), ['N52E004'])
  assert.deepEqual(cellsForRegion({ bbox: { west: 4, south: 52, east: 5, north: 52.5 } }), [
    'N52E004',
    'N52E005',
  ])
  /* The planet is not a special path: it is every cell the release's own row
     groups say could hold a place. */
  const planet = cellsForRegion({
    planet: true,
    index: { parts: [{ groups: [{ xmin: 4.2, xmax: 4.8, ymin: 52.1, ymax: 52.9 }] }] },
  })
  assert.deepEqual(planet, ['N52E004'])
  assert.throws(() => cellsForRegion({ planet: true }), /needs a release index/)
  assert.deepEqual(cellsForRegion({}), [])
})

/* ---- marks earn their zoom, and keep it ------------------------------- */

test('a cell comes out of an ingest with every place given a zoom', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  const outcome = await ingest.ingestCell('N52E004')
  assert.equal(outcome.status, 'ready')
  /* Inside the same transaction as the places, so there is never a moment
     where a cell holds rows no tile would draw. */
  const unmarked = await count(
    pool,
    "select count(*)::int as count from places where cell = 'N52E004' and label_zoom is null",
  )
  assert.equal(unmarked, 0, 'every place in the cell earned a zoom')
  const marked = await pool.query(
    "select label_zoom from places where cell = 'N52E004' order by label_zoom",
  )
  for (const row of marked.rows) {
    assert.ok(row.label_zoom >= 11 && row.label_zoom <= 17, `${row.label_zoom} is a zoom`)
  }
})

test('a mark that has appeared cannot disappear as you zoom in', {
  skip: unreachable,
}, async t => {
  /* The property the whole design exists for, and the one the old per-tile
     cap could not give: a square asks for label_zoom <= z with no limit, so
     the set at z+1 is a superset of the set at z over the same ground. It was
     reported as pins showing at one zoom and gone at the next, and it was
     true — the cap fell differently on each square. */
  const pool = await freshDatabase(t)
  const ingest = createIngest({
    pool,
    reader: readerFor(),
    releases: releases(),
    now: () => new Date(NOW),
  })
  await ingest.ingestCell('N52E004')
  const seen = new Map()
  for (let z = 11; z <= 17; z += 1) {
    const { rows } = await pool.query(
      `select id::text as id from places
       where cell = 'N52E004' and label_zoom is not null and label_zoom <= $1`,
      [z],
    )
    const here = new Set(rows.map(row => row.id))
    for (const [id, from] of seen) {
      assert.ok(here.has(id), `a mark shown at z${from} vanished by z${z}`)
    }
    for (const id of here) if (!seen.has(id)) seen.set(id, z)
  }
  assert.ok(seen.size > 0, 'the fixture put something on the map')
})
