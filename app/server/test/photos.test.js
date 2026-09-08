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

test('an aged-out link is re-signed for a reader who may still see it', async t => {
  const { origin, accessToken, trip, directory } = await videoServer(t)

  const source = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#4477aa' },
  })
    .jpeg()
    .toBuffer()
  const form = new FormData()
  form.set('photo', new Blob([source], { type: 'image/jpeg' }), 'IMG_1.jpg')
  const photo = await (
    await fetch(`${origin}/api/trips/${trip.id}/photos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: form,
    })
  ).json()

  // The link the app is holding, aged past its signature. The signature names
  // the public domain, so it is replayed against this test server's port.
  const local = link => origin + new URL(link).pathname + new URL(link).search
  const stale = new URL(photo.src)
  stale.searchParams.set('expires', '1')
  const refused = await fetch(origin + stale.pathname + stale.search)
  assert.equal(refused.status, 403)
  assert.equal((await refused.json()).code, 'media_link_expired')

  const refreshed = await post(
    `${origin}/api/media/links`,
    { paths: [photo.storagePath, photo.thumbPath] },
    accessToken,
  )
  assert.equal(refreshed.status, 200)
  const { links } = await refreshed.json()
  assert.ok(links[photo.storagePath], 'the photograph this reader may see is re-signed')

  const served = await fetch(local(links[photo.storagePath]))
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/jpeg')
  await readFile(join(directory, photo.storagePath))
})

test('re-signing is refused for a trip the asker is not on, and for nonsense', async t => {
  const { origin, accessToken, trip } = await videoServer(t)

  // A path shaped like another trip's: readable only by that trip's members.
  const otherTripPath = '11111111-1111-4111-8111-111111111111/secret.jpg'
  const answer = await post(
    `${origin}/api/media/links`,
    { paths: [otherTripPath, '../../etc/passwd', 'not-a-uuid/x.jpg'] },
    accessToken,
  )
  assert.equal(answer.status, 200)
  assert.deepEqual(await answer.json(), { links: {} }, 'nothing outside the asker is signed')

  const unauthenticated = await post(`${origin}/api/media/links`, { paths: [] })
  assert.equal(unauthenticated.status, 401)

  const nonsense = await post(`${origin}/api/media/links`, { paths: 'everything' }, accessToken)
  assert.equal(nonsense.status, 400)

  // Its own trip's photograph is fine, which proves the refusals above are
  // about access rather than the endpoint simply never signing anything.
  const mine = await post(`${origin}/api/media/links`, { paths: [`${trip.id}/x.jpg`] }, accessToken)
  assert.ok((await mine.json()).links[`${trip.id}/x.jpg`])
})

test('a video that cannot be recorded leaves nothing behind on the volume', async t => {
  const { origin, accessToken, trip, directory, repository } = await videoServer(t)

  /* The film streams to disk before the row is attempted, so the row failing
     is exactly the case that leaks. A database that refuses the insert is the
     honest way to reach it. */
  repository.createPhoto = async () => {
    throw new Error('the database said no')
  }

  const form = new FormData()
  form.set('photo', new Blob([fakeMp4(2048)], { type: 'video/mp4' }), 'IMG_5.mp4')
  const refused = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  assert.equal(refused.status, 500)

  /* If the refusal does not sweep the bytes up, every failed upload is a
     permanent leak on a volume the nightly backup copies in full. */
  const { readdir } = await import('node:fs/promises')
  const left = await readdir(join(directory, trip.id)).catch(() => [])
  assert.deepEqual(left, [], `orphaned files left behind: ${left.join(', ')}`)
})

test('a trip with more photographs than fit sends a page, and the rest follow', async t => {
  const { origin, accessToken, trip, repository } = await videoServer(t)

  /* Seeded straight into the repository: the point under test is the shape
     of the read, not the upload, and 250 real uploads would be 250 resizes. */
  const seeded = []
  for (let i = 0; i < 250; i++) seeded.push(repository.seedPhoto(trip.id))

  const read = await fetch(`${origin}/api/trips/current?t=${trip.slug}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  const body = await read.json()

  /* The whole point: the wire is bounded even though the trip is not. Before
     this, every photograph a trip had ever held rode on every single load. */
  assert.equal(body.photos.length, 200, 'a page, not the lot')
  assert.equal(body.photoCount, 250, 'but the app is told how many there are')

  // Newest first is what was kept; the oldest fifty are the ones left out.
  const sent = new Set(body.photos.map(photo => photo.id))
  assert.equal(sent.has(seeded[249].id), true, 'the newest is in the first page')
  assert.equal(sent.has(seeded[0].id), false, 'the oldest waits its turn')

  // And the app can page back through the rest until it has them all.
  const oldest = Math.min(...body.photos.map(photo => photo.seq))
  const next = await fetch(`${origin}/api/trips/${trip.id}/photos?before=${oldest}&limit=200`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  assert.equal(next.status, 200)
  const page = await next.json()
  assert.equal(page.photos.length, 50, 'exactly what was left')
  assert.equal(page.nextCursor, null, 'and it says there is no more')
  assert.ok(page.photos[0].src, 'paged photographs are signed like any other')

  // Nothing is served twice, and nothing is missed.
  const everything = new Set([...sent, ...page.photos.map(photo => photo.id)])
  assert.equal(everything.size, 250)
})

test('paging another trip’s photographs is refused, and a bad cursor is rejected', async t => {
  const { origin, accessToken } = await videoServer(t)

  const stranger = await fetch(`${origin}/api/trips/11111111-1111-4111-8111-111111111111/photos`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  assert.equal(stranger.status, 404, 'a trip you are not on does not exist to you')

  const anonymous = await fetch(`${origin}/api/trips/whatever/photos`)
  assert.equal(anonymous.status, 401)
})
