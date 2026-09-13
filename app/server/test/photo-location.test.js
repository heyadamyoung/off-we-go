import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const jsonPost = (url, body, token) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

test('a photo without EXIF coordinates is placed from the uploader GPS trail by capture time', async t => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: {
      async storePhoto({ tripId }) {
        return { storagePath: `${tripId}/photo.jpg`, thumbPath: `${tripId}/photo.thumb.jpg` }
      },
      async remove() {},
      async read() {
        return Buffer.from('image')
      },
    },
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T13:25:00.000Z'),
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await (
    await jsonPost(`${origin}/api/trips`, { title: 'Photo trail' }, accessToken)
  ).json()
  const device = await (
    await jsonPost(`${origin}/api/trips/${trip.id}/devices`, { name: 'iPhone' }, accessToken)
  ).json()
  await jsonPost(
    `${origin}/api/ingest/track`,
    {
      _type: 'location',
      lat: 55.9533,
      lon: -3.1883,
      tst: Date.parse('2027-06-04T13:20:00Z') / 1000,
      acc: 8,
    },
    device.token,
  )
  await jsonPost(
    `${origin}/api/ingest/track`,
    {
      _type: 'location',
      lat: 40.7128,
      lon: -74.006,
      tst: Date.parse('2027-06-04T13:21:59Z') / 1000,
      acc: 1000,
    },
    device.token,
  )

  const form = new FormData()
  form.set('photo', new Blob([Buffer.from('jpeg')], { type: 'image/jpeg' }), 'photo.jpg')
  form.set('takenAt', '2027-06-04T13:22:00.000Z')
  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  assert.equal(uploaded.status, 201)
  const photo = await uploaded.json()
  assert.equal(photo.lng, -3.1883)
  assert.equal(photo.lat, 55.9533)
  assert.equal(photo.locationSource, 'trail')
})

test('a photo without EXIF coordinates or a matching trail uses its displayed fallback position', async t => {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: {
      async storePhoto({ tripId }) {
        return { storagePath: `${tripId}/photo.jpg`, thumbPath: `${tripId}/photo.thumb.jpg` }
      },
      async remove() {},
      async read() {
        return Buffer.from('image')
      },
    },
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await (
    await jsonPost(`${origin}/api/trips`, { title: 'Photo fallback' }, accessToken)
  ).json()
  const form = new FormData()
  form.set('photo', new Blob([Buffer.from('jpeg')], { type: 'image/jpeg' }), 'photo.jpg')
  form.set('takenAt', '2027-06-04T13:22:00.000Z')
  form.set('fallbackLng', '-104.6170')
  form.set('fallbackLat', '50.4548')
  form.set('fallbackLocationSource', 'approximate')

  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  assert.equal(uploaded.status, 201)
  const photo = await uploaded.json()
  assert.equal(photo.lng, -104.617)
  assert.equal(photo.lat, 50.4548)
  assert.equal(photo.locationSource, 'approximate')

  for (const invalidFields of [
    { lng: '181', lat: '50', locationSource: 'exif' },
    { lng: '-104', locationSource: 'exif' },
    { fallbackLng: '-104', fallbackLat: '91' },
    { lng: '-104', lat: '50', locationSource: 'invented' },
    { fallbackLng: '-104', fallbackLat: '50', fallbackLocationSource: 'invented' },
  ]) {
    const invalid = new FormData()
    invalid.set('photo', new Blob([Buffer.from('jpeg')], { type: 'image/jpeg' }), 'invalid.jpg')
    for (const [key, value] of Object.entries(invalidFields)) invalid.set(key, value)
    const response = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: invalid,
    })
    assert.equal(response.status, 400, JSON.stringify(invalidFields))
  }
})

test('where the phone is standing is not offered as where an old photo was taken', async t => {
  /* Reported from a trip: pictures landing at the place they were uploaded
     from rather than the place they were taken.

     A phone that strips the coordinates on the way out of its own gallery is
     indistinguishable, from here, from a camera that never had any — so this
     is the ordinary case rather than the odd one. A fortnight of holiday
     uploaded from the hotel over one evening was a fortnight of holiday pinned
     to the hotel, every photograph as confident as the last, and nothing on
     the screen admitting that a position had been invented for it.

     So the upload spot is evidence about a photograph taken around now, and
     about nothing else. With no trail to fall back on, a picture from Tuesday
     gets no point at all — it still appears under its own day, where it can be
     dropped on the map by hand, which beats sitting somewhere it never was. */
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: {
      async storePhoto({ tripId }) {
        return { storagePath: `${tripId}/photo.jpg`, thumbPath: `${tripId}/photo.thumb.jpg` }
      },
      async remove() {},
      async read() {
        return Buffer.from('image')
      },
    },
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T21:00:00.000Z'),
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await (
    await jsonPost(`${origin}/api/trips`, { title: 'Evening upload' }, accessToken)
  ).json()

  const upload = async takenAt => {
    const form = new FormData()
    form.set('photo', new Blob([Buffer.from('jpeg')], { type: 'image/jpeg' }), 'photo.jpg')
    if (takenAt) form.set('takenAt', takenAt)
    form.set('fallbackLng', '4.9347')
    form.set('fallbackLat', '52.3796')
    form.set('fallbackLocationSource', 'live')
    const response = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: form,
    })
    assert.equal(response.status, 201)
    return response.json()
  }

  // Taken this morning, uploaded tonight from the hotel. Not the hotel.
  const morning = await upload('2027-06-04T09:15:00.000Z')
  assert.equal(morning.lng, null)
  assert.equal(morning.lat, null)
  assert.equal(morning.locationSource, null)

  // Taken minutes ago: the phone's position is the best thing anybody has.
  const justNow = await upload('2027-06-04T20:44:00.000Z')
  assert.equal(justNow.lng, 4.9347)
  assert.equal(justNow.lat, 52.3796)
  assert.equal(justNow.locationSource, 'live')

  /* And a file that will not say when it was taken keeps the fallback, because
     then there is nothing to contradict it — a screenshot, something sent over
     a chat app, a picture with the block stripped out entirely. */
  const silent = await upload(null)
  assert.equal(silent.lng, 4.9347)
  assert.equal(silent.locationSource, 'live')
})
