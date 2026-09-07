import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const filesModule = await import('../src/files.js').catch(() => null)

async function post(url, body, token) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

test('a photo upload stores resized derivatives and returns an expiring private URL', async t => {
  assert.ok(filesModule?.createDiskFileStore, 'the VPS photo store has not been implemented')
  const directory = await mkdtemp(join(tmpdir(), 'offwego-photos-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: filesModule.createDiskFileStore({ directory }),
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const tripResponse = await post(`${origin}/api/trips`, { title: 'Photo trip' }, accessToken)
  const trip = await tripResponse.json()

  const source = await sharp({
    create: { width: 3200, height: 2400, channels: 3, background: '#c87842' },
  })
    .jpeg({ quality: 95 })
    .toBuffer()
  const form = new FormData()
  form.set('file', new Blob([source], { type: 'image/jpeg' }), 'IMG_0001.jpg')
  form.set('caption', 'On the ridge')
  form.set('lng', '-3.1883')
  form.set('lat', '55.9533')
  form.set('takenAt', '2027-06-04T13:20:00.000Z')
  form.set('locationSource', 'exif')
  form.set('uploadKey', '01J8PHOTOUPLOADKEY000000000001')

  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  assert.equal(uploaded.status, 201)
  const photo = await uploaded.json()
  assert.equal(photo.caption, 'On the ridge')
  assert.equal(photo.lng, -3.1883)
  assert.equal(photo.lat, 55.9533)
  assert.equal(photo.locationSource, 'exif')
  assert.match(photo.src, /^https:\/\/offwego\.example\.com\/api\/media\//)

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
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: retryForm,
  })
  assert.equal(retried.status, 200)
  assert.equal((await retried.json()).id, photo.id)
})

/* A tiny but structurally real MP4: an ftyp box declaring isom, then an
   mdat holding the "film". Enough for a byte-for-byte store-and-serve test
   without checking a binary into the repository. */
function fakeMp4(payloadBytes = 4096) {
  const ftyp = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isomiso2'),
  ])
  const payload = Buffer.alloc(payloadBytes)
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length + 8, 0)
  header.write('mdat', 4)
  return Buffer.concat([ftyp, header, payload])
}

async function videoServer(t, { maxVideoBytes } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'offwego-videos-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: filesModule.createDiskFileStore({ directory }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    ...(maxVideoBytes ? { maxVideoBytes } : {}),
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await (
    await post(`${origin}/api/trips`, { title: 'Video trip' }, accessToken)
  ).json()
  return { origin, accessToken, trip, directory, repository }
}

test('a video is stored as filmed, keeps its poster frame, and streams by range', async t => {
  assert.ok(filesModule?.createDiskFileStore, 'the VPS photo store has not been implemented')
  const { origin, accessToken, trip, directory } = await videoServer(t)

  const film = fakeMp4()
  const poster = await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: '#2f6f4f' },
  })
    .jpeg({ quality: 90 })
    .toBuffer()

  const form = new FormData()
  form.set('photo', new Blob([film], { type: 'video/mp4' }), 'IMG_0002.mp4')
  form.set('poster', new Blob([poster], { type: 'image/jpeg' }), 'IMG_0002.poster.jpg')
  form.set('caption', 'The funicular')
  form.set('lng', '-3.1883')
  form.set('lat', '55.9533')
  form.set('locationSource', 'manual')
  form.set('durationMs', '12500')

  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  assert.equal(uploaded.status, 201)
  const video = await uploaded.json()
  assert.equal(video.kind, 'video')
  assert.equal(video.mime, 'video/mp4')
  assert.equal(video.durationMs, 12500)
  assert.equal(video.caption, 'The funicular')
  assert.match(video.storagePath, /\.mp4$/)
  assert.ok(video.posterSrc, 'a video without a poster is a grey tile everywhere')
  assert.ok(video.thumbSrc)

  // Bytes in, bytes out: a re-encode on the box would be a worse film.
  const stored = await readFile(join(directory, video.storagePath))
  assert.deepEqual(stored, film)

  const link = new URL(video.src)
  const served = await fetch(origin + link.pathname + link.search)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'video/mp4')
  assert.equal(served.headers.get('accept-ranges'), 'bytes')
  assert.equal(Number(served.headers.get('content-length')), film.length)

  // Seeking is a range request; answering 200-with-everything would make
  // every scrub re-download the film from the top.
  const ranged = await fetch(origin + link.pathname + link.search, {
    headers: { range: 'bytes=100-199' },
  })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), `bytes 100-199/${film.length}`)
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), film.subarray(100, 200))

  const suffix = await fetch(origin + link.pathname + link.search, {
    headers: { range: 'bytes=-64' },
  })
  assert.equal(suffix.status, 206)
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), film.subarray(film.length - 64))

  const past = await fetch(origin + link.pathname + link.search, {
    headers: { range: `bytes=${film.length + 10}-` },
  })
  assert.equal(past.status, 416)
  assert.equal(past.headers.get('content-range'), `bytes */${film.length}`)

  // The poster is a photograph again: resized, and served as one.
  const posterLink = new URL(video.posterSrc)
  const posterServed = await fetch(origin + posterLink.pathname + posterLink.search)
  assert.equal(posterServed.status, 200)
  assert.equal(posterServed.headers.get('content-type'), 'image/jpeg')
  const drawn = await sharp(Buffer.from(await posterServed.arrayBuffer())).metadata()
  assert.equal(drawn.width, 1920)

  // The trip contract carries the kind, so the app knows which one moves.
  const trips = await fetch(`${origin}/api/trips/current?t=${trip.slug}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  assert.equal(trips.status, 200)
  const reloaded = (await trips.json()).photos.find(item => item.id === video.id)
  assert.equal(reloaded.kind, 'video')
  assert.equal(reloaded.durationMs, 12500)
  assert.ok(reloaded.posterSrc)

  // Deleting the film takes its poster and thumbnail with it.
  const removed = await fetch(`${origin}/api/trips/${trip.id}/photos/${video.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
  })
  assert.equal(removed.status, 204)
  for (const path of [video.storagePath, video.posterPath, video.thumbPath]) {
    await assert.rejects(readFile(join(directory, path)), /ENOENT/, `${path} outlived its row`)
  }
})

test('a film the server cannot serve is refused, and one too large says so', async t => {
  const { origin, accessToken, trip } = await videoServer(t, { maxVideoBytes: 64 * 1024 })

  const unknown = new FormData()
  unknown.set('photo', new Blob([fakeMp4(64)], { type: 'video/x-flv' }), 'clip.flv')
  const refused = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: unknown,
  })
  assert.equal(refused.status, 415)
  assert.match((await refused.json()).error, /photos and videos/i)

  const huge = new FormData()
  huge.set('photo', new Blob([fakeMp4(200 * 1024)], { type: 'video/mp4' }), 'long.mp4')
  const bounced = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: huge,
  })
  assert.equal(bounced.status, 413)
  assert.match((await bounced.json()).error, /MB/)
})

test('a video whose poster frame will not decode still lands, without one', async t => {
  const { origin, accessToken, trip } = await videoServer(t)

  const form = new FormData()
  form.set('photo', new Blob([fakeMp4(1024)], { type: 'video/quicktime' }), 'IMG_0003.mov')
  // A phone that handed us something that is not an image after all.
  form.set('poster', new Blob([Buffer.from('not an image')], { type: 'image/jpeg' }), 'p.jpg')

  const uploaded = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  assert.equal(uploaded.status, 201)
  const video = await uploaded.json()
  assert.equal(video.kind, 'video')
  assert.match(video.storagePath, /\.mov$/)
  assert.equal(video.posterSrc, null)
  assert.ok(video.src, 'the film is the point; its poster is not')
})
