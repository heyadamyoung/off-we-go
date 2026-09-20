import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { createPlaceCoverage } from '../src/places/coverage.js'
import {
  createPlaceFallback,
  fallbackInFlight,
  resetFallbackCache,
} from '../src/places/fallback.js'
import { registerPlaceRoutes } from '../src/places/index.js'

/* Tier three, with the bucket replaced by a fake.
 *
 * Nothing here touches the network — the reader is injected, so no test can
 * reach S3 by accident, and the things worth proving are all about the caps
 * rather than about Parquet:
 *
 *   The cap is on the process, not on an object. `inFlight` lives at module
 *   scope; a limit that reset per constructed fallback would hold in every
 *   test and in no deployment.
 *
 *   Over the limit the answer is immediate and thin, not queued. A queue is
 *   how one uncovered city becomes an outage: every waiting read holds a
 *   request, and a bucket that answers slowly then decides how many requests
 *   this API can serve.
 *
 *   The deadline is a race as well as a signal, because `readBox` only checks
 *   its signal between batches. A fetch that never answers would otherwise sit
 *   there for as long as it liked.
 *
 *   A degraded record is the same shape as a served one — same category
 *   vocabulary, same `sources`, same attribution — so the client needs one
 *   code path. That is `placeFromOverture`'s job and this proves it is used.
 */

const TOKYO = { lng: 139.7454, lat: 35.6586, cell: 'N35E139' }

const index = {
  version: '2026-08-19.0',
  index: { parts: [{ url: 'https://example.invalid/part-0.parquet', size: 10, groups: [] }] },
}

const overtureRow = ({
  id,
  name,
  lng,
  lat,
  confidence = 0.8,
  category = 'museum',
  dataset = 'openstreetmap',
}) => ({
  id,
  names: { primary: name },
  categories: { primary: category },
  basic_category: category,
  confidence,
  websites: [],
  phones: [],
  addresses: [{ freeform: '1-1 Somewhere', locality: 'Tokyo', country: 'JP' }],
  sources: [{ dataset, record_id: 'w99' }],
  operating_status: 'open',
  bbox: { xmin: lng, xmax: lng, ymin: lat, ymax: lat },
})

const ROWS = [
  overtureRow({ id: 'ov-1', name: 'Tokyo National Museum', lng: 139.7462, lat: 35.6589 }),
  overtureRow({
    id: 'ov-2',
    name: 'Kissaten Aoi',
    lng: 139.7449,
    lat: 35.6581,
    category: 'cafe',
    dataset: 'meta',
  }),
]

/** A reader that answers from a list, after however long it is told, and stops
    when it is aborted — which is the only behaviour of the real one the caps
    depend on. */
function fakeReader({ rows = ROWS, delayMs = 0, onOpen } = {}) {
  return {
    async readBox(_index, _bounds, _columns, { signal, onGroup } = {}) {
      onOpen?.()
      if (delayMs) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs)
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new Error('places: read aborted'))
            },
            { once: true },
          )
        })
      }
      if (signal?.aborted) throw new Error('places: read aborted')
      onGroup?.(rows.length)
      return rows
    },
    async open() {
      return {}
    },
    warmed: () => 1,
  }
}

/** Just enough repository for the routes: no database, no PostGIS. */
function fakeRepository({ nearby = [], search = [], coverage = new Map() } = {}) {
  const requested = []
  return {
    requested,
    coverage,
    async searchPlaces() {
      return search
    },
    async nearbyPlaces() {
      return nearby
    },
    async placeById() {
      return null
    },
    async placeSources() {
      return new Map()
    },
    async placeCoverage(cells) {
      return new Map(
        cells.filter(cell => coverage.has(cell)).map(cell => [cell, coverage.get(cell)]),
      )
    },
    async requestPlaceCells(cells, at) {
      requested.push({ cells: [...cells], at })
      for (const cell of cells) coverage.set(cell, { cell, status: 'pending', versions: {} })
      return cells.map(cell => ({
        cell,
        status: 'pending',
        requestedAt: at?.toISOString?.() ?? null,
      }))
    },
    async pendingPlaceCells() {
      return [...coverage.values()].filter(row => row.status === 'pending')
    },
  }
}

async function server(t, { repository, fallback }) {
  const app = Fastify()
  const coverage = createPlaceCoverage({ repository })
  registerPlaceRoutes(app, {
    repository,
    coverage,
    fallback,
    /* The login is proved against the real server in places-api.test.js; here
       it is stubbed so the caps are the only thing under test. */
    authenticated: async () => ({ id: 'u1', email: 'owner@example.com' }),
  })
  await app.ready()
  t.after(() => app.close())
  return app
}

test('an uncovered cell is answered from the bucket, degraded, and enqueued', async t => {
  resetFallbackCache()
  const repository = fakeRepository()
  const fallback = createPlaceFallback({
    loadIndex: async () => index,
    makeReader: () => fakeReader(),
    coverage: createPlaceCoverage({ repository }),
  })
  const app = await server(t, { repository, fallback })

  const response = await app.inject({
    method: 'GET',
    url: `/api/places/nearby?lat=${TOKYO.lat}&lng=${TOKYO.lng}&radius=800`,
  })
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.degraded, true)
  assert.deepEqual(body.coverage, { cell: TOKYO.cell, status: 'pending' })
  assert.equal(response.headers['cache-control'], 'no-store')

  /* Same shape as a served record, because it went through placeFromOverture:
     one of our twenty categories, a distance, a licence trail, and the notice
     ODbL obliges us to print. */
  const museum = body.places.find(place => place.name === 'Tokyo National Museum')
  assert.ok(museum, 'the bucket answered')
  /* A string id, and the one the record will still have after its cell is
     ingested. Null would be dropped by the client's list parser, which keys on
     `id` — the whole tier would silently show nothing. */
  assert.equal(museum.id, 'ov-1')
  assert.equal(museum.gersId, 'ov-1')
  assert.equal(museum.category, 'museum')
  assert.equal(museum.cell, TOKYO.cell)
  assert.ok(Number.isFinite(museum.metres))
  assert.ok(
    museum.sources.some(source => source.license === 'ODbL-1.0'),
    'an OpenStreetMap-derived record carries ODbL',
  )
  assert.ok(museum.attribution.some(notice => /OpenStreetMap/.test(notice.notice)))
  /* And a record from a dataset that is not OpenStreetMap does not. */
  const cafe = body.places.find(place => place.name === 'Kissaten Aoi')
  assert.ok(!cafe.sources.some(source => source.license === 'ODbL-1.0'))

  /* The cell is on the queue, which is what stops the next traveller getting
     a degraded answer too. */
  assert.ok(
    repository.requested.some(call => call.cells.includes(TOKYO.cell)),
    'the miss enqueued its cell',
  )
  assert.deepEqual(
    (await repository.pendingPlaceCells()).map(row => row.cell),
    [TOKYO.cell],
  )
})

test('a ready cell never touches the bucket', async t => {
  resetFallbackCache()
  let reads = 0
  const repository = fakeRepository({
    coverage: new Map([
      [TOKYO.cell, { cell: TOKYO.cell, status: 'ready', versions: { overture: '2026-08-19.0' } }],
    ]),
    nearby: Array.from({ length: 9 }, (_, at) => ({
      id: `p${at}`,
      gersId: `g${at}`,
      name: `Place ${at}`,
      lng: TOKYO.lng,
      lat: TOKYO.lat,
      cell: TOKYO.cell,
      category: 'sights',
      confidence: 0.8,
      metres: 10 + at,
      sources: [],
    })),
  })
  const fallback = createPlaceFallback({
    loadIndex: async () => index,
    makeReader: () => fakeReader({ onOpen: () => (reads += 1) }),
    coverage: createPlaceCoverage({ repository }),
  })
  const app = await server(t, { repository, fallback })

  const response = await app.inject({
    method: 'GET',
    url: `/api/places/nearby?lat=${TOKYO.lat}&lng=${TOKYO.lng}&radius=800`,
  })
  assert.equal(response.json().degraded, false)
  assert.equal(reads, 0, 'tier one answered, so tier three was never asked')
  assert.equal(repository.requested.length, 0, 'and nothing was queued')
  assert.equal(response.headers['cache-control'], 'private, max-age=120')
})

test('the deadline is a ceiling, whatever the bucket is doing', async t => {
  resetFallbackCache()
  const repository = fakeRepository()
  const fallback = createPlaceFallback({
    loadIndex: async () => index,
    /* A second is an eternity next to a 30 ms deadline; the read must be
       abandoned, not awaited. */
    makeReader: () => fakeReader({ delayMs: 1_000 }),
    deadlineMs: 30,
    coverage: createPlaceCoverage({ repository }),
  })

  const started = Date.now()
  const result = await fallback.readBounds(
    { west: 139.7, south: 35.6, east: 139.8, north: 35.7 },
    { limit: 10, centre: TOKYO, cells: [TOKYO.cell] },
  )
  const elapsed = Date.now() - started
  assert.equal(result.reason, 'deadline')
  assert.equal(result.degraded, true)
  assert.deepEqual(result.places, [])
  assert.ok(elapsed < 500, `gave up in ${elapsed}ms, not a second`)
  /* Deadline or not, the cell is still asked for: a read we abandoned is a
     coverage gap we now know about. */
  assert.ok(repository.requested.some(call => call.cells.includes(TOKYO.cell)))
  /* And the slot is handed back, or the second slow city would wedge the
     process for good. */
  assert.equal(fallbackInFlight(), 0)
  t.after(() => resetFallbackCache())
})

test('the concurrency cap is on the process, and over it nothing queues', async t => {
  resetFallbackCache()
  const repository = fakeRepository()
  let release = () => {}
  const held = new Promise(resolve => {
    release = resolve
  })
  let opened = 0
  const fallback = createPlaceFallback({
    loadIndex: async () => index,
    makeReader: () => ({
      async readBox(_index, _bounds, _columns, { onGroup } = {}) {
        opened += 1
        await held
        onGroup?.(ROWS.length)
        return ROWS
      },
      async open() {
        return {}
      },
      warmed: () => 1,
    }),
    concurrency: 2,
    deadlineMs: 5_000,
    coverage: createPlaceCoverage({ repository }),
  })
  t.after(() => {
    release()
    resetFallbackCache()
  })

  const bounds = { west: 139.7, south: 35.6, east: 139.8, north: 35.7 }
  const options = { limit: 10, centre: TOKYO, cells: [TOKYO.cell] }
  const first = fallback.readBounds(bounds, options)
  const second = fallback.readBounds(bounds, options)
  /* Let the two claims settle before the next two arrive; the point is that
     they are counted, not that they are simultaneous to the millisecond. */
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fallbackInFlight(), 2, 'two reads are allowed to be in flight')

  const third = await fallback.readBounds(bounds, options)
  const fourth = await fallback.readBounds(bounds, options)
  for (const refused of [third, fourth]) {
    assert.equal(refused.reason, 'busy')
    assert.equal(refused.degraded, true)
    assert.deepEqual(refused.places, [], 'answered from whatever local rows exist, not queued')
  }
  assert.equal(opened, 2, 'the bucket saw two reads, not four')
  /* A refusal is still a coverage gap, and the cell is still asked for — once,
     however many refusals name it. Four reads of one cell used to be four
     upserts of one row; a client panning a map over an uningested country was
     a write per request. */
  const asked = repository.requested.flatMap(call => call.cells)
  assert.ok(asked.includes(TOKYO.cell), `${asked.join(',')} does not name the refused cell`)
  assert.equal(repository.requested.length, 1, 'one write, not one per refusal')

  release()
  assert.equal((await first).reason, null)
  assert.equal((await second).reason, null)
  assert.equal(fallbackInFlight(), 0, 'both slots come back')

  /* And now that a slot is free, a read goes through again. */
  const after = await fallback.readBounds(bounds, options)
  assert.equal(after.reason, null)
  assert.equal(after.places.length, ROWS.length)
})

test('the release index and the reader are parsed once, not per query', async t => {
  resetFallbackCache()
  t.after(() => resetFallbackCache())
  const repository = fakeRepository()
  let indexes = 0
  let readers = 0
  const fallback = createPlaceFallback({
    loadIndex: async () => {
      indexes += 1
      return index
    },
    makeReader: () => {
      readers += 1
      return fakeReader()
    },
    coverage: createPlaceCoverage({ repository }),
  })
  const bounds = { west: 139.7, south: 35.6, east: 139.8, north: 35.7 }
  for (let at = 0; at < 3; at += 1) {
    await fallback.readBounds(bounds, { limit: 5, centre: TOKYO, cells: [TOKYO.cell] })
  }
  /* A cold footer read is ~900 ms and a warm one nothing; paying it per query
     would make the fallback three times as slow as its own measurements. */
  assert.equal(indexes, 1, 'the release index is parsed once for the life of the process')
  assert.equal(readers, 1, 'and the reader, which holds the parsed footers, is kept')
})

test('without a release index the answer is thin but still honest', async t => {
  resetFallbackCache()
  t.after(() => resetFallbackCache())
  const repository = fakeRepository()
  const fallback = createPlaceFallback({ coverage: createPlaceCoverage({ repository }) })
  const app = await server(t, { repository, fallback })
  const response = await app.inject({
    method: 'GET',
    url: `/api/places/nearby?lat=${TOKYO.lat}&lng=${TOKYO.lng}&radius=800`,
  })
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.degraded, true, 'an unconfigured fallback is not a pretence of coverage')
  assert.deepEqual(body.places, [])
  assert.equal(body.coverage.cell, TOKYO.cell)
  assert.ok(repository.requested.some(call => call.cells.includes(TOKYO.cell)))
})

test('a trip’s stops are noticed without blocking the write', async () => {
  const repository = fakeRepository()
  const coverage = createPlaceCoverage({ repository, flushDelayMs: 1 })
  /* Synchronous, returns nothing, and cannot throw: the caller is in the
     middle of answering a stop being dragged up a list. */
  assert.equal(
    coverage.noteStops({
      stops: [
        { lng: TOKYO.lng, lat: TOKYO.lat },
        { lng: 4.8852, lat: 52.36 },
        { lng: null, lat: undefined },
      ],
    }),
    undefined,
  )
  assert.equal(repository.requested.length, 0, 'nothing was written on the caller’s thread')
  await coverage.settle()
  const asked = repository.requested.flatMap(call => call.cells)
  assert.ok(asked.includes('N35E139'))
  assert.ok(asked.includes('N52E004'))

  /* A trip edited ten times in a minute asks once. */
  const before = repository.requested.length
  coverage.noteStops({ stops: [{ lng: TOKYO.lng, lat: TOKYO.lat }] })
  await coverage.settle()
  assert.equal(repository.requested.length, before, 'the same cell is not asked for again')
})
