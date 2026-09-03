import test from 'node:test'
import assert from 'node:assert/strict'
import { createIndoorCache } from '../src/airport-indoor.js'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

const BODY = {
  elements: [{ type: 'node', tags: { aeroway: 'gate', ref: 'D7' }, lon: 4.76, lat: 52.31 }],
}
const ok = body => ({
  ok: true,
  status: 200,
  async json() {
    return body
  },
})

test('one airport is fetched from Overpass once, however many phones ask', async () => {
  let asked = 0
  const cache = createIndoorCache({
    fetchImpl: async () => {
      asked++
      return ok(BODY)
    },
  })

  const [first, second] = await Promise.all([
    cache.get(4.7639, 52.3105),
    cache.get(4.7639, 52.3105),
  ])
  await cache.get(4.7641, 52.3105) // rounds to the same key
  assert.deepEqual(first, BODY)
  assert.deepEqual(second, BODY)
  assert.equal(asked, 1)

  await cache.get(2.55, 49.01) // a different airport is its own fetch
  assert.equal(asked, 2)
})

test('a stale terminal is re-asked once its month is up', async () => {
  let asked = 0
  let now = new Date('2026-09-02T12:00:00Z')
  const cache = createIndoorCache({
    fetchImpl: async () => {
      asked++
      return ok(BODY)
    },
    clock: () => now,
    ttlMs: 1000,
  })
  await cache.get(4.7639, 52.3105)
  await cache.get(4.7639, 52.3105)
  assert.equal(asked, 1)
  now = new Date(now.getTime() + 1500)
  await cache.get(4.7639, 52.3105)
  assert.equal(asked, 2)
})

test('a mirror that sits on the connection is overtaken by the next one', async () => {
  const answered = []
  const cache = createIndoorCache({
    hedgeMs: 5,
    fetchImpl: async url => {
      answered.push(url)
      if (url.includes('overpass-api.de')) return new Promise(() => {}) // the tarpit
      return ok(BODY)
    },
  })
  assert.deepEqual(await cache.get(4.7639, 52.3105), BODY)
  assert.equal(answered.length, 2)
})

/* Overpass's cruellest failure: HTTP 200, a remark confessing the query died
   mid-run, and whatever elements it had so far. Cached, that is a month of
   floors without gates that looks merely sparse and raises no toast. */
test('a partial answer is a failure the next mirror gets to correct', async () => {
  const asked = []
  const cache = createIndoorCache({
    hedgeMs: 5,
    fetchImpl: async url => {
      asked.push(url)
      if (url.includes('overpass-api.de')) {
        return ok({ elements: [], remark: 'runtime error: Query timed out in "query"' })
      }
      return ok(BODY)
    },
  })
  assert.deepEqual(await cache.get(4.7639, 52.3105), BODY)
  assert.equal(asked.length, 2)
})

test('a partial row already in the store is healed by the next ask', async () => {
  const store = shelfStore()
  store.shelf.set(KEY, {
    body: { elements: [], remark: 'runtime error: Query timed out' },
    at: Date.now(),
  })
  let asked = 0
  const cache = createIndoorCache({
    fetchImpl: async () => {
      asked++
      return ok(BODY)
    },
    store,
  })
  assert.deepEqual(await cache.get(4.7639, 52.3105), BODY)
  assert.equal(asked, 1, 'the poisoned row must not satisfy the read')
  assert.deepEqual(store.shelf.get(KEY).body, BODY, 'and the fresh answer replaces it')
})

test('when every mirror fails the caller hears about it', async () => {
  const cache = createIndoorCache({
    hedgeMs: 1,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async json() {
        return {}
      },
    }),
  })
  await assert.rejects(() => cache.get(4.7639, 52.3105), /Overpass answered 429/)
})

const shelfStore = () => {
  const shelf = new Map()
  return {
    shelf,
    async read(key) {
      return shelf.get(key) || null
    },
    async write(key, body, at) {
      shelf.set(key, { body, at })
    },
  }
}

test('a restart re-reads the durable store instead of re-asking Overpass', async () => {
  let asked = 0
  const store = shelfStore()
  const fetchImpl = async () => {
    asked++
    return ok(BODY)
  }

  const before = createIndoorCache({ fetchImpl, store })
  assert.deepEqual(await before.get(4.7639, 52.3105), BODY)
  assert.equal(asked, 1)
  assert.equal(store.shelf.size, 1)

  // A new instance with an empty Map is what every deploy makes.
  const after = createIndoorCache({ fetchImpl, store })
  assert.deepEqual(await after.get(4.7639, 52.3105), BODY)
  assert.equal(asked, 1)
})

// The cache's own key for the coordinates every test asks with.
const KEY = (4.7639).toFixed(3) + ',' + (52.3105).toFixed(3)

test('a stale durable row is re-asked and rewritten', async () => {
  let asked = 0
  const now = new Date('2026-09-03T12:00:00Z')
  const store = shelfStore()
  const fresh = { elements: [{ type: 'node', tags: { aeroway: 'gate', ref: 'E9' } }] }
  store.shelf.set(KEY, { body: BODY, at: now.getTime() - 5000 })

  const cache = createIndoorCache({
    fetchImpl: async () => {
      asked++
      return ok(fresh)
    },
    store,
    clock: () => now,
    ttlMs: 1000,
  })
  assert.deepEqual(await cache.get(4.7639, 52.3105), fresh)
  assert.equal(asked, 1)
  assert.deepEqual(store.shelf.get(KEY), { body: fresh, at: now.getTime() })
})

test("an outage serves last month's terminal rather than nothing", async () => {
  const now = new Date('2026-09-03T12:00:00Z')
  const store = shelfStore()
  store.shelf.set(KEY, { body: BODY, at: now.getTime() - 5000 })

  const cache = createIndoorCache({
    hedgeMs: 1,
    fetchImpl: async () => {
      throw new Error('all mirrors down')
    },
    store,
    clock: () => now,
    ttlMs: 1000,
  })
  assert.deepEqual(await cache.get(4.7639, 52.3105), BODY)
})

test('the route serves the cache and insists on a real position', async () => {
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: [] }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    indoorCache: {
      async get(lng, lat) {
        return { elements: [], at: [lng, lat] }
      },
    },
  })

  const found = await app.inject({
    method: 'GET',
    url: '/api/airports/indoor?lng=4.7639&lat=52.3105',
  })
  assert.equal(found.statusCode, 200)
  assert.deepEqual(found.json(), { elements: [], at: [4.7639, 52.3105] })

  const missing = await app.inject({ method: 'GET', url: '/api/airports/indoor?lng=4.76' })
  assert.equal(missing.statusCode, 400)
  const silly = await app.inject({ method: 'GET', url: '/api/airports/indoor?lng=723&lat=52' })
  assert.equal(silly.statusCode, 400)
  await app.close()
})

test('an Overpass outage is a 502, not a hang or a crash', async () => {
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: [] }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    indoorCache: {
      async get() {
        throw new Error('all mirrors down')
      },
    },
  })
  const response = await app.inject({
    method: 'GET',
    url: '/api/airports/indoor?lng=4.76&lat=52.31',
  })
  assert.equal(response.statusCode, 502)
  await app.close()
})
