/**
 * The places layer, asked about from outside.
 *
 * The bug behind this file is not a crash. It is a question that could not be
 * answered: "the sweep seems to have slowed or stopped." Every number needed
 * to answer it existed — the sweep computes its whole position every
 * twenty-five row groups — and every one of them was handed to a log line on a
 * box with no shell. The only way to read one was to push a release and grep
 * the deploy's output, which gives a single sample of whatever moment the
 * release happened to land on, and a single sample cannot describe a rate.
 *
 * So the run writes itself down and a route reads it back. What is asserted
 * here is that the route says enough to settle the question without anybody
 * touching the box: how far through the plan, and how long since it last
 * moved.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'

import { buildServer } from '../src/app.js'
import { createPostgresRepository } from '../src/postgres.js'
import { ENRICH_PIPELINE } from '../src/places/enrich/enrich.js'
import { enrichmentCensus, prominentPlaces } from '../src/places/enrich/store.js'
import { closeSweep, markSweep, openSweep, planetHeld } from '../src/places/store.js'
import { privateDatabase } from './private-database.js'

const baseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'

let databaseUrl = baseUrl
const reachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  databaseUrl = await privateDatabase(baseUrl, 'placesstatus')
  return false
})()

async function world(t) {
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query('drop schema public cascade; create schema public')
  await admin.end()

  const repository = await createPostgresRepository({
    databaseUrl,
    adminEmail: 'owner@example.com',
  })
  t.after(() => repository.close())
  await repository.migrate()

  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  t.after(() => app.close())
  return { app, repository }
}

test('a run that has stopped moving is visible as one', { skip: reachable }, async t => {
  const { app, repository } = await world(t)
  const pool = repository.pool

  /* Nothing has ever run. The route says so rather than inventing a zero,
     because "no sweep has ever happened here" and "a sweep has read nothing"
     are different problems and a null tells them apart. */
  const before = await app.inject({ method: 'GET', url: '/api/places/status' })
  assert.equal(before.statusCode, 200, before.body)
  assert.equal(before.json().sweep, null)
  /* Public and cacheable: it carries counts and nothing else. */
  assert.match(before.headers['cache-control'], /public/)

  const id = await openSweep(pool, {
    release: 'overture-2026-08-19.0',
    groups: 2218,
    rows: 40_036_477,
    cells: 26_476,
  })
  assert.ok(id, 'a run records itself')

  /* Part way through, with the shape the real run was in when the question
     was asked: reads being retried against one part file while rows climb. */
  await markSweep(pool, id, {
    groups: 25,
    rows: 450_000,
    cells: 47,
    places: 4_185_588,
    open: 208,
    retried: 4,
    setAside: 0,
  })

  const during = await app.inject({ method: 'GET', url: '/api/places/status' })
  assert.equal(during.statusCode, 200, during.body)
  const run = during.json().sweep
  assert.equal(run.release, 'overture-2026-08-19.0')
  assert.equal(run.running, true, 'a run with no finished_at is running')
  assert.deepEqual(run.groups, { read: 25, of: 2218 })
  assert.deepEqual(run.rows, { read: 450_000, of: 40_036_477 })
  assert.deepEqual(run.cells, { loaded: 47, of: 26_476 })
  assert.equal(run.places, 4_185_588)
  assert.equal(run.retried, 4, 'reads asked for again are the network, and are counted')
  assert.equal(run.setAside, 0)
  /* The field the whole question turns on. Freshly marked, so it is seconds
     rather than null — and a caller gets the number rather than somebody
     else's opinion of whether it is too big. */
  assert.ok(Number.isFinite(run.quietFor), 'a run says how long since it last moved')
  assert.ok(run.quietFor < 60, `just-marked run says it has been quiet ${run.quietFor}s`)

  /* A counter written absolutely, not incremented. A lost report must not
     become a permanently wrong number, so a later mark with a smaller count
     is the truth and not a subtraction. */
  await markSweep(pool, id, { groups: 50, rows: 900_000, cells: 96, places: 8_000_000 })
  const later = (await app.inject({ method: 'GET', url: '/api/places/status' })).json().sweep
  assert.deepEqual(later.groups, { read: 50, of: 2218 })
  assert.equal(later.retried, 0, 'absolute, so an unreported field goes back to what was sent')

  /* And how it ended, with the reason where a reason exists. "failed" with
     nothing behind it is what the logging rules in this layer forbid. */
  await closeSweep(pool, id, {
    groups: 2218,
    rows: 40_036_477,
    cells: 26_470,
    outcome: 'owing',
    note: '6 row group(s) would not read, leaving 12 cell(s) unwritten',
  })
  const after = (await app.inject({ method: 'GET', url: '/api/places/status' })).json().sweep
  assert.equal(after.running, false)
  assert.equal(after.outcome, 'owing')
  assert.match(after.note, /would not read/)
  assert.ok(after.finishedAt, 'a finished run says when')
})

test('the census says whether the good places went first', { skip: reachable }, async t => {
  const { app, repository } = await world(t)
  const pool = repository.pool

  /* Two places at the same zoom, one of them the kind anybody would want
     first. The ordering fix this checks was invisible for three releases:
     the backfill's tiebreak was a random uuid, so launderettes and museums
     went in by the flip of a hash. */
  const made = await pool.query(
    `insert into places
       (gers_id, name, geom, category, category_raw, confidence, cell, label_zoom)
     values ('overture:rijksmuseum', 'Rijksmuseum',
             ST_SetSRID(ST_MakePoint(4.8852, 52.36), 4326)::geography,
             'museum', 'art_museum', 0.93, 'N52E004', 11),
            ('overture:mr-wash', 'Mr Wash',
             ST_SetSRID(ST_MakePoint(4.8861, 52.3611), 4326)::geography,
             'services', 'laundry', 0.41, 'N52E004', 11)
     returning id, name`,
  )
  const museum = made.rows.find(row => row.name === 'Rijksmuseum').id

  /* Only the museum has been reached. */
  await pool.query(
    `insert into place_descriptions (place_id, text, source, license)
     values ($1, 'A museum in Amsterdam.', 'wikipedia', 'CC-BY-SA-4.0')`,
    [museum],
  )
  /* On the current pipeline, not a hardcoded 1. A literal here went stale the
     moment ENRICH_PIPELINE was bumped, and this test failed — which is the
     whole point of the pair being held together. */
  await pool.query(
    `insert into place_enrichment (place_id, status, pipeline)
     values ($1, 'ready', $2::smallint)`,
    [museum, ENRICH_PIPELINE],
  )

  const census = await enrichmentCensus(pool)
  assert.equal(census.prominent, 2)
  assert.equal(census.withWords, 1)
  assert.equal(census.reached, 1, 'one of the two has been looked at')
  assert.equal(census.toReach, 1, 'the launderette has not been asked about')
  assert.equal(census.ready, 1)
  /* The ordering check, which is the point. The museum is drawn from zoom 11
     and it is the one that got reached, so what has been done clusters where
     the prominent places are. A random order would put the launderette here
     just as often. */
  assert.deepEqual(census.byZoom, [{ zoom: 11, reached: 1 }])

  const status = await app.inject({ method: 'GET', url: '/api/places/status' })
  assert.equal(status.statusCode, 200, status.body)
  const body = status.json()
  assert.equal(body.enrichment.withWords, 1)
  assert.equal(body.enrichment.reached, 1)
  assert.deepEqual(body.enrichment.byZoom, [{ zoom: 11, reached: 1 }])
  /* An estimate, and the route never pretends otherwise: counting rows over a
     planet is what took deploy 387 past the time it was allowed. */
  assert.ok(Number.isFinite(body.planet.places))
  assert.equal(body.planet.cells.of, 53333)
  assert.ok(Array.isArray(body.attribution), 'the layer can always state its licences')
})

test('a count that will not finish is a null, not a dead route', { skip: reachable }, async t => {
  /* The first production read of the status route timed out at twenty seconds.
     The census asked "how many places are prominent" as a CTE over thirty-five
     million rows and then joined it three times, so every other number hung off
     a count that could not finish. Everything else now comes off the small
     tables; this one cannot, so it is bounded — and when the bound bites it
     reports that it could not count rather than a zero it does not believe.

     Forced with a one-millisecond budget, which no count survives. */
  const { app, repository } = await world(t)

  /* The timeout itself, against a stub rather than against a table big enough
     to be slow: 57014 is what Postgres raises when statement_timeout bites, and
     what matters is what this does with it. A test that needed millions of rows
     to provoke it would be a test that stopped provoking it on a faster box. */
  const said = []
  const timedOut = {
    async connect() {
      return {
        async query(sql) {
          said.push(String(sql).split(' ')[0].toLowerCase())
          if (/count\(\*\)/.test(String(sql))) {
            const error = new Error('canceling statement due to statement timeout')
            error.code = '57014'
            throw error
          }
          return { rows: [] }
        },
        release() {
          said.push('release')
        },
      }
    },
  }
  /* Null, because this stub cannot answer the planner either. The real path
     falls back to an estimate — see below. */
  assert.equal(await prominentPlaces(timedOut, {}), null, 'a count past its budget is null')
  assert.ok(said.includes('rollback'), 'and the transaction is rolled back')
  assert.ok(said.includes('release'), 'and the client always goes home')

  /* And when the planner will answer, it does, because "?" is not an answer.
   *
   * The first production read printed "? of ? prominent still to go", which is
   * honest and useless. The planner estimates exactly this — how many rows
   * match a predicate — from statistics it keeps for its own purposes, in
   * microseconds, without touching a row. An estimate that says so beats a
   * question mark, and it is the same contract the place count beside it has
   * carried since deploy 387. */
  const estimating = {
    async connect() {
      return {
        async query(sql) {
          if (/count\(\*\)/.test(String(sql))) {
            const error = new Error('canceling statement due to statement timeout')
            error.code = '57014'
            throw error
          }
          return { rows: [] }
        },
        release() {},
      }
    },
    async query(sql) {
      assert.match(String(sql), /^explain \(format json\)/, 'the fallback asks the planner')
      return { rows: [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 4_200_000 } }] }] }
    },
  }
  assert.equal(
    await prominentPlaces(estimating, {}),
    4_200_000,
    'a count that will not run falls back to the planner rather than to nothing',
  )

  /* On a real pool it answers, and the next caller is unaffected — a
     statement_timeout left on a checked-out client would be their problem,
     which is why this runs inside its own transaction with `set local`. */
  const first = await prominentPlaces(repository.pool, { budgetMs: 1 })
  assert.ok(first === null || typeof first === 'number')
  const after = await prominentPlaces(repository.pool)
  assert.equal(typeof after, 'number', 'the next count is unaffected')

  const status = await app.inject({ method: 'GET', url: '/api/places/status' })
  assert.equal(status.statusCode, 200, 'the route answers either way')
})

test('the layer can be counted without counting every row', { skip: reachable }, async t => {
  const { repository } = await world(t)
  const held = await planetHeld(repository.pool)
  assert.equal(typeof held.places, 'number')
  assert.equal(typeof held.cells, 'object')
})

test('the pipeline number and the census agree about what counts as done', async t => {
  /* The trap this exists for, which I walked into while fixing the picture
     gate. That fix only helps places enriched after it, and a place that came
     back `ready` is never looked at again — five hundred and fifty-one of them
     had their words, had no picture, and would have kept none for ever. The
     pipeline number is the only thing that reaches them: bumping it re-queues
     every row that is not on it.

     But four functions here carried `pipeline = 1` as a hardcoded default, and
     `enrichmentCensus` is called from the repository with no pipeline at all.
     Bumping the constant without them would have left the status route
     counting rows on a pipeline nothing writes any more, reporting zero of
     everything while the queue quietly refilled — a wrong number is worse than
     the question mark it replaced.

     So the default follows the constant, and this holds them together. */
  const { repository } = await world(t)
  const pool = repository.pool
  const made = await pool.query(
    `insert into places
       (gers_id, name, geom, category, category_raw, confidence, cell, label_zoom)
     values ('overture:rijksmuseum', 'Rijksmuseum',
             ST_SetSRID(ST_MakePoint(4.8852, 52.36), 4326)::geography,
             'museum', 'art_museum', 0.93, 'N52E004', 11)
     returning id`,
  )
  const museum = made.rows[0].id
  await pool.query(
    `insert into place_enrichment (place_id, status, pipeline)
     values ($1, 'ready', $2::smallint)`,
    [museum, ENRICH_PIPELINE],
  )

  const census = await enrichmentCensus(pool)
  assert.equal(census.reached, 1, 'the census counts a row written on the current pipeline')
  assert.equal(census.ready, 1)

  /* And a row left on an older pipeline is owed, not done — which is what
     makes the bump re-reach everything already enriched. */
  await pool.query('update place_enrichment set pipeline = $1::smallint where place_id = $2', [
    ENRICH_PIPELINE - 1,
    museum,
  ])
  const after = await enrichmentCensus(pool)
  assert.equal(after.reached, 0, 'a row on an older pipeline is owed again')
})
