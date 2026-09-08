import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/app.js'
import { createDiskFileStore } from '../src/files.js'
import { createMediaWorker } from '../src/media-worker.js'
import { createMemoryRepository } from './memory-repository.js'
import { stubStore } from './fake-bucket.js'
import { authenticate } from './auth-helper.js'

/* What a player actually does with a film, done here over HTTP.

   The ladder is only worth having if a player can walk it: fetch the master
   playlist, follow it to a rendition, follow that to a segment, and get
   bytes each time. Every one of those hops is a separate signed request, and
   the failure this guards against is the quiet one — a playlist served with
   the relative names ffmpeg wrote, whose segments are then all refused. */

const skip =
  spawnSync('ffmpeg', ['-hide_banner', '-version']).status === 0
    ? false
    : 'ffmpeg is not installed on this machine'

const film = (path, { width = 640, height = 360, seconds = 6 } = {}) => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${width}x${height}:rate=25:duration=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${seconds}`,
      '-c:v',
      'libx264',
      '-b:v',
      '3000k',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      path,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  return path
}

async function world(t, { store = null } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'offwego-ladder-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const fileStore = store || createDiskFileStore({ directory })
  const app = await buildServer({
    repository,
    fileStore,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    transcoding: true,
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const created = await fetch(`${origin}/api/trips`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ title: 'Ladder trip' }),
  })
  const worker = createMediaWorker({ repository, fileStore, logger: { warn() {} } })
  return {
    origin,
    accessToken,
    directory,
    repository,
    fileStore,
    worker,
    trip: await created.json(),
  }
}

/* The signed links point at the public domain the app hands out. Replaying
   them against the test's own port is what a browser would do to the host it
   was given — the path and the query are all the signature covers. */
const replay = (origin, url, init) =>
  fetch(`${origin}${new URL(url).pathname}${new URL(url).search}`, init)

async function uploaded(place, file, name = 'IMG.mp4') {
  const form = new FormData()
  form.set('photo', new Blob([await readFile(file)], { type: 'video/mp4' }), name)
  const response = await fetch(`${place.origin}/api/trips/${place.trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${place.accessToken}` },
    body: form,
  })
  assert.equal(response.status, 201)
  const video = await response.json()
  // Convert, then build the ladder: two jobs, in that order.
  await place.worker.runOne()
  await place.worker.runOne()
  const trip = await fetch(`${place.origin}/api/trips/current?t=${place.trip.slug}`, {
    headers: { authorization: `Bearer ${place.accessToken}` },
  })
  return (await trip.json()).photos.find(photo => photo.id === video.id)
}

test('a player can walk the whole ladder, and every link in it is signed', { skip }, async t => {
  const place = await world(t)
  const row = await uploaded(place, film(join(place.directory, 'in.mp4')))
  assert.ok(row.hlsSrc, 'the film is published as a stream')
  assert.ok(row.src, 'and as one file, for anything that cannot stream')

  const master = await replay(place.origin, row.hlsSrc)
  assert.equal(master.status, 200)
  assert.equal(master.headers.get('content-type')?.split(';')[0], 'application/vnd.apple.mpegurl')
  /* Shareable, because links are minted in windows rather than off the clock:
     every reader in one window gets a byte-identical playlist, so an edge can
     answer all of them from one fetch. Not past that window, though — the
     body changes with it. */
  const caching = master.headers.get('cache-control') || ''
  assert.match(caching, /^public,/)
  assert.ok(Number(/max-age=(\d+)/.exec(caching)[1]) <= 3600)
  const masterText = await master.text()
  assert.match(masterText, /#EXTM3U/)

  /* The links inside are absolute and signed. A playlist that kept ffmpeg's
     relative names would have every segment refused by the media route, and
     the film would simply never start. */
  const variants = masterText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
  assert.ok(variants.length >= 1, 'at least one rendition')
  for (const uri of variants) {
    assert.match(uri, /^https:\/\/offwego\.example\.com\/api\/media\//, `relative link: ${uri}`)
    assert.match(uri, /signature=/)
  }

  const variant = await replay(place.origin, variants[0])
  assert.equal(variant.status, 200)
  const variantText = await variant.text()
  assert.match(variantText, /#EXT-X-ENDLIST/, 'a finished film, not a live one')
  const segments = variantText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
  assert.ok(segments.length >= 2, `a six second film is several segments, got ${segments.length}`)

  const segment = await replay(place.origin, segments[0])
  assert.equal(segment.status, 200)
  assert.equal(segment.headers.get('content-type')?.split(';')[0], 'video/mp2t')
  const bytes = Buffer.from(await segment.arrayBuffer())
  assert.ok(bytes.length > 1000, 'a segment with no bytes is a film that does not play')
  // An MPEG-TS packet starts with 0x47, every 188 bytes. This is really video.
  assert.equal(bytes[0], 0x47)
})

test('the renditions are cut at the same instants, or switching stutters', { skip }, async t => {
  const place = await world(t)
  // Big enough that the ladder has more than one rung to switch between.
  const row = await uploaded(
    place,
    film(join(place.directory, 'big.mp4'), { width: 1280, height: 720, seconds: 8 }),
  )

  const masterText = await (await replay(place.origin, row.hlsSrc)).text()
  const variants = masterText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
  assert.ok(variants.length > 1, `a 720p film should offer a choice, got ${variants.length}`)

  const durations = []
  for (const uri of variants) {
    const text = await (await replay(place.origin, uri)).text()
    durations.push([...text.matchAll(/#EXTINF:([0-9.]+)/g)].map(([, value]) => Number(value)))
  }
  /* Every rendition, cut identically. A player changes quality at a segment
     boundary; boundaries that do not line up are a repeated or missing
     second at every switch, which is exactly what somebody walking out of
     wifi would see. */
  for (const list of durations.slice(1)) {
    assert.deepEqual(list, durations[0], 'the renditions disagree about where segments end')
  }

  // And the sizes really are different, or there was nothing to choose from.
  const resolutions = [...masterText.matchAll(/RESOLUTION=(\d+x\d+)/g)].map(([, value]) => value)
  assert.equal(new Set(resolutions).size, resolutions.length, 'two rungs of the same size')
})

test('two people on one trip are handed the very same links', { skip }, async t => {
  const place = await world(t)
  const row = await uploaded(place, film(join(place.directory, 'in.mp4')))

  /* The reason any of this can be cached. Minting against the clock gave two
     readers two URLs for one film — a cache key each, and a hit rate of zero
     however good the edge in front of us was. */
  const invited = await fetch(`${place.origin}/api/trips/${place.trip.id}/invites`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${place.accessToken}`,
    },
    body: JSON.stringify({ email: 'friend@example.com', name: 'Alex', role: 'viewer' }),
  })
  assert.equal(invited.status, 201)
  const second = (await authenticate(place.repository, 'friend@example.com')).slice(7)
  const joined = await fetch(`${place.origin}/api/invites/${(await invited.json()).id}/accept`, {
    method: 'POST',
    headers: { authorization: `Bearer ${second}` },
  })
  assert.equal(joined.status, 200)
  const path = decodeURIComponent(new URL(row.src).pathname.replace('/api/media/', ''))
  const ask = async token => {
    const response = await fetch(`${place.origin}/api/media/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ paths: [path] }),
    })
    return (await response.json()).links[path]
  }
  const mine = await ask(place.accessToken)
  const theirs = await ask(second)
  assert.ok(mine, 'a link came back at all')
  assert.ok(theirs, 'and to the person invited onto the trip as well')
  assert.equal(mine, theirs, 'two readers, one URL, one thing for a cache to hold')
  assert.equal(mine, await ask(place.accessToken), 'and asking twice is not two cache entries')

  /* And the film's own bytes say a shared cache may hold them, which is the
     other half: deterministic URLs that everything refuses to store are no
     better than unique ones. */
  const served = await replay(place.origin, mine)
  assert.equal(served.status, 200)
  assert.match(served.headers.get('cache-control') || '', /^public,.*immutable/)
})

test('a stream is refused to somebody who is not on the trip', { skip }, async t => {
  const place = await world(t)
  const row = await uploaded(place, film(join(place.directory, 'in.mp4')))

  // The playlist, with its signature stripped: this is the guess an outsider makes.
  const bare = new URL(row.hlsSrc)
  const denied = await fetch(`${place.origin}${bare.pathname}`)
  assert.equal(denied.status, 403)

  /* And somebody real but uninvited cannot ask for a fresh link either. The
     batch route re-signs only paths its asker may read, and a film's stream
     is filed under its trip exactly as the film is — so the whole ladder is
     covered by the membership check that covers the film, with no rule of
     its own to fall out of step. */
  const nosy = (await authenticate(place.repository, 'nosy@example.com')).slice(7)
  const path = decodeURIComponent(bare.pathname.replace('/api/media/', ''))
  const refused = await fetch(`${place.origin}/api/media/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${nosy}` },
    body: JSON.stringify({ paths: [path] }),
  })
  assert.equal(refused.status, 200)
  assert.deepEqual(await refused.json(), { links: {} }, 'not a link for a trip they are not on')

  // The same ask from somebody on the trip is answered, so this is not a typo.
  const allowed = await fetch(`${place.origin}/api/media/links`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${place.accessToken}`,
    },
    body: JSON.stringify({ paths: [path] }),
  })
  assert.match((await allowed.json()).links[path] || '', /signature=/)
})

test('a film whose ladder will not build is still a film', { skip }, async t => {
  const place = await world(t)
  const form = new FormData()
  form.set(
    'photo',
    new Blob([await readFile(film(join(place.directory, 'in.mp4')))], { type: 'video/mp4' }),
    'IMG.mp4',
  )
  const created = await fetch(`${place.origin}/api/trips/${place.trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${place.accessToken}` },
    body: form,
  })
  const video = await created.json()
  await place.worker.runOne() // the conversion, which succeeds

  /* Now make the ladder impossible. The film itself is untouched and has
     already been converted; only the extra thing fails. */
  place.fileStore.storeHls = async () => {
    throw new Error('object storage is having a day')
  }
  const broken = createMediaWorker({
    repository: place.repository,
    fileStore: place.fileStore,
    logger: { warn() {} },
  })
  await broken.runOne()

  const trip = await fetch(`${place.origin}/api/trips/current?t=${place.trip.slug}`, {
    headers: { authorization: `Bearer ${place.accessToken}` },
  })
  const row = (await trip.json()).photos.find(photo => photo.id === video.id)
  /* Ready, not failed. The MP4 plays exactly as well as it did a moment ago,
     and telling somebody their video is broken because an extra copy of it
     could not be made would be a lie with a spinner on it. */
  assert.equal(row.status, 'ready')
  assert.equal(row.hlsSrc, null)
  assert.ok(row.src, 'and the film is still there to watch')
})

test('deleting a film takes its whole stream with it', { skip }, async t => {
  const place = await world(t)
  const row = await uploaded(place, film(join(place.directory, 'in.mp4')))
  const streamRoot = row.hlsSrc && new URL(row.hlsSrc).pathname.replace(/\/[^/]*$/, '')
  assert.ok(streamRoot)

  const removed = await fetch(`${place.origin}/api/trips/${place.trip.id}/photos/${row.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${place.accessToken}` },
  })
  assert.equal(removed.status, 204)

  /* Segments are the bulk of what a film costs to keep. A playlist deleted
     on its own would leave every one of them on the volume as bytes nobody
     can reach and nobody is charging us less for. */
  const queued = await place.repository.listPendingFileDeletions(new Date(), 50)
  assert.ok(
    queued.some(path => path.endsWith('.hls/')),
    `the stream was not queued for deletion: ${queued.join(', ')}`,
  )
})

test('the whole path works on object storage, not only on a volume', { skip }, async t => {
  /* Everything above the store was written against an injected interface, and
     the point of that is exactly this: a film uploaded, converted, laddered,
     served by the range and walked by a player, with nothing on a disk. It is
     worth a test rather than an assumption, because the failure mode is a
     deployment that works on the machine it was built on and shows grey
     squares on the one it was moved to. */
  const bucket = await stubStore(t)
  const place = await world(t, { store: bucket.store })
  const row = await uploaded(place, film(join(place.directory, 'in.mp4')))

  assert.ok(row.src, 'the film itself')
  assert.ok(row.posterSrc, 'the frame drawn from it')
  assert.ok(row.hlsSrc, 'and the ladder built from it')

  /* Everything really is in the bucket: the film as filmed (this one already
     played everywhere, so nothing re-encoded it), the frame drawn from it,
     the small copy the grids use, and every part of the ladder. */
  const keys = [...bucket.objects.keys()]
  const has = suffix => keys.some(key => key.endsWith(suffix))
  assert.ok(has('.mp4'), `no film in the bucket: ${keys.join(', ')}`)
  assert.ok(has('.poster.jpg') && has('.thumb.jpg'), 'the poster and its small copy')
  assert.ok(has('.hls/master.m3u8'), 'the master playlist')
  assert.ok(keys.filter(key => key.endsWith('.ts')).length >= 2, 'and its segments')

  // And a player can still walk it, which is the only thing that matters.
  const masterText = await (await replay(place.origin, row.hlsSrc)).text()
  const variant = masterText
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'))
  const variantText = await (await replay(place.origin, variant)).text()
  const segment = variantText
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'))
  const bytes = Buffer.from(await (await replay(place.origin, segment)).arrayBuffer())
  assert.equal(bytes[0], 0x47, 'a real MPEG-TS packet came back out of the bucket')

  /* A range off the object store, which is how a film is watched from
     wherever the thumb drops it: one request rather than a download. */
  const ranged = await replay(place.origin, row.src, { headers: { range: 'bytes=0-99' } })
  assert.equal(ranged.status, 206)
  assert.equal((await ranged.arrayBuffer()).byteLength, 100)
})
