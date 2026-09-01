import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const jsonPost = (url, body, token) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})

test('a photo without EXIF coordinates is placed from the uploader GPS trail by capture time', async t => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: {
      async storePhoto({ tripId }) { return { storagePath: `${tripId}/photo.jpg`, thumbPath: `${tripId}/photo.thumb.jpg` } },
      async remove() {}, async read() { return Buffer.from('image') },
    },
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-06-04T13:25:00.000Z'),
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await (await jsonPost(`${origin}/api/trips`, { title: 'Photo trail' }, accessToken)).json()
  const device = await (await jsonPost(`${origin}/api/trips/${trip.id}/devices`, { name: 'iPhone' }, accessToken)).json()
  await jsonPost(`${origin}/api/ingest/track`, {
    _type: 'location', lat: 55.9533, lon: -3.1883, tst: Date.parse('2027-06-04T13:20:00Z') / 1000, acc: 8,
  }, device.token)
  await jsonPost(`${origin}/api/ingest/track`, {
    _type: 'location', lat: 40.7128, lon: -74.0060, tst: Date.parse('2027-06-04T13:21:59Z') / 1000, acc: 1000,
  }, device.token)

  const form = new FormData()
  form.set('photo', new Blob([Buffer.from('jpeg')], { type: 'image/jpeg' }), 'photo.jpg')
  form.set('takenAt', '2027-06-04T13:22:00.000Z')
  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: form,
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
      async storePhoto({ tripId }) { return { storagePath: `${tripId}/photo.jpg`, thumbPath: `${tripId}/photo.thumb.jpg` } },
      async remove() {}, async read() { return Buffer.from('image') },
    },
    mailer: { async send() {} },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await (await jsonPost(`${origin}/api/trips`, { title: 'Photo fallback' }, accessToken)).json()
  const form = new FormData()
  form.set('photo', new Blob([Buffer.from('jpeg')], { type: 'image/jpeg' }), 'photo.jpg')
  form.set('takenAt', '2027-06-04T13:22:00.000Z')
  form.set('fallbackLng', '-104.6170')
  form.set('fallbackLat', '50.4548')
  form.set('fallbackLocationSource', 'approximate')

  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: form,
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
      method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: invalid,
    })
    assert.equal(response.status, 400, JSON.stringify(invalidFields))
  }
})
