import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

const filesModule = await import('../src/files.js').catch(() => null)

async function post(url, body, token) {
  return fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

test('a photo upload stores resized derivatives and returns an expiring private URL', async t => {
  assert.ok(filesModule?.createDiskFileStore, 'the VPS photo store has not been implemented')
  const directory = await mkdtemp(join(tmpdir(), 'wayfare-photos-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: filesModule.createDiskFileStore({ directory }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  await post(`${origin}/api/auth/magic-link`, { email: 'owner@example.com' })
  const magic = new URL(sent[0].webUrl).searchParams.get('token')
  const login = await post(`${origin}/api/auth/exchange`, { token: magic })
  const accessToken = (await login.json()).accessToken
  const tripResponse = await post(`${origin}/api/trips`, { title: 'Photo trip' }, accessToken)
  const trip = await tripResponse.json()

  const source = await sharp({
    create: { width: 3200, height: 2400, channels: 3, background: '#c87842' },
  }).jpeg({ quality: 95 }).toBuffer()
  const form = new FormData()
  form.set('file', new Blob([source], { type: 'image/jpeg' }), 'IMG_0001.jpg')
  form.set('caption', 'On the ridge')
  form.set('lng', '-3.1883')
  form.set('lat', '55.9533')
  form.set('takenAt', '2027-06-04T13:20:00.000Z')
  form.set('locationSource', 'exif')
  form.set('uploadKey', '01J8PHOTOUPLOADKEY000000000001')

  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: form,
  })
  assert.equal(uploaded.status, 201)
  const photo = await uploaded.json()
  assert.equal(photo.caption, 'On the ridge')
  assert.equal(photo.lng, -3.1883)
  assert.equal(photo.lat, 55.9533)
  assert.equal(photo.locationSource, 'exif')
  assert.match(photo.src, /^https:\/\/wayfare\.example\.com\/api\/media\//)

  // The signed URL must also work inside Capacitor, where a root-relative URL
  // would incorrectly resolve to capacitor://localhost.
  const servedPath = new URL(photo.src).pathname + new URL(photo.src).search
  const served = await fetch(origin + servedPath)
  assert.equal(served.status, 200)
  const metadata = await sharp(Buffer.from(await served.arrayBuffer())).metadata()
  assert.equal(metadata.width, 2048)
  assert.equal(metadata.height, 1536)

  const stored = await readFile(join(directory, photo.storagePath))
  assert.ok(stored.length < source.length)
  assert.ok(photo.thumbSrc)

  const retryForm = new FormData()
  retryForm.set('file', new Blob([source], { type: 'image/jpeg' }), 'IMG_0001.jpg')
  retryForm.set('caption', 'On the ridge')
  retryForm.set('uploadKey', '01J8PHOTOUPLOADKEY000000000001')
  const retried = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: retryForm,
  })
  assert.equal(retried.status, 200)
  assert.equal((await retried.json()).id, photo.id)
})
