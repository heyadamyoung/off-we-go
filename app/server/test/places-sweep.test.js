import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createIngest } from '../src/places/ingest.js'
import { createSweep, sweepPlan } from '../src/places/sweep.js'
import { privateDatabase } from './private-database.js'

/* The sweep: reading the release once instead of once per cell.
 *
 * Two properties are worth a test and the rest is arithmetic. A cell must not
 * be written until every row group that could hold one of its places has been
 * read — write it early and the collapse guard fires on a cell that was fine,
 * or worse, does not fire and a third of a city is quietly lost. And the
 * sweep must put exactly the same rows in the database as asking cell by cell
 * does, because the whole argument for it is that it is the same ingest
 * reading in a better order, and a sweep that is merely nearly the same is a
 * second implementation nobody is diffing.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'places')
const OVERTURE_ROWS = JSON.parse(await readFile(join(fixtures, 'overture-rows.json'), 'utf8'))
const NOW = Date.parse('2026-09-20T00:00:00Z')

/* ---- pure: what a sweep plans to read ---------------------------------- */

/** An index of one part whose groups are stated as boxes, so a plan can be
    asserted without a bucket or a Parquet file anywhere near it. */
const indexOf = (...boxes) => ({
  source: 'overture',
  parts: [
    {
      url: 'https://example.invalid/part-0.parquet',
      size: 1000,
      xmin: Math.min(...boxes.map(box => box.xmin)),
      ymin: Math.min(...boxes.map(box => box.ymin)),
      xmax: Math.max(...boxes.map(box => box.xmax)),
      ymax: Math.max(...boxes.map(box => box.ymax)),
      groups: boxes,
    },
  ],
})

const box = (s, e, xmin, ymin, xmax, ymax) => ({ s, e, xmin, ymin, xmax, ymax })

test('a plan counts, for every cell, how many groups it is still waiting on', () => {
  /* Two groups over Amsterdam's square, one over the square east of it, and
     one that straddles both — so N52E004 waits on three reads and N52E005 on
     two, which is the number the walk counts down. */
  const plan = sweepPlan(
    indexOf(
      box(0, 10, 4.1, 52.1, 4.9, 52.9),
      box(10, 20, 4.2, 52.2, 4.8, 52.8),
      box(20, 30, 5.1, 52.1, 5.9, 52.9),
      box(30, 40, 4.5, 52.5, 5.5, 52.5),
    ),
  )
  assert.equal(plan.groups.length, 4)
  assert.equal(plan.rows, 40)
  assert.equal(plan.cells, 2)
  assert.equal(plan.outstanding.get('N52E004'), 3)
  assert.equal(plan.outstanding.get('N52E005'), 2)
})

test('a cell no row group touches is planned as empty rather than left out', () => {
  const index = indexOf(box(0, 10, 4.1, 52.1, 4.9, 52.9))
  const plan = sweepPlan(index, { cells: ['N52E004', 'N00W030', 'S40W030'] })
  assert.deepEqual(plan.barren, ['N00W030', 'S40W030'])
  assert.equal(plan.cells, 1)
})

test('a group whose cells are all loaded already is not read at all', () => {
  const index = indexOf(box(0, 10, 4.1, 52.1, 4.9, 52.9), box(10, 20, 5.1, 52.1, 5.9, 52.9))
  const plan = sweepPlan(index, { cells: ['N52E005'] })
  assert.equal(plan.groups.length, 1)
  assert.equal(plan.skipped, 1)
  assert.equal(plan.rows, 10)
  assert.deepEqual([...plan.outstanding.keys()], ['N52E005'])
})

/* ---- the walk ---------------------------------------------------------- */

const record = (cell, key) => ({ cell, key })

/** A sweep over a stated plan, recording what it wrote and when. */
function walk(index, { cells = null, rows = {}, stopAfter = null } = {}) {
  const plan = sweepPlan(index, { cells })
  const written = []
  const readAt = []
  const swept = createSweep({
    plan,
    read: async (_part, group) => {
      readAt.push(group.s)
      return rows[group.s] || []
    },
    load: async (cell, held) => {
      written.push({ cell, at: readAt.length, places: held.map(one => one.key) })
      if (stopAfter && written.length >= stopAfter) swept.stop()
      return { cell, status: held.length ? 'ready' : 'empty', places: held.length }
    },
    loadAhead: 1,
  })
  return swept.run().then(totals => ({ totals, written, readAt }))
}

test('a cell is written only once its last group has been read', async () => {
  const index = indexOf(
    box(0, 2, 4.1, 52.1, 4.9, 52.9),
    box(2, 4, 5.1, 52.1, 5.9, 52.9),
    box(4, 6, 4.1, 52.1, 4.9, 52.9),
  )
  const { totals, written } = await walk(index, {
    rows: {
      0: [record('N52E004', 'a')],
      2: [record('N52E005', 'c')],
      4: [record('N52E004', 'b')],
    },
  })
  /* Amsterdam is in the first and third groups, so it is written third — not
     after the first, which is the mistake this exists to catch — and it is
     written with both of its places rather than one. */
  assert.deepEqual(
    written.map(one => one.cell),
    ['N52E005', 'N52E004'],
  )
  assert.deepEqual(written[1].places, ['a', 'b'])
  assert.equal(written[1].at, 3)
  assert.equal(totals.cells, 2)
  assert.equal(totals.unfinished, 0)
  assert.equal(totals.kept, 3)
})

test('the empty cells are written before anything is read', async () => {
  const index = indexOf(box(0, 2, 4.1, 52.1, 4.9, 52.9))
  const { totals, written } = await walk(index, {
    cells: ['N52E004', 'S40W030'],
    rows: { 0: [record('N52E004', 'a')] },
  })
  assert.deepEqual(
    written.map(one => ({ cell: one.cell, at: one.at })),
    [
      { cell: 'S40W030', at: 0 },
      { cell: 'N52E004', at: 1 },
    ],
  )
  assert.equal(totals.cells, 2)
  assert.equal(totals.empty, 1)
})

test('a row belonging to a cell nobody asked for is dropped, not held for ever', async () => {
  const index = indexOf(box(0, 2, 4.1, 52.1, 5.9, 52.9))
  const { totals, written } = await walk(index, {
    cells: ['N52E004'],
    rows: { 0: [record('N52E004', 'a'), record('N52E005', 'b'), { cell: 'nonsense', key: 'c' }] },
  })
  assert.deepEqual(written, [{ cell: 'N52E004', at: 1, places: ['a'] }])
  assert.equal(totals.kept, 1)
  assert.equal(totals.dropped, 2)
})

test('stopping leaves the open cells unwritten and says how many', async () => {
  const index = indexOf(
    box(0, 2, 4.1, 52.1, 4.9, 52.9),
    box(2, 4, 5.1, 52.1, 5.9, 52.9),
    box(4, 6, 6.1, 52.1, 6.9, 52.9),
  )
  const { totals, written } = await walk(index, {
    rows: {
      0: [record('N52E004', 'a')],
      2: [record('N52E005', 'b')],
      4: [record('N52E006', 'c')],
    },
    stopAfter: 1,
  })
  assert.deepEqual(
    written.map(one => one.cell),
    ['N52E004'],
  )
  assert.equal(totals.interrupted, true)
  /* The two it never reached keep whatever coverage status they had, which is
     what makes --resume pick them up rather than trust them. */
  assert.equal(totals.unfinished, 2)
})

test('a failing read stops the sweep rather than silently loading half a cell', async () => {
  const index = indexOf(box(0, 2, 4.1, 52.1, 4.9, 52.9), box(2, 4, 4.1, 52.1, 4.9, 52.9))
  const plan = sweepPlan(index)
  const swept = createSweep({
    plan,
    read: async (_part, group) => {
      if (group.s === 2) throw new Error('503 from the bucket')
      return [record('N52E004', 'a')]
    },
    load: async () => assert.fail('nothing should have been written'),
  })
  await assert.rejects(swept.run(), /503 from the bucket/)
})

/* ---- against a real database ------------------------------------------- */

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
  databaseUrl = await privateDatabase(baseUrl, 'sweep')
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

/* The fixture rows, cut into row groups the way a real part is: each group a
   contiguous run of rows with the bounding box those rows actually have. */
function partFor(rows, per) {
  const groups = []
  for (let at = 0; at < rows.length; at += per) {
    const slice = rows.slice(at, at + per)
    groups.push({
      s: at,
      e: at + slice.length,
      xmin: Math.min(...slice.map(one => one.bbox.xmin)),
      ymin: Math.min(...slice.map(one => one.bbox.ymin)),
      xmax: Math.max(...slice.map(one => one.bbox.xmax)),
      ymax: Math.max(...slice.map(one => one.bbox.ymax)),
    })
  }
  const part = {
    url: 'https://example.invalid/overture-0.parquet',
    size: 1000,
    xmin: Math.min(...groups.map(one => one.xmin)),
    ymin: Math.min(...groups.map(one => one.ymin)),
    xmax: Math.max(...groups.map(one => one.xmax)),
    ymax: Math.max(...groups.map(one => one.ymax)),
    groups,
  }
  return { source: 'overture', parts: [part] }
}

/** A reader that answers both questions the two paths ask: a box, and a group. */
function readerFor(rows, index) {
  return {
    readBox: async (_index, bounds) =>
      rows.filter(
        one =>
          one.bbox.xmin >= bounds.west &&
          one.bbox.xmin <= bounds.east &&
          one.bbox.ymin >= bounds.south &&
          one.bbox.ymin <= bounds.north,
      ),
    readGroup: async (part, group) => {
      assert.equal(part.url, index.parts[0].url)
      return rows.slice(group.s, group.e)
    },
  }
}

const shape = async pool =>
  (
    await pool.query(
      `select p.gers_id, p.name, p.category, p.website, p.phone, p.cell, p.confidence,
              st_x(p.geom::geometry) as lng, st_y(p.geom::geometry) as lat,
              (select count(*) from place_sources s where s.place_id = p.id)::int as sources
       from places p order by p.gers_id`,
    )
  ).rows

const coverage = async pool =>
  (await pool.query('select cell, status, place_count, quality from place_coverage order by cell'))
    .rows

test('a swept cell is the same rows, the same coverage and the same quality as a read one', {
  skip: unreachable,
}, async t => {
  const index = partFor(OVERTURE_ROWS, 2)
  const releases = { overture: { version: '2026-08-19.10', index } }
  /* A square with places, a square with one, and a square of open sea that
       neither path has any rows for: the third is where the two used to
       disagree, because a sweep can only reach a square a row group names. */
  const cells = ['N52E004', 'N52E005', 'S40W030']

  const byCell = await freshDatabase(t)
  const one = createIngest({
    pool: byCell,
    reader: readerFor(OVERTURE_ROWS, index),
    releases,
    now: () => new Date(NOW),
  })
  for (const cell of cells) assert.notEqual((await one.ingestCell(cell)).status, 'failed')
  const cellRows = await shape(byCell)
  const cellCoverage = await coverage(byCell)

  /* The same schema, dropped and rebuilt, so the two runs are compared on
       an empty table rather than on each other's rows. */
  const bySweep = await freshDatabase(t)
  const other = createIngest({
    pool: bySweep,
    reader: readerFor(OVERTURE_ROWS, index),
    releases,
    now: () => new Date(NOW),
  })
  const swept = createSweep({
    plan: sweepPlan(index, { cells }),
    read: other.readSwept,
    load: other.loadSwept,
  })
  const totals = await swept.run()
  assert.equal(totals.failed, 0)
  assert.equal(totals.unfinished, 0)
  /* Four rows over two groups: read once each, not once per cell. */
  assert.equal(totals.groups, index.parts[0].groups.length)

  assert.ok(cellRows.length > 0, 'the fixture loaded something to compare')
  assert.deepEqual(await shape(bySweep), cellRows)
  assert.deepEqual(await coverage(bySweep), cellCoverage)
})

test('a sweep refuses to load into an ingest that has a second source', {
  skip: unreachable,
}, async t => {
  const pool = await freshDatabase(t)
  const index = partFor(OVERTURE_ROWS, 2)
  const both = createIngest({
    pool,
    reader: readerFor(OVERTURE_ROWS, index),
    releases: {
      overture: { version: '2026-08-19.10', index },
      fsq: { version: '2026-08-05', index: { source: 'fsq', parts: [] } },
    },
  })
  await assert.rejects(both.loadSwept('N52E004', []), /two sources are clustered together/)
  /* And nothing was written on the way to refusing. */
  assert.deepEqual(await coverage(pool), [])
})
