import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { createPlaceWorker, MAX_ATTEMPTS } from '../src/places/worker.js'
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
      (cell, west, south, east, north, status, requested_at, started_at, last_refresh, attempts, versions)
     values ($1, 0, 0, 1, 1, $2, $3, $4, $5, $6, $7)
     on conflict (cell) do update set
       status = excluded.status, requested_at = excluded.requested_at,
       started_at = excluded.started_at, last_refresh = excluded.last_refresh,
       attempts = excluded.attempts, versions = excluded.versions`,
    [
      cell,
      row.status ?? 'pending',
      row.requestedAt ?? new Date(),
      row.startedAt ?? null,
      row.lastRefresh ?? null,
      row.attempts ?? 0,
      JSON.stringify(row.versions ?? {}),
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
      ingestCells: async cells => {
        handed.push(...cells)
        return { results: cells.map(cell => ({ cell, status: 'ready', places: 1 })) }
      },
      stop: () => {},
    }),
    ...options,
  })
  return { worker, handed }
}

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

  await t.test('retries a failed cell, but not for ever', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N52E004', { status: 'failed', attempts: 1 })
    await coverage(pool, 'N52E005', { status: 'failed', attempts: MAX_ATTEMPTS })
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
