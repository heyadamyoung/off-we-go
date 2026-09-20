import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import pg from 'pg'
import { CONFIDENCE_FLOOR, LABEL_ZOOMS, VIEW_WEIGHT } from '../src/places/rank.js'
import { nearbyPlaces, placesInView, placeTile } from '../src/places/store.js'
import { privateDatabase } from './private-database.js'

/* That the map's questions are answered by the index and not by the heap.
 *
 * Every statement here was correct before this file existed and every one of
 * them was slow, which is the only reason it exists: a predicate the index
 * cannot serve is never an error, it is the same answer arrived at by reading
 * the whole viewport. Measured on one cell of 302,979 places, a phone-sized
 * box over central Paris held 84,227 of them and wanted 56, and the 98 ms was
 * the other 84,171.
 *
 * So what is asserted is the shape of the plan, not a duration. A timing test
 * on a laptop with ten rows in it proves nothing and fails on a busy machine;
 * `Index Cond` either contains the zoom or it does not, and that is the whole
 * difference. `enable_seqscan = off` is on for the same reason — with a
 * handful of rows Postgres will read them all whatever the index says, and
 * the question being asked is what the index is *able* to answer.
 */

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
  databaseUrl = await privateDatabase(baseUrl, 'placesindex')
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

/* A few hundred places around one point, spread over a tenth of a degree and
   over every zoom tier, so that a viewport asking for one tier has something
   to leave behind. */
async function fill(pool, { centre = [2.3522, 48.8566], count = 400 } = {}) {
  const rows = []
  for (let i = 0; i < count; i += 1) {
    const lng = centre[0] + ((i % 20) - 10) * 0.004
    const lat = centre[1] + (Math.floor(i / 20) - 10) * 0.004
    rows.push([
      `place ${i}`,
      lng,
      lat,
      i % 3 === 0 ? 'museum' : i % 3 === 1 ? 'cafe' : 'shopping',
      0.9,
      'N48E002',
      LABEL_ZOOMS.from + (i % (LABEL_ZOOMS.floor - LABEL_ZOOMS.from + 1)),
    ])
  }
  await pool.query(
    `insert into places (name, geom, category, confidence, cell, label_zoom)
     select name, ST_MakePoint(lng, lat)::geography, category, confidence, cell, label_zoom
     from unnest($1::text[], $2::float8[], $3::float8[], $4::text[], $5::real[], $6::text[],
                 $7::real[]) as t(name, lng, lat, category, confidence, cell, label_zoom)`,
    [0, 1, 2, 3, 4, 5, 6].map(column => rows.map(row => row[column])),
  )
  await pool.query('analyze places')
}

/** The statement a store function composes, and the plan Postgres makes of
    it. The SQL is captured from the real call rather than copied here, so a
    query that stops matching the index fails this test and not a comment. */
function planner(pool) {
  const seen = []
  const db = {
    async query(sql, args) {
      seen.push({ sql, args })
      return pool.query(sql, args)
    },
  }
  return {
    db,
    async plan() {
      const last = seen.at(-1)
      const client = await pool.connect()
      try {
        await client.query('set enable_seqscan = off')
        const explained = await client.query(`explain (analyze, buffers) ${last.sql}`, last.args)
        return explained.rows.map(row => row['QUERY PLAN']).join('\n')
      } finally {
        client.release()
      }
    },
    get sql() {
      return seen.at(-1)?.sql ?? ''
    },
  }
}

const box = { west: 2.3, south: 48.82, east: 2.4, north: 48.89 }

test('places index', { skip: unreachable }, async t => {
  await t.test('the migration and the queries spell the zoom the same way', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const sql = await readFile(
      path.join(here, '..', 'migrations', '051_the_index_carries_the_zoom.sql'),
      'utf8',
    )
    const built = sql.match(/on places using gist \(geom, \((.+)\)\)\s*;/)
    assert.ok(built, 'migration 051 builds an index on geom and an expression')
    /* The index has no alias and the queries do; everything else about the
       two strings has to be identical, because Postgres matches an
       expression index on its text. */
    assert.equal(built[1], `coalesce(label_zoom, ${LABEL_ZOOMS.from}::real)`)
  })

  await t.test('a viewport asks the index for the box and the zoom together', async t => {
    const pool = await freshDatabase(t)
    await fill(pool)
    const watch = planner(pool)
    const rows = await placesInView(watch.db, box, {
      zoom: 12,
      floor: CONFIDENCE_FLOOR,
      weights: VIEW_WEIGHT,
    })
    assert.ok(rows.length > 0, 'the viewport holds something')
    assert.ok(
      rows.every(place => place.labelZoom <= 12),
      'and nothing that has not earned this zoom',
    )
    const plan = await watch.plan()
    const cond = plan.match(/Index Cond: \((.*)\)/s)
    assert.ok(cond, `an index condition, not a filter:\n${plan}`)
    assert.match(cond[1], /geom &&/, 'the box is asked of the index')
    assert.match(
      cond[1],
      /COALESCE\(label_zoom/i,
      `the zoom is asked of the index, not filtered after it:\n${plan}`,
    )
  })

  await t.test('a tile asks the index the same way', async t => {
    const pool = await freshDatabase(t)
    await fill(pool)
    const watch = planner(pool)
    const tile = await placeTile(
      watch.db,
      { z: 12, x: 2074, y: 1409 },
      {
        floor: CONFIDENCE_FLOOR,
        weights: VIEW_WEIGHT,
      },
    )
    assert.ok(Buffer.isBuffer(tile))
    const plan = await watch.plan()
    const cond = plan.match(/Index Cond: \((.*?)\)\n/s)
    assert.ok(cond, `an index condition, not a filter:\n${plan}`)
    assert.match(
      cond[1],
      /COALESCE\(label_zoom/i,
      `the zoom is asked of the index, not filtered after it:\n${plan}`,
    )
    /* The cast that cost 155 ms a tile. Postgres widens a real column to
       compare it against a double and the index condition goes with it. */
    assert.doesNotMatch(watch.sql, /label_zoom[^)]*\)\s*<=\s*\$\d+::double precision/)
  })

  await t.test('nearest-first keeps the radius out of the plan', async t => {
    const pool = await freshDatabase(t)
    await fill(pool)
    const watch = planner(pool)
    const near = await nearbyPlaces(watch.db, {
      lng: 2.3522,
      lat: 48.8566,
      radius: 1000,
      floor: CONFIDENCE_FLOOR,
      limit: 10,
    })
    assert.ok(near.length > 0 && near.length <= 10)
    assert.ok(
      near.every(place => place.metres <= 1000),
      'nothing outside the radius comes back',
    )
    const metres = near.map(place => place.metres)
    assert.deepEqual(
      metres,
      [...metres].sort((a, b) => a - b),
      'nearest first',
    )
    const plan = await watch.plan()
    assert.match(plan, /Order By: \(geom <->/, `a k-nearest walk:\n${plan}`)
    assert.doesNotMatch(
      plan,
      /st_dwithin/i,
      `the radius is arithmetic on the result, never a predicate the planner sees:\n${plan}`,
    )
  })

  await t.test('a category narrows the walk rather than being or-ed into it', async t => {
    const pool = await freshDatabase(t)
    await fill(pool)
    const watch = planner(pool)
    const near = await nearbyPlaces(watch.db, {
      lng: 2.3522,
      lat: 48.8566,
      radius: 5000,
      category: 'museum',
      floor: CONFIDENCE_FLOOR,
      limit: 10,
    })
    assert.ok(near.length > 0)
    assert.ok(near.every(place => place.category === 'museum'))
    assert.match(watch.sql, /and p\.category = \$6::text/)
    assert.doesNotMatch(watch.sql, /is null or p\.category/)
  })
})
