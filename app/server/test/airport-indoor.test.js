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
