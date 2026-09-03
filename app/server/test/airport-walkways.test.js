import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeWalkways, walkwayElement } from '../src/airport-walkways.js'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

/* Hand-laid walking segments must arrive dressed exactly as the client's
   converter expects — a corridor way with a level and a geometry — or they
   are silently nothing. And they merge at serve time, so a segment added a
   second ago routes without waiting out the month-long Overpass cache. */

const ROW = {
  id: 'walkway-1',
  lng: -79.62,
  lat: 43.68,
  level: '1',
  name: 'Pier F shortcut',
  points: [
    [-79.62, 43.68],
    [-79.621, 43.6805],
  ],
}

test('a walkway row becomes the corridor way the client already routes', () => {
  assert.deepEqual(walkwayElement(ROW, 3), {
    type: 'way',
    id: -4,
    tags: { highway: 'corridor', level: '1', name: 'Pier F shortcut' },
    geometry: [
      { lon: -79.62, lat: 43.68 },
      { lon: -79.621, lat: 43.6805 },
    ],
  })
  // No name tag when there is no name; level falls back to the ground floor.
  const bare = walkwayElement({ ...ROW, name: null, level: null })
  assert.deepEqual(bare.tags, { highway: 'corridor', level: '0' })
})

test('merging appends to what Overpass said, and an empty list changes nothing', () => {
  const body = { elements: [{ type: 'node', id: 7 }] }
  assert.equal(mergeWalkways(body, []), body)
  const merged = mergeWalkways(body, [ROW])
  assert.equal(merged.elements.length, 2)
  assert.equal(merged.elements[1].tags.highway, 'corridor')
  assert.equal(body.elements.length, 1, 'the cached body itself is never mutated')
})

test('the indoor route serves walkways near the asked position, not across the world', async () => {
  const repository = createMemoryRepository({ allowedEmails: [] })
  await repository.addAirportWalkway({ userId: null, level: '1', name: null, points: ROW.points })
  await repository.addAirportWalkway({
    userId: null,
    level: '0',
    name: 'Schiphol, an ocean away',
    points: [
      [4.7683, 52.3105],
      [4.769, 52.311],
    ],
  })

  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    indoorCache: {
      async get() {
        return { elements: [{ type: 'node', id: 7 }] }
      },
    },
  })
  const response = await app.inject({
    method: 'GET',
    url: '/api/airports/indoor?lng=-79.6206&lat=43.6802',
  })
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.elements.length, 2)
  assert.equal(body.elements[1].tags.highway, 'corridor')
  assert.equal(body.elements[1].tags.level, '1')
  assert.ok(!JSON.stringify(body).includes('Schiphol'), 'the far walkway stays home')
  await app.close()
})
