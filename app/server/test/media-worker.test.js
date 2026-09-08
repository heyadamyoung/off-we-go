import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/app.js'
import { createDiskFileStore } from '../src/files.js'
import { createMediaWorker } from '../src/media-worker.js'
import { probe } from '../src/transcode.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const skip =
  spawnSync('ffmpeg', ['-hide_banner', '-version']).status === 0
    ? false
    : 'ffmpeg is not installed on this machine'

/** A film in a shape no browser will play — the HEVC-in-.mov case, locally. */
function unplayableFilm(path, { seconds = 1 } = {}) {
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
      `testsrc=size=320x240:rate=15:duration=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${seconds}`,
      '-c:v',
      'mpeg4',
      '-c:a',
      'ac3',
      path,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  return path
}

async function trip(t) {
  const directory = await mkdtemp(join(tmpdir(), 'offwego-worker-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const fileStore = createDiskFileStore({ directory })
  const announced = []
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
    body: JSON.stringify({ title: 'Convert trip' }),
  })
  const worker = createMediaWorker({
    repository,
    fileStore,
    logger: { warn() {} },
    onFinished: job => announced.push(job),
  })
  return {
    origin,
    accessToken,
    directory,
    repository,
    fileStore,
    worker,
    announced,
    trip: await created.json(),
  }
}

const upload = async ({ origin, accessToken, trip: t }, file, name = 'IMG.mov') => {
  const form = new FormData()
  form.set('photo', new Blob([await readFile(file)], { type: 'video/quicktime' }), name)
  const response = await fetch(`${origin}/api/trips/${t.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  assert.equal(response.status, 201)
  return response.json()
}

test('an unplayable film is converted behind the upload, not during it', { skip }, async t => {
  const world = await trip(t)
  const source = unplayableFilm(join(world.directory, 'source.mov'))

  const started = Date.now()
  const video = await upload(world, source)
  /* The whole point of a queue: the phone is not held while ffmpeg works.
     A synchronous convert would put seconds — minutes, for a real film —
     between the tap and the reply. */
  assert.ok(Date.now() - started < 4000, 'the upload returned without converting')
  assert.equal(video.kind, 'video')
  assert.equal(video.status, 'pending', 'the app is told the film is not ready yet')
  assert.deepEqual(await world.repository.mediaQueueDepth(), { pending: 1, working: 0 })

  assert.equal(await world.worker.runOne(), true)

  const after = await world.repository.claimMediaJob({ workerId: 'x', until: new Date() })
  assert.equal(after, null, 'the job is gone once it is done')
  assert.deepEqual(await world.repository.mediaQueueDepth(), { pending: 0, working: 0 })

  const reloaded = await fetch(`${world.origin}/api/trips/current?t=${world.trip.slug}`, {
    headers: { authorization: `Bearer ${world.accessToken}` },
  })
  const row = (await reloaded.json()).photos.find(photo => photo.id === video.id)
  assert.equal(row.status, 'ready')
  assert.equal(row.mime, 'video/mp4')
  assert.match(row.storagePath, /\.mp4$/, 'the row points at the converted film')
  assert.ok(row.posterSrc, 'and it has the frame the phone never managed to draw')

  const converted = await probe(join(world.directory, row.storagePath))
  assert.equal(converted.videoCodec, 'h264')
  assert.equal(converted.audioCodec, 'aac')

  // Whoever is watching the trip is told, without having made a request.
  assert.equal(world.announced.length, 1)
  assert.equal(world.announced[0].converted, true)
})

test('a film already playable everywhere keeps its own bytes', { skip }, async t => {
  const world = await trip(t)
  const source = join(world.directory, 'fine.mp4')
  spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=15:duration=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ])

  const video = await upload(world, source, 'IMG.mp4')
  const original = await readFile(join(world.directory, video.storagePath))
  await world.worker.runOne()

  const reloaded = await fetch(`${world.origin}/api/trips/current?t=${world.trip.slug}`, {
    headers: { authorization: `Bearer ${world.accessToken}` },
  })
  const row = (await reloaded.json()).photos.find(photo => photo.id === video.id)
  assert.equal(row.status, 'ready')
  assert.equal(row.storagePath, video.storagePath, 'the path did not change')
  assert.deepEqual(
    await readFile(join(world.directory, row.storagePath)),
    original,
    're-encoding a film that already plays would spend minutes making it worse',
  )
  assert.ok(row.posterSrc, 'it still gains the poster it never had')
  assert.equal(world.announced[0].converted, false)
})

test('a film that will not convert stops being retried, and still plays for its owner', {
  skip,
}, async t => {
  const world = await trip(t)
  const video = await upload(world, unplayableFilm(join(world.directory, 'source.mov')))

  // Whatever the bytes were, they are not a film any more.
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(world.directory, video.storagePath), 'not a video at all')

  /* Three goes, because the usual repeated failure is a loaded box rather
     than a broken file — but not for ever. */
  assert.equal(await world.worker.runOne(), true)
  assert.deepEqual(
    await world.repository.mediaQueueDepth(),
    { pending: 1, working: 0 },
    'the first failure puts it back, to try again later',
  )
  for (let attempt = 1; attempt < 3; attempt++) {
    // Backoff would hold the next go for minutes; the test reaches past it.
    for (const job of world.repository.__mediaJobs()) job.runAfter = new Date(0)
    assert.equal(await world.worker.runOne(), true)
  }

  const depth = await world.repository.mediaQueueDepth()
  assert.deepEqual(depth, { pending: 0, working: 0 }, 'it gave up rather than looping for ever')

  const reloaded = await fetch(`${world.origin}/api/trips/current?t=${world.trip.slug}`, {
    headers: { authorization: `Bearer ${world.accessToken}` },
  })
  const row = (await reloaded.json()).photos.find(photo => photo.id === video.id)
  assert.equal(row.status, 'failed')
  assert.ok(row.src, 'the film is still there and still served')
})

test('two workers on one queue never take the same film twice', { skip }, async t => {
  const world = await trip(t)
  await upload(world, unplayableFilm(join(world.directory, 'a.mov')), 'a.mov')

  const second = createMediaWorker({
    repository: world.repository,
    fileStore: world.fileStore,
    logger: { warn() {} },
  })
  /* The claim is what makes running these on several boxes safe. If both
     could take one job, converting would happen twice and the second would
     overwrite the first's row with a path it had already retired. */
  const [first, other] = await Promise.all([world.worker.runOne(), second.runOne()])
  assert.equal([first, other].filter(Boolean).length, 1, 'exactly one worker did the work')
})
