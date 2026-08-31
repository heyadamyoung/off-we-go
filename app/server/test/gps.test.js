import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

test('a registered phone can report an idempotent GPS fix that its trip can read', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T13:21:00.000Z'),
  })

  const authorization = await authenticate(repository, 'owner@example.com')
  const created = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization }, payload: { title: 'GPS trip' },
  })
  const trip = created.json()

  const registered = await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/devices`, headers: { authorization },
    payload: { name: "Sample iPhone", timezone: 'America/Regina' },
  })
  assert.equal(registered.statusCode, 201)
  const device = registered.json()
  assert.match(device.token, /^[A-Za-z0-9_-]{32,}$/)

  const fix = {
    _type: 'location', lat: 55.9533, lon: -3.1883, tst: 1812115200,
    acc: 7, alt: 51, vel: 4.5, cog: 90, batt: 82,
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.inject({
      method: 'POST', url: '/api/ingest/track',
      headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
      payload: fix,
    })
    assert.equal(response.statusCode, 200)
  }

  const live = await app.inject({
    method: 'GET', url: `/api/trips/${trip.id}/live?hours=24`, headers: { authorization },
  })
  assert.equal(live.statusCode, 200)
  assert.equal(live.json().devices.length, 1)
  assert.deepEqual(live.json().fixes, [{
    deviceId: device.id, lng: -3.1883, lat: 55.9533,
    accuracy: 7, speed: 1.25, at: '2027-06-04T13:20:00.000Z',
  }])
  assert.equal(Number.isInteger(live.json().cursor), true)

  const newerFix = { ...fix, lat: 55.954, tst: fix.tst + 30 }
  await app.inject({
    method: 'POST', url: '/api/ingest/track',
    headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
    payload: newerFix,
  })
  const delta = await app.inject({
    method: 'GET', url: `/api/trips/${trip.id}/live?cursor=${live.json().cursor}`, headers: { authorization },
  })
  assert.deepEqual(delta.json().fixes.map(value => value.lat), [55.954])
  assert.ok(delta.json().cursor > live.json().cursor)

  await app.close()
})

test('GPS ingestion rejects a phone that exceeds its configured burst limit', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T13:21:00.000Z'),
    ingestRateLimit: { max: 2, windowMs: 60_000 },
  })
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (await app.inject({ method: 'POST', url: '/api/trips', headers, payload: { title: 'GPS trip' } })).json()
  const device = (await app.inject({ method: 'POST', url: `/api/trips/${trip.id}/devices`, headers, payload: { name: 'Phone' } })).json()

  const statuses = []
  for (let index = 0; index < 3; index++) {
    const response = await app.inject({
      method: 'POST', url: '/api/ingest/track', headers: { authorization: `Bearer ${device.token}` },
      payload: { _type: 'location', lat: 52, lon: -3, tst: 1812115200 + index },
    })
    statuses.push(response.statusCode)
    if (index === 2) assert.equal(response.headers['retry-after'], '60')
  }
  assert.deepEqual(statuses, [200, 200, 429])
  await app.close()
})
