import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { createPlaceWorker } from '../src/places/worker.js'
import {
  CONFIDENCE_FLOOR,
  EARLIEST_ZOOM,
  LABEL_PER_TILE,
  LABEL_ZOOMS,
  VIEW_WEIGHT,
  ZOOM_POLICY,
} from '../src/places/rank.js'
import { cellBounds, cellKey } from '../src/places/cells.js'
import { assignLabelZoom, indexIsReady, markRequested, placeTile } from '../src/places/store.js'
import { freshDatabase as makeDatabase } from './private-database.js'

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
const unreachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  return false
})()

const { createPostgresRepository } = await import('../src/postgres.js')

/* A database of its own per case, copied from one migrated once.
 *
 * It used to drop the schema and run all fifty-two migrations for every
 * case. Measured, this file alone was 79.8 seconds of a server suite whose
 * every other file put together was 55. See private-database.js. */
const migrate = async url => {
  const repository = await createPostgresRepository({
    databaseUrl: url,
    adminEmail: 'owner@example.com',
  })
  await repository.migrate()
  await repository.close()
}

const freshDatabase = t => makeDatabase(baseUrl, 'placesworker', t, migrate)

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
    /* Tile warming gets a tenth of a second rather than its production
       budget. An idle tick spends that budget encoding squares over whatever
       ground it can find, which is the right thing on a box nobody is using
       and was four and a half seconds of every case in this file — most of
       the 79.8 seconds it took, against 55 for the whole of the rest of the
       server suite. What warming does is proved in places-tiles.test.js;
       what these cases are about is which cells a tick claims. */
    tileBudgetMs: 100,
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
/* The coverage row that comes with the places.
 *
 * Not test furniture: the ingest writes the places and this row in the same
 * transaction, so a cell of places without one is a state the system cannot
 * reach, and it is the row that records which rule the cell was placed under.
 * The backfill queue reads it — see store.js cellsAwaitingZoom — so a test
 * that leaves it out is testing a database nobody has. */
async function ground(pool, cell, places) {
  const box = cellBounds(cell)
  await pool.query(
    `insert into place_coverage (cell, west, south, east, north, status, place_count)
     values ($1, $2, $3, $4, $5, 'ready', $6)
     on conflict (cell) do update set
       place_count = place_coverage.place_count + excluded.place_count,
       status = 'ready', zoom_policy = null`,
    [cell, box.west, box.south, box.east, box.north, places],
  )
}

async function unplaced(pool, name, lng, lat, category = 'museum', confidence = 0.8) {
  /* The cell the point actually falls in, not a constant: two places in two
     countries are two cells, and the backfill queue is a queue of cells. */
  const cell = cellKey(lng, lat)
  await pool.query(
    `insert into places (gers_id, name, geom, category, category_raw, confidence, cell)
     values ($1, $2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5, $5, $6, $7)`,
    [
      `overture:${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
      name,
      lng,
      lat,
      category,
      confidence,
      cell,
    ],
  )
  await ground(pool, cell, 1)
}

/* A city's worth of places, and what a square of it is allowed to hold.
 *
 * This is the test that should have existed before any of the zoom work
 * shipped, and its absence is why a carpet of dots reached a phone twice.
 * Everything around it was tested — the pass assigns zooms, the tile filters
 * on them, a mark that appears does not vanish — and none of those is the
 * property anybody cares about, which is simply:
 *
 *   zoomed out over a dense city, a square holds a couple of dozen marks,
 *   not every place in it.
 *
 * Stated end to end, on thousands of rows, through the same query the route
 * runs, because each of the pieces can be individually right while the thing
 * they add up to is wrong. */
test('a city does not arrive all at once', {
  skip: unreachable,
  concurrency: false,
}, async t => {
  /** A few thousand places spread over a cell, as a real city is. */
  async function city(pool, count = 2500) {
    const kinds = ['cafe', 'food', 'shopping', 'services', 'lodging', 'museum', 'historic']
    const values = []
    const args = []
    for (let at = 0; at < count; at += 1) {
      /* Spread over about a tenth of a degree — a city rather than a point,
         so several squares at each zoom are in play. */
      const lng = -104.62 + (at % 50) * 0.002
      const lat = 50.44 + Math.floor(at / 50) * 0.002
      const kind = kinds[at % kinds.length]
      const base = at * 7
      values.push(
        `($${base + 1}, $${base + 2}, ST_SetSRID(ST_MakePoint($${base + 3}, $${base + 4}),4326)::geography,` +
          ` $${base + 5}, $${base + 5}, $${base + 6}, $${base + 7})`,
      )
      args.push(`overture:r${at}`, `Place ${at}`, lng, lat, kind, 0.8, 'N50W105')
    }
    await pool.query(
      `insert into places (gers_id, name, geom, category, category_raw, confidence, cell)
       values ${values.join(',')}`,
      args,
    )
    await ground(pool, 'N50W105', count)
  }

  /* How many marks a square carries, by the tile query's own predicate.
     placeTile returns encoded bytes and this suite has no MVT decoder, so the
     count comes from the same `label_zoom <= z` filter the tile runs — which
     is the thing being asserted. The bytes are checked too, so a tile that
     agreed with the count and then encoded nothing is still caught. */
  const marksIn = async (pool, { z, x, y }) => {
    const { rows } = await pool.query(
      `select count(*)::int as n
         from places p, (select ST_TileEnvelope($1, $2, $3) as box) b
        where p.geom && ST_Transform(b.box, 4326)::geography
          and p.confidence >= $4::real
          and coalesce(p.label_zoom, $5::real) <= $1::double precision`,
      [z, x, y, CONFIDENCE_FLOOR, LABEL_ZOOMS.from],
    )
    return rows[0].n
  }

  const square = (lng, lat, z) => {
    const side = 2 ** z
    const rad = (lat * Math.PI) / 180
    return {
      z,
      x: Math.floor(((lng + 180) / 360) * side),
      y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * side),
    }
  }

  /* The exact state the box was in: a table full of places with no zoom, and
     no release index, because sixteen downloads off S3 had not finished. The
     zoom pass needs none of that and must not wait for it. */
  await t.test('heals a table of unplaced rows with no release index at all', async t => {
    const pool = await freshDatabase(t)
    await city(pool, 800)

    const worker = createPlaceWorker({
      pool,
      loadIndex: async () => null,
      loadSecondIndex: null,
      makeReader: () => ({ readBox: async () => {} }),
      makeIngest: () => ({
        versions: {},
        ingestCells: async () => ({ results: [] }),
        stop: () => {},
      }),
    })
    await worker.once()
    await worker.settled()

    const { rows } = await pool.query(
      'select count(*) filter (where label_zoom is null)::int as unplaced from places',
    )
    assert.equal(rows[0].unplaced, 0, 'the zoom pass does not wait on the network')
  })

  await t.test(
    'a square over a dense city holds a couple of dozen marks, not the city',
    async t => {
      const pool = await freshDatabase(t)
      await city(pool)
      await assignLabelZoom(pool, null, {
        weights: VIEW_WEIGHT,
        perTile: LABEL_PER_TILE,
        zooms: LABEL_ZOOMS,
        earliest: EARLIEST_ZOOM,
      })

      const centre = [-104.57, 50.47]
      for (const z of [11, 12, 13]) {
        const at = square(centre[0], centre[1], z)

        /* The algorithm's own contract, stated exactly: within one square of
           the grid assignLabelZoom partitioned by, at most LABEL_PER_TILE
           places earned that zoom. */
        const earned = await pool.query(
          `select count(*)::int as n from places p
            where p.label_zoom = $1::real
              and ${'floor((((ST_X(p.geom::geometry)) + 180) / 360) * power(2, $1)) = $2'}
              and ${'floor((1 - ln(tan(radians(ST_Y(p.geom::geometry))) + 1 / cos(radians(ST_Y(p.geom::geometry)))) / pi()) / 2 * power(2, $1)) = $3'}`,
          [at.z, at.x, at.y],
        )
        assert.ok(
          earned.rows[0].n <= LABEL_PER_TILE,
          `z${z}: ${earned.rows[0].n} places earned that zoom in one square, over ${LABEL_PER_TILE}`,
        )

        /* And what the tile actually draws. A few more than the budget,
           because the envelope reaches a little past its own square and a
           mark on the far side of the line should not vanish at the seam —
           but a couple of dozen, not the city. That is the whole property,
           and its absence is what put a carpet of dots on a phone. */
        const marks = await marksIn(pool, at)
        assert.ok(
          marks > 0 && marks <= LABEL_PER_TILE * 4,
          `z${z} drew ${marks} marks of 2500 places; a square carries a couple of dozen`,
        )
        /* And the square really encodes to a tile, rather than agreeing with
           the count and then producing nothing. */
        const bytes = await placeTile(pool, at, { floor: CONFIDENCE_FLOOR, weights: VIEW_WEIGHT })
        assert.ok(bytes.length > 0, `z${z} encoded an empty tile`)
      }
    },
  )

  /* The other half, and the reason there is no cap in the tile query: zoom
     far enough in and a square is small enough that a selection is not what
     anybody wants. Everything in it is drawn. */
  await t.test('and close up, a square holds everything in it', async t => {
    const pool = await freshDatabase(t)
    await city(pool, 400)
    await assignLabelZoom(pool, null, {
      weights: VIEW_WEIGHT,
      perTile: LABEL_PER_TILE,
      zooms: LABEL_ZOOMS,
      earliest: EARLIEST_ZOOM,
    })
    const at = square(-104.62, 50.44, 17)
    const inSquare = await pool.query(
      `select count(*)::int as n
         from places p, (select ST_TileEnvelope($1, $2, $3) as box) b
        where p.geom && ST_Transform(b.box, 4326)::geography
          and p.confidence >= $4::real`,
      [at.z, at.x, at.y, CONFIDENCE_FLOOR],
    )
    assert.ok(inSquare.rows[0].n > 0, 'the square has places in it to draw')
    assert.equal(
      await marksIn(pool, at),
      inSquare.rows[0].n,
      'and every one of them is drawn — no cap this far in',
    )
  })

  /* And the rule the ceiling exists for, on real density rather than on a
     sample of twenty-two: no cafe is ever drawn from across the city. */
  await t.test('no everyday place is drawn from across the city', async t => {
    const pool = await freshDatabase(t)
    await city(pool)
    await assignLabelZoom(pool, null, {
      weights: VIEW_WEIGHT,
      perTile: LABEL_PER_TILE,
      zooms: LABEL_ZOOMS,
      earliest: EARLIEST_ZOOM,
    })
    const early = await pool.query(
      `select distinct category from places
        where label_zoom < $1::real order by category`,
      [EARLIEST_ZOOM.cafe],
    )
    const kinds = early.rows.map(row => row.category)
    for (const everyday of ['cafe', 'food', 'shopping', 'services']) {
      assert.ok(!kinds.includes(everyday), `a ${everyday} is never drawn from that far out`)
    }
    assert.ok(kinds.includes('museum'), 'but a museum is')
  })
})

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

    /* That square, specifically. Not "no tiles at all": the worker warms
       cold squares when it has nothing to ingest, and a square it builds
       after the pass is a square built from the zooms as they now are. What
       must not survive is the one drawn before. */
    const tiles = await pool.query(
      'select body from place_tiles where z = 12 and x = 2096 and y = 1343',
    )
    const kept = tiles.rows[0]?.body?.toString() ?? ''
    assert.notEqual(kept, 'a tile drawn from zooms that were wrong', 'the old tile is gone')
  })

  await t.test('a second tick does not run the pass again', async t => {
    const pool = await freshDatabase(t)
    await unplaced(pool, 'Rijksmuseum', 4.8852, 52.36)
    const { worker } = workerOver(pool)
    await worker.once()
    await worker.settled()

    /* A tile built after the pass survives, which is how we know the pass
       did not run a second time and throw it away. Upserted rather than
       inserted: the worker warms cold squares when it has nothing to ingest,
       so this square may well already be built, and the question here is
       whose bytes are in it afterwards. */
    await pool.query(
      `insert into place_tiles (z, x, y, body, places, built_at)
       values (12, 2096, 1343, $1, 1, now())
       on conflict (z, x, y) do update set body = excluded.body, built_at = now()`,
      [Buffer.from('built from the zooms as they now are')],
    )
    await worker.once()
    await worker.settled()
    const tiles = await pool.query(
      'select body from place_tiles where z = 12 and x = 2096 and y = 1343',
    )
    assert.equal(
      tiles.rows[0]?.body?.toString(),
      'built from the zooms as they now are',
      'nothing to place, so nothing thrown away',
    )
  })

  /* The property the whole rewrite is for.
   *
   * The pass used to be one statement over every place in the world, so an
   * api restart — which is every deploy — threw all of it away and began
   * again. Four releases in an evening meant four runs from zero and a phone
   * still under a carpet of dots. Work that is done stays done, and the
   * record of it is the cell's own row. */
  await t.test('a cell already placed is not placed again', async t => {
    const pool = await freshDatabase(t)
    await unplaced(pool, 'Rijksmuseum', 4.8852, 52.36)
    await unplaced(pool, 'Scottish Parliament', -3.1751, 55.9521)
    /* Amsterdam, done under the current rule by a run that stopped before it
       reached Edinburgh. The zoom is a number the pass cannot produce — the
       thinning zooms start at LABEL_ZOOMS.from — so if it is still there
       afterwards, nothing touched these rows. */
    await pool.query("update places set label_zoom = 5 where cell = 'N52E004'")
    await pool.query('update place_coverage set zoom_policy = $1 where cell = $2', [
      ZOOM_POLICY,
      'N52E004',
    ])

    const { worker } = workerOver(pool)
    await worker.once()
    await worker.settled()

    const done = await pool.query(
      `select cell, min(label_zoom)::int as zoom, count(*) filter (where label_zoom is null)::int
         as unplaced from places group by cell order by cell`,
    )
    const byCell = new Map(done.rows.map(row => [row.cell, row]))
    assert.equal(byCell.get('N52E004').zoom, 5, 'the cell that was done was left alone')
    assert.equal(byCell.get('N55W004').unplaced, 0, 'and the one that was not is placed now')

    const stamped = await pool.query(
      'select count(*)::int as n from place_coverage where zoom_policy = $1',
      [ZOOM_POLICY],
    )
    assert.equal(stamped.rows[0].n, 2, 'both cells now record the rule they were placed under')
  })

  /* The index the map is served from, built by the worker because a boot is
     not allowed to take as long as it takes. Five releases in a row died of
     this being a migration. */
  await t.test(
    'builds the index the map is served from, and drops the one it replaces',
    async t => {
      const pool = await freshDatabase(t)
      await unplaced(pool, 'Rijksmuseum', 4.8852, 52.36)
      /* A fresh database has the geometry-only index from migration 043 and
       none of the replacement, which is the state every real box is in. */
      assert.equal(await indexIsReady(pool, 'places_geom_idx'), true)
      assert.equal(await indexIsReady(pool, 'places_view_idx'), null)

      const { worker } = workerOver(pool)
      await worker.once()
      await worker.settled()
      assert.equal(await indexIsReady(pool, 'places_view_idx'), true, 'built, and valid')

      /* The drop is the tick after the build, so a build that fails cannot
       take the working index with it. */
      await worker.once()
      await worker.settled()
      assert.equal(await indexIsReady(pool, 'places_geom_idx'), null, 'one spatial index now')
    },
  )

  /* The clear is by primary key now, which is the same tiles named rather
     than tested — and "the same" is the whole risk, so it is asserted from
     both sides: the squares over the cell go, and the square next door does
     not. The old form projected every row in the table to find out. */
  await t.test("placing a cell drops that cell's tiles and no others", async t => {
    const pool = await freshDatabase(t)
    await unplaced(pool, 'Rijksmuseum', 4.8852, 52.36)
    /* Amsterdam at three zooms, and one square over Scotland that has
       nothing to do with this cell. */
    const over = [
      { z: 11, x: 1051, y: 673 },
      { z: 12, x: 2103, y: 1346 },
      { z: 14, x: 8414, y: 5385 },
    ]
    const elsewhere = { z: 12, x: 2011, y: 1276 }
    for (const tile of [...over, elsewhere]) {
      await pool.query(
        `insert into place_tiles (z, x, y, body, places, built_at)
         values ($1, $2, $3, $4, 1, now())`,
        [tile.z, tile.x, tile.y, Buffer.from('drawn before the pass')],
      )
    }

    const { worker } = workerOver(pool)
    await worker.once()
    await worker.settled()

    for (const tile of over) {
      const { rows } = await pool.query(
        'select body from place_tiles where z = $1 and x = $2 and y = $3',
        [tile.z, tile.x, tile.y],
      )
      assert.notEqual(
        rows[0]?.body?.toString(),
        'drawn before the pass',
        `the z${tile.z} square over the cell is gone`,
      )
    }
    const kept = await pool.query(
      'select body from place_tiles where z = $1 and x = $2 and y = $3',
      [elsewhere.z, elsewhere.x, elsewhere.y],
    )
    assert.equal(
      kept.rows[0]?.body?.toString(),
      'drawn before the pass',
      'and a square over ground this cell does not touch is left alone',
    )
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

  /* London, and why priority had to exist.
   *
   * The planet puts 53,333 cells in this table. The drain takes four a
   * minute. A cell somebody is looking at right now, queued by age alone,
   * joins a line forty-two thousand long and is reached in about a week —
   * so London sat `pending` with a traveller looking at it and nothing in
   * the system would have got there before the sweep did, hours later. */
  await t.test('a cell somebody is looking at goes before the planet backfill', async t => {
    const pool = await freshDatabase(t)
    /* The backfill, queued long ago, as the planet is. */
    for (let at = 0; at < 8; at += 1) {
      await coverage(pool, `S01E00${at}`, { requestedAt: new Date('2026-01-01') })
    }
    /* And one cell a viewport just asked about — newest of all, so age alone
       would put it last. */
    await markRequested(pool, ['N51W001'], new Date())

    const { worker, handed } = workerOver(pool, { cellsPerTick: 2 })
    await worker.once()
    assert.ok(handed.includes('N51W001'), `${handed.join(',')} does not include the asked-for cell`)
  })

  await t.test('asking promotes a cell the backfill queued, and never demotes one', async t => {
    const pool = await freshDatabase(t)
    await coverage(pool, 'N51W001', { requestedAt: new Date('2026-01-01') })
    await markRequested(pool, ['N51W001'], new Date())
    const promoted = await pool.query('select priority from place_coverage where cell = $1', [
      'N51W001',
    ])
    assert.equal(promoted.rows[0].priority, 0, 'looking at it moved it to the front')

    /* And the backfill sweeping past must not push it back. */
    await markRequested(pool, ['N51W001'], new Date(), 1)
    const still = await pool.query('select priority from place_coverage where cell = $1', [
      'N51W001',
    ])
    assert.equal(still.rows[0].priority, 0, 'and nothing puts it back')
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
    await worker.settled()
    /* Once, not twice. Counted among the lines about the release rather than
       among all of them — the worker also builds the index the map is served
       from on its first tick, and says so, which is a different subject and
       has its own test. */
    const aboutTheRelease = said.filter(line => /upstream release/.test(line))
    assert.equal(aboutTheRelease.length, 1, said.join(' | '))
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
