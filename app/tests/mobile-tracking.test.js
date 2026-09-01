import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import sharp from 'sharp'
import { createMobileTracker } from '../src/mobile-tracking-core.ts'
import * as mobilePhotos from '../src/mobile-photos-core.ts'
import {
  browserLoginHandoffFromUrl, completeNativeLogin, loginHandoffFromUrl, nativeAppUrlFromUrl,
} from '../src/mobile-auth-core.ts'

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

test('background location tells the user that Off We Go is sharing their position', async () => {
  const driver = locationDriver()
  const tracker = createMobileTracker({ driver, storage: memoryStorage(), fetch })

  await tracker.configure({
    endpoint: 'https://offwego.to/api/ingest/track',
    token: 'device-token-at-least-sixteen',
    deviceId: 'phone-1',
    name: 'Phone',
  })

  assert.equal(driver.options.backgroundTitle, 'Off We Go location sharing')
  assert.equal(driver.options.backgroundMessage,
    'Your trip location is being shared with your Off We Go group.')
  await tracker.stop()
})

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

test('Android requests notification access before starting background location', async () => {
  const platformCore = await import('../src/mobile-platform-core.ts').catch(() => null)
  assert.ok(platformCore?.createNativeLocationDriver, 'the Android location driver is missing')
  const events = []
  const backgroundGeolocation = {
    async addWatcher(options, listener) {
      events.push('location')
      assert.equal(options.backgroundTitle, 'Off We Go location sharing')
      assert.equal(typeof listener, 'function')
      return 'watch-1'
    },
    async removeWatcher() {},
  }
  const localNotifications = {
    async checkPermissions() {
      events.push('check-notifications')
      return { display: 'prompt' }
    },
    async requestPermissions() {
      events.push('request-notifications')
      return { display: 'granted' }
    },
  }
  const driver = platformCore.createNativeLocationDriver({
    backgroundGeolocation, localNotifications, platform: 'android',
  })

  assert.equal(await driver.addWatcher({ backgroundTitle: 'Off We Go location sharing' }, () => {}), 'watch-1')
  assert.deepEqual(events, ['check-notifications', 'request-notifications', 'location'])
})

test('Android does not start background location when its tracking notification is denied', async () => {
  const { createNativeLocationDriver } = await import('../src/mobile-platform-core.ts')
  let started = false
  const driver = createNativeLocationDriver({
    platform: 'android',
    backgroundGeolocation: {
      async addWatcher() { started = true },
      async removeWatcher() {},
    },
    localNotifications: {
      async checkPermissions() { return { display: 'denied' } },
      async requestPermissions() { return { display: 'denied' } },
    },
  })

  await assert.rejects(
    driver.addWatcher({}, () => {}),
    /allow notifications/i,
  )
  assert.equal(started, false)
})

test('Android sends background fixes through native HTTP after the WebView is throttled', async () => {
  const platformCore = await import('../src/mobile-platform-core.ts')
  assert.ok(platformCore.createNativeTrackingFetch, 'the Android native HTTP adapter is missing')
  let request = null
  const nativeHttp = {
    async request(options) {
      request = options
      return { status: 429, headers: { 'Retry-After': '60' }, data: 'slow down', url: options.url }
    },
  }
  const backgroundFetch = platformCore.createNativeTrackingFetch({
    nativeHttp, platform: 'android', webFetch: async () => { throw new Error('WebView fetch used') },
  })

  const response = await backgroundFetch('https://wayfare.example.com/api/ingest/track', {
    method: 'POST',
    headers: { authorization: 'Bearer device-token', 'content-type': 'application/json' },
    body: JSON.stringify({ _type: 'location', lat: 51, lon: -1, tst: 1_800_000_000 }),
  })

  assert.deepEqual(request, {
    url: 'https://wayfare.example.com/api/ingest/track',
    method: 'POST',
    headers: { authorization: 'Bearer device-token', 'content-type': 'application/json' },
    data: { _type: 'location', lat: 51, lon: -1, tst: 1_800_000_000 },
  })
  assert.equal(response.status, 429)
  assert.equal(response.ok, false)
  assert.equal(response.headers.get('retry-after'), '60')
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
  assert.deepEqual(mobilePhotos.photoUploadMetadata({
    caption: 'Fallback', fallbackLng: -104.617, fallbackLat: 50.4548,
    fallbackLocationSource: 'approximate', when: '2026-08-01T12:02:00.000Z',
  }, { by: 'Maya', nextSequence: 11 }), {
    caption: 'Fallback', stopId: null, when: '2026-08-01T12:02:00.000Z', by: 'Maya', seq: 11,
    fallbackLng: -104.617, fallbackLat: 50.4548, fallbackLocationSource: 'approximate',
  })
})

test('photo metadata accepts Android rational GPS and browser file EXIF', async () => {
  const android = await galleryPhotosToFiles([{
    webPath: 'data:image/jpeg;base64,AQID', format: 'jpeg', exif: {
      GPSLatitude: '52/1,22/1,127778/10000', GPSLatitudeRef: 'N',
      GPSLongitude: '4/1,53/1,42605/10000', GPSLongitudeRef: 'E',
      DateTimeOriginal: '2026:08:30 14:20:00',
    },
  }], { fetch, stamp: 1_788_000_000_000 })
  assert.equal(Number(android[0].wayfareMetadata.lat.toFixed(6)), 52.370216)
  assert.equal(Number(android[0].wayfareMetadata.lng.toFixed(6)), 4.884517)

  assert.ok(mobilePhotos.readPhotoFilesMetadata, 'browser photo EXIF reading has not been implemented')
  const browserFile = new File([new Uint8Array([1, 2, 3])], 'iphone.heic', { type: 'image/heic' })
  await mobilePhotos.readPhotoFilesMetadata([browserFile], {
    parseExif: async file => {
      assert.equal(file, browserFile)
      return {
        latitude: -33.8568, longitude: 151.2153,
        DateTimeOriginal: new Date('2026-08-30T04:20:00.000Z'),
      }
    },
  })
  assert.deepEqual(browserFile.wayfareMetadata, {
    lat: -33.8568, lng: 151.2153, takenAt: '2026-08-30T04:20:00.000Z',
  })

  assert.ok(mobilePhotos.preparePhotoFilesForUpload, 'browser HEIC conversion has not been implemented')
  const converted = await mobilePhotos.preparePhotoFilesForUpload([browserFile], {
    parseExif: async () => ({ latitude: -33.8568, longitude: 151.2153 }),
    isHeic: async () => true,
    convertHeic: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
  })
  assert.equal(converted[0].name, 'iphone.jpg')
  assert.equal(converted[0].type, 'image/jpeg')
  assert.deepEqual(converted[0].wayfareMetadata, {
    lat: -33.8568, lng: 151.2153, takenAt: '2026-08-30T04:20:00.000Z',
  })

  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#336699' },
  }).jpeg().withExif({ IFD3: {
    GPSLatitudeRef: 'S', GPSLatitude: '33/1 51/1 2448/100',
    GPSLongitudeRef: 'E', GPSLongitude: '151/1 12/1 5508/100',
  } }).toBuffer()
  const actualExif = new Uint8Array(jpeg)
  await mobilePhotos.readPhotoFilesMetadata([actualExif])
  assert.equal(actualExif.wayfareMetadata.lat, -33.8568)
  assert.equal(Number(actualExif.wayfareMetadata.lng.toFixed(4)), 151.2153)
})

test('photo placement distinguishes embedded GPS from a displayed fallback position', () => {
  assert.ok(mobilePhotos.photoPlacement, 'photo placement inspection has not been implemented')
  const stops = [{ id: 'edinburgh', name: 'Edinburgh', lng: -3.1880, lat: 55.9530 }]

  assert.deepEqual(mobilePhotos.photoPlacement({ wayfareMetadata: {
    lng: -3.1883, lat: 55.9533, takenAt: '2026-08-31T12:00:00.000Z',
  } }, { live: [4.8686, 52.3664], stops }), {
    point: [-3.1883, 55.9533], fallbackPoint: null, previewPoint: [-3.1883, 55.9533],
    stopId: 'edinburgh', stopName: 'Edinburgh', source: 'exif', hasEmbeddedGps: true,
  })

  assert.deepEqual(mobilePhotos.photoPlacement({ wayfareMetadata: {
    takenAt: '2026-08-31T12:00:00.000Z',
  } }, { live: [4.8686, 52.3664], stops, fallbackSource: 'approximate' }), {
    point: null, fallbackPoint: [4.8686, 52.3664], previewPoint: [4.8686, 52.3664],
    stopId: null, stopName: null, source: 'history', fallbackSource: 'approximate', hasEmbeddedGps: false,
  })
})

test('a Off We Go OIDC callback exposes the one-time login handoff', () => {
  const token = 'one-time-login-token-at-least-thirty-two-characters'
  assert.equal(loginHandoffFromUrl(`https://wayfare.example.com/auth/callback?token=${token}`), token)
  assert.equal(loginHandoffFromUrl(`https://wayfare.example.com/auth/native?token=${token}`), token)
  assert.equal(loginHandoffFromUrl(`wayfare://auth?token=${token}`), token)
  assert.equal(loginHandoffFromUrl('https://example.com/not-a-login'), null)
  assert.equal(loginHandoffFromUrl(`other-app://auth?token=${token}`), null)
})

test('the website exchanges only its callback and leaves a native handoff token untouched', () => {
  const token = 'one-time-login-token-at-least-thirty-two-characters'
  assert.equal(browserLoginHandoffFromUrl(`https://wayfare.example.com/auth/callback?token=${token}`), token)
  assert.equal(browserLoginHandoffFromUrl(`https://wayfare.example.com/auth/native?token=${token}`), null)
  assert.equal(browserLoginHandoffFromUrl(`wayfare://auth?token=${token}`), null)
})

test('an Outlook browser handoff produces an explicit Off We Go app URL', () => {
  const token = 'one-time-login-token-at-least-thirty-two-characters'
  assert.equal(
    nativeAppUrlFromUrl(`https://wayfare.example.com/auth/native?token=${token}`),
    `wayfare://auth?token=${token}`,
  )
  assert.equal(nativeAppUrlFromUrl(`https://wayfare.example.com/auth/callback?token=${token}`), null)
})

test('native OIDC handoff reports progress and contains exchange failures', async () => {
  const states = []
  const handled = await completeNativeLogin(
    'https://wayfare.example.com/auth/callback?token=one-time-login-token-at-least-thirty-two-characters',
    { async exchangeLoginHandoff() { throw new Error('The sign-in handoff expired') } },
    state => states.push(state),
  )

  assert.equal(handled, false)
  assert.deepEqual(states, [
    { status: 'exchanging', error: null },
    { status: 'error', error: 'The sign-in handoff expired' },
  ])
})

test('native OIDC cancellation returns an error without attempting token exchange', async () => {
  const states = []
  const message = 'Sign-in was cancelled or could not be completed'
  const url = `https://wayfare.example.com/auth/native?error=${encodeURIComponent(message)}`
  const expectedAppUrl = new URL('wayfare://auth')
  expectedAppUrl.searchParams.set('error', message)
  assert.equal(nativeAppUrlFromUrl(url), expectedAppUrl.href)
  const handled = await completeNativeLogin(
    url,
    { async exchangeLoginHandoff() { throw new Error('must not exchange') } },
    state => states.push(state),
  )
  assert.equal(handled, true)
  assert.deepEqual(states, [{ status: 'error', error: message }])
})
