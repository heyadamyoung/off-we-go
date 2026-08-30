import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createMobileTracker } from '../src/mobileTrackingCore.js'
import * as mobilePhotos from '../src/mobilePhotosCore.js'
import { magicTokenFromUrl } from '../src/mobileAuthCore.js'

const { galleryPhotosToFiles } = mobilePhotos

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    async get({ key }) { return { value: values.get(key) ?? null } },
    async set({ key, value }) { values.set(key, value) },
    async remove({ key }) { values.delete(key) },
  }
}

test('a permanently rejected fix is discarded so a later fix can be delivered', async () => {
  const delivered = []
  const url = await endpoint(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const fix = JSON.parse(body)
    if (fix.lat === 51) {
      response.writeHead(400)
      response.end('invalid fix')
      return
    }
    delivered.push(fix.lat)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  const driver = locationDriver()
  const tracker = createMobileTracker({ driver, storage: memoryStorage(), fetch })
  await tracker.configure({ endpoint: url, token: 'device-token-at-least-sixteen', deviceId: 'phone-1', name: 'Phone' })

  await driver.emit({ latitude: 51, longitude: -1, time: 1_788_000_000_000 })
  await driver.emit({ latitude: 52, longitude: -2, time: 1_788_000_030_000 })

  assert.deepEqual(delivered, [52])
  assert.equal(tracker.getState().queued, 0)
  assert.equal(tracker.getState().status, 'tracking')
})

test('a revoked device token stops location services and clears saved fixes', async () => {
  const url = await endpoint((_request, response) => {
    response.writeHead(401)
    response.end('revoked')
  })
  const storage = memoryStorage()
  const driver = locationDriver()
  const tracker = createMobileTracker({ driver, storage, fetch })
  await tracker.configure({ endpoint: url, token: 'device-token-at-least-sixteen', deviceId: 'phone-1', name: 'Phone' })

  await driver.emit({ latitude: 51, longitude: -1, time: 1_788_000_000_000 })

  assert.deepEqual(driver.removed, ['watch-1'])
  assert.equal(tracker.getState().status, 'stopped')
  assert.equal(tracker.getState().configured, false)
  assert.equal(tracker.getState().queued, 0)
  const relaunched = createMobileTracker({ driver: locationDriver(), storage, fetch })
  assert.equal(await relaunched.restore(), false)
})

test('offline fixes older than the server retention window are removed without transmission', async () => {
  let requests = 0
  const url = await endpoint((_request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  const now = 1_800_000_000_000
  const staleAt = now - 31 * 24 * 60 * 60 * 1000
  const storage = memoryStorage({
    'wayfare.mobile-tracking.queue.v1': JSON.stringify([{
      at: staleAt,
      payload: { _type: 'location', lat: 51, lon: -1, tst: Math.floor(staleAt / 1000) },
    }]),
  })
  const tracker = createMobileTracker({ driver: locationDriver(), storage, fetch, now: () => now })

  await tracker.configure({ endpoint: url, token: 'device-token-at-least-sixteen', deviceId: 'phone-1', name: 'Phone' })

  assert.equal(requests, 0)
  assert.equal(tracker.getState().queued, 0)
})

test('Retry-After prevents background fixes from hammering a rate-limited backend', async () => {
  let clock = 1_800_000_000_000
  let requests = 0
  const delivered = []
  const url = await endpoint(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests++
    if (requests === 1) {
      response.writeHead(429, { 'retry-after': '60' })
      response.end('slow down')
      return
    }
    delivered.push(JSON.parse(body).lat)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  const driver = locationDriver()
  const tracker = createMobileTracker({ driver, storage: memoryStorage(), fetch, now: () => clock })
  await tracker.configure({ endpoint: url, token: 'device-token-at-least-sixteen', deviceId: 'phone-1', name: 'Phone' })

  await driver.emit({ latitude: 51, longitude: -1, time: clock })
  clock += 30_000
  await driver.emit({ latitude: 52, longitude: -2, time: clock })
  assert.equal(requests, 1)
  assert.equal(tracker.getState().queued, 2)

  clock += 31_000
  await driver.emit({ latitude: 53, longitude: -3, time: clock })
  assert.deepEqual(delivered, [51, 52, 53])
  assert.equal(tracker.getState().queued, 0)
})

function locationDriver() {
  let callback = null
  return {
    options: null,
    removed: [],
    async addWatcher(options, next) {
      this.options = options
      callback = next
      return 'watch-1'
    },
    async removeWatcher({ id }) { this.removed.push(id) },
    async emit(location, error) { return callback(location, error) },
  }
}

async function endpoint(handler) {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}/track`
}

test('a background location is authenticated and transmitted in the backend OwnTracks format', async () => {
  const received = []
  const url = await endpoint(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    received.push({ method: request.method, authorization: request.headers.authorization, body: JSON.parse(body) })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  const driver = locationDriver()
  const tracker = createMobileTracker({ driver, storage: memoryStorage(), fetch })

  await tracker.configure({ endpoint: url, token: 'device-token-at-least-sixteen', deviceId: 'phone-1', name: "Sample iPhone" })
  await driver.emit({
    latitude: 52.370216,
    longitude: 4.895168,
    accuracy: 7,
    altitude: 14,
    speed: 1.5,
    bearing: 123,
    time: 1_788_000_123_456,
    simulated: false,
  })

  assert.deepEqual(received, [{
    method: 'POST',
    authorization: 'Bearer device-token-at-least-sixteen',
    body: {
      _type: 'location',
      lat: 52.370216,
      lon: 4.895168,
      tst: 1_788_000_123,
      acc: 7,
      alt: 14,
      vel: 5.4,
      cog: 123,
    },
  }])
  assert.equal(tracker.getState().status, 'tracking')
  assert.equal(tracker.getState().lastSentAt, 1_788_000_123_456)
  assert.equal(driver.options.requestPermissions, true)
  assert.equal(driver.options.distanceFilter, 10)
})

test('an offline fix is queued and delivered before the next live fix', async () => {
  const received = []
  let available = false
  const url = await endpoint(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (!available) {
      response.writeHead(503)
      response.end('offline')
      return
    }
    received.push(JSON.parse(body))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  const storage = memoryStorage()
  const driver = locationDriver()
  const tracker = createMobileTracker({ driver, storage, fetch })
  await tracker.configure({ endpoint: url, token: 'device-token-at-least-sixteen', deviceId: 'phone-1', name: 'Phone' })

  await driver.emit({ latitude: 51, longitude: -1, accuracy: 9, speed: 0, time: 1_788_000_000_000 })
  assert.equal(tracker.getState().queued, 1)
  assert.equal(tracker.getState().status, 'waiting')

  available = true
  await driver.emit({ latitude: 52, longitude: -2, accuracy: 8, speed: 2, time: 1_788_000_030_000 })

  assert.deepEqual(received.map(fix => [fix.lat, fix.lon]), [[51, -1], [52, -2]])
  assert.equal(tracker.getState().queued, 0)
  assert.equal(tracker.getState().status, 'tracking')
})

test('saved tracking configuration restarts until the user pauses it', async () => {
  const url = await endpoint((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  const storage = memoryStorage()
  const firstDriver = locationDriver()
  const first = createMobileTracker({ driver: firstDriver, storage, fetch })
  await first.configure({ endpoint: url, token: 'device-token-at-least-sixteen', deviceId: 'phone-1', name: 'Phone' })

  const relaunchedDriver = locationDriver()
  const relaunched = createMobileTracker({ driver: relaunchedDriver, storage, fetch })
  assert.equal(await relaunched.restore(), true)
  assert.equal(relaunched.getState().status, 'tracking')

  await relaunched.stop()
  assert.deepEqual(relaunchedDriver.removed, ['watch-1'])
  assert.equal(relaunched.getState().status, 'stopped')

  const pausedRelaunchDriver = locationDriver()
  const pausedRelaunch = createMobileTracker({ driver: pausedRelaunchDriver, storage, fetch })
  assert.equal(await pausedRelaunch.restore(), true)
  assert.equal(pausedRelaunch.getState().configured, true)
  assert.equal(pausedRelaunch.getState().status, 'stopped')
  assert.equal(pausedRelaunchDriver.options, null)

  await pausedRelaunch.forget()
  const signedOutRelaunch = createMobileTracker({ driver: locationDriver(), storage, fetch })
  assert.equal(await signedOutRelaunch.restore(), false)
})

test('Apple Photos selections become uploadable JPEG files in selection order', async () => {
  const files = await galleryPhotosToFiles([
    { webPath: 'data:image/jpeg;base64,AQID', format: 'jpeg', exif: {
      DateTimeOriginal: '2026:08:30 14:20:00',
      GPS: { Latitude: 52.370216, LatitudeRef: 'N', Longitude: 4.895168, LongitudeRef: 'E' },
    } },
    { webPath: 'data:image/jpeg;base64,BAUG', format: 'jpeg' },
  ], { fetch, stamp: 1_788_000_000_000 })

  assert.deepEqual(files.map(file => ({ name: file.name, type: file.type, size: file.size })), [
    { name: 'wayfare-1788000000000-1.jpg', type: 'image/jpeg', size: 3 },
    { name: 'wayfare-1788000000000-2.jpg', type: 'image/jpeg', size: 3 },
  ])
  assert.deepEqual(files[0].wayfareMetadata, {
    lat: 52.370216,
    lng: 4.895168,
    takenAt: new Date(2026, 7, 30, 14, 20, 0).toISOString(),
  })
})

test('an older photo without EXIF coordinates reaches the backend without the current live position', () => {
  assert.ok(mobilePhotos.photoUploadMetadata, 'photo upload metadata forwarding has not been implemented')
  assert.deepEqual(mobilePhotos.photoUploadMetadata({
    caption: 'Old bridge', stopId: null, when: '2026-08-01T12:00:00.000Z', order: 2,
  }, { by: 'Maya', nextSequence: 10 }), {
    caption: 'Old bridge', stopId: null, when: '2026-08-01T12:00:00.000Z',
    by: 'Maya', seq: 12,
  })
  assert.deepEqual(mobilePhotos.photoUploadMetadata({
    caption: 'Harbour', stopId: 'stop-1', lng: 4.9, lat: 52.3,
    locationSource: 'exif', uploadKey: 'photo-retry-key-1234', when: '2026-08-01T12:01:00.000Z', order: 0,
  }, { by: 'Maya', nextSequence: 10 }), {
    caption: 'Harbour', stopId: 'stop-1', lng: 4.9, lat: 52.3,
    locationSource: 'exif', uploadKey: 'photo-retry-key-1234',
    when: '2026-08-01T12:01:00.000Z', by: 'Maya', seq: 10,
  })
})

test('a Wayfare magic-link callback exposes the one-time VPS login token', () => {
  assert.equal(magicTokenFromUrl(
    'https://wayfare.example.com/auth/callback?token=one-time-login-token-at-least-thirty-two-characters',
  ), 'one-time-login-token-at-least-thirty-two-characters')
  assert.equal(magicTokenFromUrl('https://example.com/not-a-login'), null)
  assert.equal(magicTokenFromUrl('wayfare://auth?token=one-time-login-token-at-least-thirty-two-characters'), null)
})
