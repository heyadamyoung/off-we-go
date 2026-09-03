import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createCoverage, regionsForPoints } from '../src/coverage.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const box = (id, parent, [w, s, e, n]) => ({
  properties: { id, parent, urls: { pbf: `https://x/${id}.osm.pbf` } },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  },
})
const INDEX = {
  features: [box('europe', null, [-10, 35, 30, 60]), box('netherlands', 'europe', [3, 50, 7, 54])],
}

test('a point lands in the deepest region that contains it, once', () => {
  const regions = regionsForPoints(INDEX, [
    [4.9, 52.37], // Amsterdam → netherlands, not europe
    [4.8, 52.3], // still netherlands — dedupe
    [20, 45], // the Balkans in this toy index → europe itself
    [-40, 20], // open Atlantic → nobody
  ])
  assert.deepEqual(regions, [
    { id: 'netherlands', url: 'https://x/netherlands.osm.pbf' },
    { id: 'europe', url: 'https://x/europe.osm.pbf' },
  ])
})

test('coverage writes the wanted list only when it changes, and survives a dead index', async () => {
  const writes = []
  let points = [[4.9, 52.37]]
  let indexFetches = 0
  const coverage = createCoverage({
    listPoints: async () => points,
    wantedPath: '/tiles/wanted',
    fetch: async () => {
      indexFetches++
      return { ok: true, json: async () => INDEX }
    },
    fs: {
      writeFile: async (path, body) => {
        writes.push({ path, body })
      },
    },
  })

  assert.deepEqual(
    (await coverage.refresh()).map(region => region.id),
    ['netherlands'],
  )
  assert.deepEqual(writes, [{ path: '/tiles/wanted', body: 'https://x/netherlands.osm.pbf\n' }])

  // Nothing moved: no rewrite, and the region index is not re-fetched.
  await coverage.refresh()
  assert.equal(writes.length, 1)
  assert.equal(indexFetches, 1)

  // A stop appears in a new region: the list grows, sorted and stable.
  points = [
    [4.9, 52.37],
    [20, 45],
  ]
  await coverage.refresh()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].body, 'https://x/europe.osm.pbf\nhttps://x/netherlands.osm.pbf\n')

  // The index going away is a logged fact, never a crash.
  const broken = createCoverage({
    listPoints: async () => [[1, 1]],
    wantedPath: '/tiles/wanted',
    fetch: async () => ({ ok: false, status: 503 }),
    fs: { writeFile: async () => {} },
  })
  assert.equal(await broken.refresh(), null)
})

test('the server asks for coverage at boot and again when stops change', async () => {
  const calls = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    coverage: {
      refresh: async () => calls.push('refresh'),
      refreshSoon: () => calls.push('soon'),
    },
  })
  assert.deepEqual(calls, ['refresh'])

  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Somewhere new' },
    })
  ).json()
  await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/stops`,
    headers: { authorization: owner },
    payload: { name: 'A stop', day: 'Day 1', lng: 4.9, lat: 52.37 },
  })
  assert.ok(calls.includes('soon'), 'creating a stop should nudge coverage')
  await app.close()
})
