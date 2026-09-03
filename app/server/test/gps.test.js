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
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T13:21:00.000Z'),
  })

  const authorization = await authenticate(repository, 'owner@example.com')
  const created = await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization },
    payload: { title: 'GPS trip' },
  })
  const trip = created.json()

  const registered = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/devices`,
    headers: { authorization },
    payload: { name: 'Sample iPhone', timezone: 'America/Regina' },
  })
  assert.equal(registered.statusCode, 201)
  const device = registered.json()
  assert.match(device.token, /^[A-Za-z0-9_-]{32,}$/)

  const olderFix = {
    _type: 'location',
    lat: 55.94,
    lon: -3.2,
    tst: Math.floor(new Date('2027-05-15T13:20:00.000Z').getTime() / 1000),
    acc: 9,
    vel: 0,
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/ingest/track',
        headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
        payload: olderFix,
      })
    ).statusCode,
    200,
  )

  const fix = {
    _type: 'location',
    lat: 55.9533,
    lon: -3.1883,
    tst: 1812115200,
    acc: 7,
    alt: 51,
    vel: 4.5,
    cog: 90,
    batt: 82,
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/track',
      headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
      payload: fix,
    })
    assert.equal(response.statusCode, 200)
  }

  const live = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/live?hours=24`,
    headers: { authorization },
  })
  assert.equal(live.statusCode, 200)
  assert.equal(live.json().devices.length, 1)
  assert.deepEqual(live.json().fixes, [
    {
      deviceId: device.id,
      lng: -3.1883,
      lat: 55.9533,
      accuracy: 7,
      speed: 1.25,
      at: '2027-06-04T13:20:00.000Z',
    },
  ])
  assert.equal(Number.isInteger(live.json().cursor), true)

  const tripHistory = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/live?hours=720`,
    headers: { authorization },
  })
  assert.equal(
    tripHistory.json().fixes.some(value => value.at === '2027-05-15T13:20:00.000Z'),
    true,
  )

  const newerFix = { ...fix, lat: 55.954, tst: fix.tst + 30 }
  await app.inject({
    method: 'POST',
    url: '/api/ingest/track',
    headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
    payload: newerFix,
  })
  const delta = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/live?cursor=${live.json().cursor}`,
    headers: { authorization },
  })
  assert.deepEqual(
    delta.json().fixes.map(value => value.lat),
    [55.954],
  )
  assert.ok(delta.json().cursor > live.json().cursor)

  await app.close()
})

test('GPS ingestion rejects a phone that exceeds its configured burst limit', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T13:21:00.000Z'),
    ingestRateLimit: { max: 2, windowMs: 60_000 },
  })
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (
    await app.inject({ method: 'POST', url: '/api/trips', headers, payload: { title: 'GPS trip' } })
  ).json()
  const device = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/devices`,
      headers,
      payload: { name: 'Phone' },
    })
  ).json()

  const statuses = []
  for (let index = 0; index < 3; index++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/track',
      headers: { authorization: `Bearer ${device.token}` },
      payload: { _type: 'location', lat: 52, lon: -3, tst: 1812115200 + index },
    })
    statuses.push(response.statusCode)
    if (index === 2) assert.equal(response.headers['retry-after'], '60')
  }
  assert.deepEqual(statuses, [200, 200, 429])
  await app.close()
})

const serverFor = repository =>
  buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T13:21:00.000Z'),
  })

test('a reported pause is stored, exposed to the trip, and cleared by the next fix', async () => {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await serverFor(repository)
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers,
      payload: { title: 'Pause trip' },
    })
  ).json()
  const device = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/devices`,
      headers,
      payload: { name: 'Phone' },
    })
  ).json()

  await app.inject({
    method: 'POST',
    url: '/api/ingest/track',
    headers: { authorization: `Bearer ${device.token}` },
    payload: { _type: 'location', lat: 52, lon: 4.8, tst: 1812115000 },
  })
  const paused = await app.inject({
    method: 'POST',
    url: '/api/ingest/track',
    headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
    payload: { paused: true },
  })
  assert.equal(paused.statusCode, 200)

  const live = (
    await app.inject({ method: 'GET', url: `/api/trips/${trip.id}/live?hours=720`, headers })
  ).json()
  assert.equal(live.devices[0].pausedAt, '2027-06-04T13:21:00.000Z')

  // One minute after the pause, and inside the ingest window's clock tolerance.
  await app.inject({
    method: 'POST',
    url: '/api/ingest/track',
    headers: { authorization: `Bearer ${device.token}` },
    payload: { _type: 'location', lat: 52.001, lon: 4.8, tst: 1812115260 },
  })
  const resumed = (
    await app.inject({ method: 'GET', url: `/api/trips/${trip.id}/live?hours=720`, headers })
  ).json()
  assert.equal(resumed.devices[0].pausedAt, null)
  await app.close()
})

test('history inside a saved home zone never leaves the server', async () => {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await serverFor(repository)
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers,
      payload: { title: 'Home trip' },
    })
  ).json()
  const device = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/devices`,
      headers,
      payload: { name: 'Phone' },
    })
  ).json()

  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/profile',
    headers,
    payload: { homePlace: 'Home', homeLat: 52.0, homeLng: 4.8 },
  })
  assert.equal(saved.statusCode, 200)

  const send = (lat, lon, tst) =>
    app.inject({
      method: 'POST',
      url: '/api/ingest/track',
      headers: { authorization: `Bearer ${device.token}` },
      payload: { _type: 'location', lat, lon, tst, acc: 5 },
    })
  await send(52.0001, 4.8, 1812115000) // ~11 m from home: history, masked
  await send(52.05, 4.8, 1812115060) // ~5.5 km away: kept
  await send(52.0001, 4.8001, 1812115120) // at home but the LATEST fix: kept for live presence

  const live = (
    await app.inject({ method: 'GET', url: `/api/trips/${trip.id}/live?hours=720`, headers })
  ).json()
  assert.deepEqual(
    live.fixes.map(fix => fix.lat),
    [52.05, 52.0001],
  )
  await app.close()
})

test('a rotated setup token kills the old one and hands back exactly one new one', async () => {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await serverFor(repository)
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers,
      payload: { title: 'Rotate trip' },
    })
  ).json()
  const device = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/devices`,
      headers,
      payload: { name: 'Phone' },
    })
  ).json()

  const rotated = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/devices/${device.id}/token`,
    headers,
  })
  assert.equal(rotated.statusCode, 200)
  const fresh = rotated.json()
  assert.match(fresh.token, /^[A-Za-z0-9_-]{32,}$/)
  assert.notEqual(fresh.token, device.token)

  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/ingest/track',
        headers: { authorization: `Bearer ${device.token}` },
        payload: { _type: 'location', lat: 52, lon: 4.8, tst: 1812115000 },
      })
    ).statusCode,
    401,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/ingest/track',
        headers: { authorization: `Bearer ${fresh.token}` },
        payload: { _type: 'location', lat: 52, lon: 4.8, tst: 1812115060 },
      })
    ).statusCode,
    200,
  )
  await app.close()
})

test('expired positions are pruned to honour the 30-day promise', async () => {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const device = { id: 'device-prune', tripId: 'trip-prune' }
  await repository.insertPosition(device, {
    lng: 4.8,
    lat: 52,
    accuracy: 5,
    at: new Date('2027-05-01T00:00:00.000Z'),
  })
  await repository.insertPosition(device, {
    lng: 4.8,
    lat: 52,
    accuracy: 5,
    at: new Date('2027-06-04T00:00:00.000Z'),
  })

  const removed = await repository.prunePositions(new Date('2027-06-04T13:00:00.000Z'))
  assert.equal(removed, 1)
})
