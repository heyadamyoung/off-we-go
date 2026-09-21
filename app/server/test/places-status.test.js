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
import { enrichmentCensus } from '../src/places/enrich/store.js'
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
  await pool.query(
    `insert into place_enrichment (place_id, status, pipeline) values ($1, 'ready', 1)`,
    [museum],
  )

  const census = await enrichmentCensus(pool, { leading: 1 })
  assert.equal(census.prominent, 2)
  assert.equal(census.withWords, 1)
  assert.equal(census.toReach, 1, 'the launderette has not been asked about')
  /* The rank check, which is the point. Of the single highest-ranked place,
     one has words — so the ordering put the museum in front. Were the order
     random this would be the overall proportion instead. */
  assert.deepEqual(census.leading, { of: 1, withWords: 1 })

  const status = await app.inject({ method: 'GET', url: '/api/places/status' })
  assert.equal(status.statusCode, 200, status.body)
  const body = status.json()
  assert.equal(body.enrichment.withWords, 1)
  /* `of` is the size of the leading set that actually exists, not the limit
     asked for — two places here, both of them in front of nothing. The
     denominator is what was examined, which is the only denominator a
     proportion can honestly use. */
  assert.deepEqual(body.enrichment.leading, { of: 2, withWords: 1 })
  /* An estimate, and the route never pretends otherwise: counting rows over a
     planet is what took deploy 387 past the time it was allowed. */
  assert.ok(Number.isFinite(body.planet.places))
  assert.equal(body.planet.cells.of, 53333)
  assert.ok(Array.isArray(body.attribution), 'the layer can always state its licences')
})

test('the layer can be counted without counting every row', { skip: reachable }, async t => {
  const { repository } = await world(t)
  const held = await planetHeld(repository.pool)
  assert.equal(typeof held.places, 'number')
  assert.equal(typeof held.cells, 'object')
})
