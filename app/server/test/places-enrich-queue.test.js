import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { READY, BARREN } from '../src/places/enrich/enrich.js'
import {
  claimEnrichment,
  enqueue,
  enqueueProminent,
  failEnrichment,
  readEnrichment,
  WANTED_NOW,
  WANTED_SOON,
  writeEnrichment,
} from '../src/places/enrich/store.js'
import { createEnrichWorker } from '../src/places/enrich/worker.js'
import { freshDatabase as makeDatabase } from './private-database.js'

/* The queue and the writing, against a real database.
 *
 * Every rule here is a statement — which rows a tick claims, in what order,
 * what a failure leaves behind, what a re-run replaces — and a fake pool
 * would be a test of the fake. */

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

const freshDatabase = t => makeDatabase(baseUrl, 'placesenrich', t, migrate)

/** A place, at a zoom that decides whether the backfill wants it. */
async function place(pool, name, labelZoom, over = {}) {
  const { rows } = await pool.query(
    `insert into places (gers_id, name, geom, category, category_raw, confidence, cell, label_zoom, website)
     values ($1, $2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5, $5, 0.8, 'N55W004', $6, $7)
     returning id`,
    [
      `overture:${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
      name,
      over.lng ?? -3.1999,
      over.lat ?? 55.9486,
      over.category ?? 'historic',
      labelZoom,
      over.website ?? null,
    ],
  )
  return rows[0].id
}

const statusOf = async (pool, id) =>
  (await pool.query('select status from place_enrichment where place_id = $1', [id])).rows[0]
    ?.status

test('the enrichment queue', { skip: unreachable, concurrency: false }, async t => {
  await t.test('queues the prominent places and leaves the rest alone', async t => {
    const pool = await freshDatabase(t)
    const castle = await place(pool, 'Edinburgh Castle', 11)
    const museum = await place(pool, 'National Museum', 13)
    const corner = await place(pool, 'Corner Shop', 17)

    const queued = await enqueueProminent(pool, { zoom: 13, limit: 100 })
    assert.deepEqual(queued.sort(), [castle, museum].sort())
    assert.equal(await statusOf(pool, corner), undefined, 'nobody sees the corner shop at a glance')
  })

  await t.test('takes the most wanted first, whatever was queued first', async t => {
    const pool = await freshDatabase(t)
    const backfilled = await place(pool, 'A Prominent Thing', 11)
    const opened = await place(pool, 'A Corner Shop', 17)
    await enqueue(pool, [backfilled], WANTED_SOON)
    await enqueue(pool, [opened], WANTED_NOW)

    const taken = await claimEnrichment(pool, 1)
    assert.equal(taken[0].id, opened, 'a person waiting beats a batch queued earlier')
  })

  await t.test('opening a card promotes a place the backfill had queued', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Edinburgh Castle', 11)
    await enqueue(pool, [id], WANTED_SOON)
    await enqueue(pool, [id], WANTED_NOW)
    const { rows } = await pool.query('select priority from place_enrichment where place_id = $1', [
      id,
    ])
    assert.equal(rows[0].priority, WANTED_NOW)
  })

  /* And never the other way: a backfill sweeping past a place somebody is
     waiting on must not push it back down the queue. */
  await t.test('the backfill never demotes a place somebody is waiting for', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Edinburgh Castle', 11)
    await enqueue(pool, [id], WANTED_NOW)
    await enqueue(pool, [id], WANTED_SOON)
    const { rows } = await pool.query('select priority from place_enrichment where place_id = $1', [
      id,
    ])
    assert.equal(rows[0].priority, WANTED_NOW)
  })

  await t.test('a finished place is not re-queued by being looked at again', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Edinburgh Castle', 11)
    await writeEnrichment(pool, id, { status: BARREN, reason: 'nothing to say', links: [] })
    await enqueue(pool, [id], WANTED_NOW)
    assert.equal(await statusOf(pool, id), BARREN, 'barren is an answer, not a gap')
  })

  await t.test('two drains cannot take the same place', async t => {
    const pool = await freshDatabase(t)
    for (let at = 0; at < 4; at += 1) await place(pool, `Thing ${at}`, 11)
    await enqueueProminent(pool, { zoom: 13, limit: 10 })
    const [first, second] = await Promise.all([claimEnrichment(pool, 2), claimEnrichment(pool, 2)])
    const ids = [...first, ...second].map(p => p.id)
    assert.equal(new Set(ids).size, ids.length, 'no place was claimed twice')
  })

  await t.test('a failure waits its turn rather than being abandoned', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Edinburgh Castle', 11)
    await enqueue(pool, [id], WANTED_SOON)
    await claimEnrichment(pool, 1)
    await failEnrichment(pool, id, new Error('Wikidata answered 503'))

    const { rows } = await pool.query(
      'select status, error, next_attempt_at > now() as waiting from place_enrichment where place_id = $1',
      [id],
    )
    assert.equal(rows[0].status, 'failed')
    assert.match(rows[0].error, /503/)
    assert.equal(rows[0].waiting, true)
    assert.deepEqual(await claimEnrichment(pool, 4), [], 'and is not taken again until it is due')

    await pool.query(
      "update place_enrichment set next_attempt_at = now() - interval '1 second' where place_id = $1",
      [id],
    )
    assert.equal((await claimEnrichment(pool, 4))[0]?.id, id, 'but is taken once it is due')
  })
})

test('the queue is worked in the order somebody would want', {
  skip: unreachable,
  concurrency: false,
}, async t => {
  /* Reported, and fair: "do things by rank, not just alphabetical or whatever
     the fuck you are doing. I'd expect museums, sights all that shit to be
     done first."
   *
   * It was `order by p.label_zoom asc, p.id asc`. The zoom half is right — a
   * place drawn from far out is one people see without looking for it — but
   * the tiebreak was a uuid, which is random. Every place sharing a zoom went
   * in by the flip of a hash, so a museum and a bus stop on the same street
   * were equally likely to be first, and at four hundred a batch it would be
   * days before the museum came up. */
  const pool = await freshDatabase(t)
  /* One of each, all at the same zoom, so the only thing that can order them
     is what they are worth. Inserted worst-first, so passing cannot be the
     insertion order in disguise. */
  const ids = new Map()
  for (const [name, category] of [
    ['Kwik Wash', 'services'],
    ['Multi-storey', 'transit'],
    ['Corner Cafe', 'cafe'],
    ['City Museum', 'museum'],
    ['Castle Rock Viewpoint', 'viewpoint'],
  ]) {
    ids.set(name, await place(pool, name, 11, { category }))
  }

  const queued = await enqueueProminent(pool, { zoom: 13, limit: 3 })
  const byId = new Map([...ids].map(([name, id]) => [id, name]))
  const names = queued.map(id => byId.get(id))

  /* The three worth having, and not the launderette or the car park. */
  assert.deepEqual(
    [...names].sort(),
    ['Castle Rock Viewpoint', 'City Museum', 'Corner Cafe'],
    `queued ${names.join(', ')}`,
  )
  /* And the best first: a viewpoint outranks a museum outranks a cafe — the
     same weighting the map uses to decide which mark a crowded tile keeps. */
  assert.deepEqual(names, ['Castle Rock Viewpoint', 'City Museum', 'Corner Cafe'])
})

test('writing down what was found', { skip: unreachable, concurrency: false }, async t => {
  const outcome = {
    status: READY,
    links: [
      { kind: 'osm', ref: 'way/1', score: 0.94, method: 'website', confirmedBy: 'website' },
      { kind: 'wikidata', ref: 'Q209507', score: null, method: 'declared' },
    ],
    description: {
      text: 'Edinburgh Castle is a historic castle in Edinburgh, Scotland.',
      lang: 'en',
      source: 'Wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/Edinburgh_Castle',
      license: 'CC BY-SA 4.0',
    },
    images: [
      {
        url: 'https://upload.wikimedia.org/a.jpg',
        thumbUrl: 'https://upload.wikimedia.org/a-thumb.jpg',
        width: 2400,
        height: 1600,
        author: 'Jane Photographer',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        source: 'Wikimedia Commons',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
        rank: 0,
      },
    ],
  }

  await t.test('the links, the words and the picture land together', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Edinburgh Castle', 11)
    await writeEnrichment(pool, id, outcome)

    const read = await readEnrichment(pool, id)
    assert.equal(read.status, READY)
    assert.match(read.description.text, /^Edinburgh Castle is a historic castle/)
    assert.equal(read.images[0].author, 'Jane Photographer')
    assert.equal(read.images[0].licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/')

    /* The audit trail: how we decided, kept so a wrong picture is traceable
       to a decision rather than re-guessed. */
    const links = await pool.query(
      'select kind, ref, score, method, confirmed_by from place_links where place_id = $1 order by kind',
      [id],
    )
    assert.deepEqual(
      links.rows.map(row => [row.kind, row.ref, row.method]),
      [
        ['osm', 'way/1', 'website'],
        ['wikidata', 'Q209507', 'declared'],
      ],
    )
  })

  await t.test('a re-run replaces what it found rather than piling up', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Edinburgh Castle', 11)
    await writeEnrichment(pool, id, outcome)
    await writeEnrichment(pool, id, {
      ...outcome,
      images: [{ ...outcome.images[0], url: 'https://upload.wikimedia.org/better.jpg' }],
    })

    const read = await readEnrichment(pool, id)
    assert.equal(read.images.length, 1, 'the old picture is gone, not kept beside the new one')
    assert.match(read.images[0].url, /better/)
  })

  await t.test('a barren place is written down as barren, with nothing attached', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Corner Shop', 17)
    await writeEnrichment(pool, id, { status: BARREN, reason: 'no OSM object', links: [] })
    const read = await readEnrichment(pool, id)
    assert.equal(read.status, BARREN)
    assert.equal(read.description, null)
    assert.deepEqual(read.images, [])
  })
})

test('the worker, end to end', { skip: unreachable, concurrency: false }, async t => {
  await t.test('tops up the backfill when the queue runs dry, then works it', async t => {
    const pool = await freshDatabase(t)
    const castle = await place(pool, 'Edinburgh Castle', 11, {
      website: 'https://www.edinburghcastle.scot/',
    })
    await place(pool, 'Corner Shop', 17)

    const worker = createEnrichWorker({
      pool,
      sources: {
        near: async () => ({
          query: {
            geosearch: [
              { pageid: 1, title: 'Edinburgh Castle', lat: 55.9486, lon: -3.1999, dist: 3 },
            ],
          },
        }),
        entity: async () => null,
        summary: async () => ({
          type: 'standard',
          lang: 'en',
          extract:
            'Edinburgh Castle is a historic castle in Edinburgh, Scotland, standing on ' +
            'Castle Rock above the city.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Edinburgh_Castle' } },
        }),
        files: async () => ({ query: { pages: [] } }),
      },
    })

    /* One tick, not two. The drain used to stop after six places and the
       top-up used to cost a whole tick of its own, so the first tick queued
       and the second began working; a tick now refills and then keeps going
       until its clock runs out. */
    await worker.once()
    const read = await readEnrichment(pool, castle)
    assert.equal(read.status, READY)
    assert.equal(read.description.source, 'Wikipedia')

    const shop = await pool.query('select count(*)::int as n from place_enrichment')
    assert.equal(shop.rows[0].n, 1, 'and the corner shop was never queued')
  })

  await t.test('nothing in the chain reaches a volunteer service', async t => {
    /* The hazard this replaces: the chain went through OpenStreetMap, our
       own copy of it was empty until somebody loaded a planet extract, and
       every backfill place therefore fell through to overpass-api.de. Four
       hundred queued at a time, six every thirty seconds — seven hundred and
       twenty requests an hour to a service run on donations, for work nobody
       was waiting on.
     *
     * It cannot happen now because there is no such hop: the chain asks
     * Wikipedia for the article and Wikipedia is a CDN-fronted API built for
     * being asked. This asserts the absence, because the absence is the
     * fix — a source named here again would be a regression nobody would
     * otherwise see until somebody else's server fell over. */
    const pool = await freshDatabase(t)
    await place(pool, 'Edinburgh Castle', 11)

    const named = []
    const worker = createEnrichWorker({
      pool,
      sources: new Proxy(
        {
          near: async () => ({ query: { geosearch: [] } }),
          entity: async () => null,
          summary: async () => null,
          files: async () => null,
        },
        {
          get(target, key) {
            if (typeof key === 'string') named.push(key)
            return target[key]
          },
        },
      ),
    })
    await worker.once()
    await worker.once()
    assert.deepEqual(
      [...new Set(named)].filter(one => /osm|overpass/i.test(one)),
      [],
      `the chain reached for ${named.join(', ')}`,
    )
  })

  await t.test('a source that throws leaves the place waiting, not lost', async t => {
    const pool = await freshDatabase(t)
    const id = await place(pool, 'Edinburgh Castle', 11)
    await enqueue(pool, [id], WANTED_SOON)

    const worker = createEnrichWorker({
      pool,
      sources: {
        near: async () => {
          throw new Error('Wikipedia answered 504')
        },
        entity: async () => null,
        summary: async () => null,
        files: async () => null,
      },
    })
    await worker.once()

    const { rows } = await pool.query(
      'select status, error, next_attempt_at is not null as waits from place_enrichment where place_id = $1',
      [id],
    )
    assert.equal(rows[0].status, 'failed')
    assert.match(rows[0].error, /504/)
    assert.equal(rows[0].waits, true)
  })
})
