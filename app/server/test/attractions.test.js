import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

test('attractions are returned in the compact shape consumed by the map', async () => {
  const repository = createMemoryRepository({ allowedEmails: [] })
  repository.loadAttractions = async bounds => [{
    id: 42, name: 'Castle', descr: 'Historic site', category: 'castle',
    imageFile: 'Castle.jpg', lng: -3.2, lat: 55.9, extract: 'Old stone castle',
    headline: true, bounds,
  }]
  const app = await buildServer({ repository, mailer: { async send() {} },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough' })
  const response = await app.inject({ method: 'GET', url: '/api/attractions?west=-4&east=-2&south=55&north=56&headlineOnly=true&limit=50' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), [{ id: 42, n: 'Castle', d: 'Historic site', k: 'castle', f: 'Castle.jpg', x: -3.2, y: 55.9, t: 'Old stone castle' }])
  await app.close()
})
