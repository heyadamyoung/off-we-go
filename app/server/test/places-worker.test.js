import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { createPlaceWorker } from '../src/places/worker.js'
import { privateDatabase } from './private-database.js'

/* The thing that drains the coverage queue on the box that serves queries.
 *
 * Against a real database, because every one of its four rules is a
 * statement: which rows a tick claims, which it leaves alone, which it
 * recovers from a process that died, and which it marks stale when the
 * release moves on. A fake pool would be a test of the fake.
 *
 * The ingest itself is stubbed. What it does with a cell is proved next door
 * in places-ingest.test.js; what is being proved here is which cells it is
 * handed and what happens around that. */

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
  databaseUrl = await privateDatabase(baseUrl, 'placesworker')
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

/** A coverage row, said in full so each test states the case it means. */
async function coverage(pool, cell, row = {}) {
  await pool.query(
    `insert into place_coverage
      (cell, west, south, east, north, status, requested_at, started_at, last_refresh, attempts,
       versions, next_attempt_at)
     values ($1, 0, 0, 1, 1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (cell) do update set
       status = excluded.status, requested_at = excluded.requested_at,
       started_at = excluded.started_at, last_refresh = excluded.last_refresh,
       attempts = excluded.attempts, versions = excluded.versions,
       next_attempt_at = excluded.next_attempt_at`,
    [
      cell,
      row.status ?? 'pending',
      row.requestedAt ?? new Date(),
      row.startedAt ?? null,
      row.lastRefresh ?? null,
      row.attempts ?? 0,
      JSON.stringify(row.versions ?? {}),
      row.nextAttemptAt ?? null,
    ],
  )
}

const statusOf = async (pool, cell) =>
  (await pool.query('select status from place_coverage where cell = $1', [cell])).rows[0]?.status

/** A worker whose ingest records what it was handed and does nothing else. */
function workerOver(pool, options = {}) {
  const handed = []
  const worker = createPlaceWorker({
    pool,
    loadIndex: async () => ({ source: 'overture', version: '2026-08-19.0', index: { parts: [] } }),
    loadSecondIndex: null,
    makeReader: () => ({ readBox: async () => {} }),
    makeIngest: ({ releases }) => ({
      versions: { overture: releases.overture.version },
      /* The claim has already moved these rows to `ingesting`; the real
         ingest finishes by writing `ready` in its own transaction, so the
         stand-in does the same or every later tick would find them stuck. */
      ingestCells: async cells => {
        handed.push(...cells)
        for (const cell of cells) {
          await pool.query(
            "update place_coverage set status = 'ready', attempts = 0, last_refresh = now(), " +
              'versions = $2::jsonb where cell = $1',
            [cell, JSON.stringify({ overture: releases.overture.version })],
          )
        }
        return { results: cells.map(cell => ({ cell, status: 'ready', places: 1 })) }
      },
      stop: () => {},
    }),
    ...options,
  })
  return { worker, handed }
}

/** A place with no zoom, of the kind that predates the column. */
async function unplaced(pool, name, lng, lat, category = 'museum', confidence = 0.8) {
  await pool.query(
    `insert into places (gers_id, name, geom, category, category_raw, confidence, cell)
     values ($1, $2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5, $5, $6, 'N52E004')`,
    [
      `overture:${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
      name,
      lng,
      lat,
      category,
      confidence,
    ],
  )
}

test('places written before the zoom column get their zoom', {
  skip: unreachable,
  concurrency: false,
}, async t => {
  await t.test('a tick places them, and throws away the tiles drawn without them', async t => {
    const pool = await freshDatabase(t)
    /* Enough in one 1° cell that the per-tile budget has to choose. */
    for (let at = 0; at < 40; at += 1) {
      await unplaced(pool, `Museum ${at}`, 4.88 + at * 0.0002, 52.36 + at * 0.0002)
    }
    await pool.query(
      `insert into place_tiles (z, x, y, body, places, built_at)
       values (12, 2096, 1343, $1, 40, now())`,
      [Buffer.from('a tile drawn from zooms that were wrong')],
    )

    const { worker } = workerOver(pool)
    await worker.once()
    await worker.settled()

    const { rows } = await pool.query(
      'select count(*) filter (where label_zoom is null)::int as unplaced, ' +
        'count(distinct label_zoom)::int as distinct_zooms from places',
    )
    assert.equal(rows[0].unplaced, 0, 'every place has the zoom it earns')
    assert.ok(rows[0].distinct_zooms > 1, 'and they did not all earn the same one')

    const tiles = await pool.query('select count(*)::int as left from place_tiles')
    assert.equal(tiles.rows[0].left, 0, 'the tiles built from the old zooms are gone')
  })

  await t.test('a second tick does not run the pass again', async t => {
    const pool = await freshDatabase(t)
    await unplaced(pool, 'Rijksmuseum', 4.8852, 52.36)
    const { worker } = workerOver(pool)
    await worker.once()
    await worker.settled()

    /* A tile built after the pass survives, which is how we know the pass
       did not run a second time and throw it away. */
    await pool.query(
      `insert into place_tiles (z, x, y, body, places, built_at)
       values (12, 2096, 1343, $1, 1, now())`,
      [Buffer.from('built from the zooms as they now are')],
    )
    await worker.once()
    await worker.settled()
    const tiles = await pool.query('select count(*)::int as left from place_tiles')
    assert.equal(tiles.rows[0].left, 1, 'nothing to place, so nothing thrown away')
  })

  await t.test('stopping waits for the pass rather than cutting it off', async t => {
    const pool = await freshDatabase(t)
    await unplaced(pool, 'Van Gogh Museum', 4.881, 52.3584)
    const { worker } = workerOver(pool)
    await worker.once()
    await worker.stop()
    const { rows } = await pool.query(
      'select count(*) filter (where label_zoom is null)::int as unplaced from places',
    )
    assert.equal(rows[0].unplaced, 0, 'the pass finished before stop() returned')
  })
})

test('the queue drainer', { skip: unreachable, concurrency: false }, async t => {
  await t.test('takes the cells that are waiting, oldest ask first', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N52E004', { requestedAt: new Date('2026-09-01') })
    await coverage(pool, 'N52E005', { requestedAt: new Date('2026-09-02') })
    await coverage(pool, 'N51E004', { status: 'ready', versions: { overture: '2026-08-19.0' } })
    const { worker, handed } = workerOver(pool)
    await worker.once()
    assert.deepEqual(handed, ['N52E004', 'N52E005'])
  })

  await t.test('does a few cells a tick, not the whole queue', async t => {
    const pool = await freshDatabase(t)
    for (let at = 0; at < 12; at += 1) {
      await coverage(pool, `N52E0${String(at).padStart(2, '0')}`, {
        requestedAt: new Date(2026, 8, 1, 0, at),
      })
    }
    const { worker, handed } = workerOver(pool, { cellsPerTick: 3 })
    await worker.once()
    assert.equal(handed.length, 3)
  })

  await t.test('retries a failed cell once its wait has passed, and not before', async t => {
    const pool = await freshDatabase(t)
    const hence = at => new Date(Date.now() + at)
    await coverage(pool, 'N52E004', {
      status: 'failed',
      attempts: 1,
      nextAttemptAt: hence(-60_000),
    })
    await coverage(pool, 'N52E005', {
      status: 'failed',
      attempts: 2,
      nextAttemptAt: hence(10 * 60_000),
    })
    const { worker, handed } = workerOver(pool)
    await worker.once()
    assert.deepEqual(handed, ['N52E004'], 'the one that is due, and only that one')
  })

  /* The point of the change: no number of failures takes a cell out of the
     queue. Paris was found in production `failed` at the old cap of five — a
     capital with nothing behind it and nothing that would ever ask again. */
  await t.test('takes a cell that has failed a hundred times, once it is due', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N48E002', {
      status: 'failed',
      attempts: 100,
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    const { worker, handed } = workerOver(pool)
    await worker.once()
    assert.deepEqual(handed, ['N48E002'])
  })

  /* And the rows that predate the column have waited longer than any backoff,
     so they are due now rather than never. */
  await t.test('a failure with no wait written on it is due at once', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N52E004', {
      status: 'failed',
      attempts: 9,
      requestedAt: new Date('2026-01-01'),
      nextAttemptAt: null,
    })
    const { worker, handed } = workerOver(pool)
    await worker.once()
    assert.deepEqual(handed, ['N52E004'])
  })

  /* The case that would otherwise starve the queue: old failures sort ahead
     of everything on requested_at, so a window filled by them is a window a
     traveller's cell never reaches. */
  await t.test('never lets old failures crowd out a cell somebody just asked for', async t => {
    const pool = await freshDatabase(t)
    for (let at = 0; at < 6; at += 1) {
      await coverage(pool, `S01E00${at}`, {
        status: 'failed',
        attempts: 1,
        requestedAt: new Date('2026-01-01'),
        nextAttemptAt: new Date('2026-01-01'),
      })
    }
    await coverage(pool, 'N52E004', { requestedAt: new Date() })
    const { worker, handed } = workerOver(pool, { cellsPerTick: 2 })
    await worker.once()
    assert.ok(handed.includes('N52E004'), `${handed.join(',')} does not include the fresh ask`)
    assert.equal(handed.length, 2)
  })

  await t.test('queues again a cell a stopped process left half done', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N52E004', {
      status: 'ingesting',
      startedAt: new Date(Date.now() - 60 * 60_000),
    })
    await coverage(pool, 'N52E005', { status: 'ingesting', startedAt: new Date() })
    const { worker, handed } = workerOver(pool)
    await worker.once()
    assert.deepEqual(handed, ['N52E004'], 'the one still in flight must be left alone')
    assert.equal(await statusOf(pool, 'N52E005'), 'ingesting')
  })

  /* The claim is the thing that makes two drains safe, so it is stated: a
     cell taken by one tick is not offered to the next. */
  await t.test('a cell taken by one tick is not offered to the next', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N52E004')
    const first = createPlaceWorker({
      pool,
      loadIndex: async () => ({ source: 'overture', version: 'v', index: { parts: [] } }),
      makeReader: () => ({}),
      makeIngest: () => ({
        versions: { overture: 'v' },
        /* Takes the cell and never finishes with it, the way a process that
           is about to be killed does. */
        ingestCells: async () => ({ results: [] }),
        stop: () => {},
      }),
    })
    await first.once()
    assert.equal(await statusOf(pool, 'N52E004'), 'ingesting')
    const { worker, handed } = workerOver(pool)
    await worker.once()
    assert.deepEqual(handed, [], 'a second drain must not take a claimed cell')
  })

  await t.test('marks ready cells stale when the release moves on, a few at a time', async t => {
    const pool = await freshDatabase(t)
    for (let at = 0; at < 5; at += 1) {
      await coverage(pool, `N40E00${at}`, {
        status: 'ready',
        versions: { overture: '2026-07-22.0' },
        lastRefresh: new Date(2026, 6, 22, at),
      })
    }
    await coverage(pool, 'N41E000', {
      status: 'ready',
      versions: { overture: '2026-08-19.0' },
      lastRefresh: new Date(),
    })
    const { worker } = workerOver(pool, { refreshPerTick: 2, cellsPerTick: 0 })
    await worker.once()
    const stale = await pool.query("select cell from place_coverage where status = 'stale'")
    assert.equal(stale.rowCount, 2)
    assert.deepEqual(
      stale.rows.map(row => row.cell).sort(),
      ['N40E000', 'N40E001'],
      'oldest refresh first',
    )
    assert.equal(await statusOf(pool, 'N41E000'), 'ready', 'a current cell is not disturbed')
  })

  await t.test('without a release it drains nothing and says so once', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N52E004')
    const said = []
    const worker = createPlaceWorker({
      pool,
      loadIndex: async () => null,
      log: message => said.push(message),
      makeIngest: () => assert.fail('an ingest must not be built without a release'),
    })
    await worker.once()
    await worker.once()
    assert.equal(said.length, 1, said.join(' | '))
    assert.match(said[0], /no upstream release/)
    assert.equal(await statusOf(pool, 'N52E004'), 'pending')
  })

  /* A tick runs on a timer with nobody to catch it. An unhandled rejection
     from a bucket having a bad afternoon would take the API server with it. */
  await t.test('a tick never throws', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N52E004')
    const said = []
    const worker = createPlaceWorker({
      pool,
      loadIndex: async () => ({ source: 'overture', version: 'v', index: { parts: [] } }),
      makeReader: () => ({}),
      makeIngest: () => ({
        versions: { overture: 'v' },
        ingestCells: async () => {
          throw new Error('the bucket is having a bad afternoon')
        },
        stop: () => {},
      }),
      log: message => said.push(message),
    })
    await worker.once()
    assert.ok(
      said.some(line => line.includes('bad afternoon')),
      said.join(' | '),
    )
  })
})
