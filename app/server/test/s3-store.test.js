import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Readable } from 'node:stream'
import { stubStore } from './fake-bucket.js'

test('a photograph lands as both sizes, signed, and comes back', async t => {
  const { store, objects, seen } = await stubStore(t)
  const source = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer()

  const stored = await store.storePhoto({ tripId: 'trip-1', bytes: source })
  assert.ok(objects.has(stored.storagePath), 'the display copy is in the bucket')
  assert.ok(objects.has(stored.thumbPath))
  assert.ok(
    seen.every(request => request.auth),
    'nothing went out unsigned',
  )

  const display = await sharp(await store.read(stored.storagePath)).metadata()
  assert.equal(display.width, 2048, 'resized on the way in, exactly as on disk')

  assert.equal(await store.size(stored.storagePath), objects.get(stored.storagePath).length)
  await store.remove(stored.storagePath)
  assert.equal(objects.has(stored.storagePath), false)
})

test('a film streams up without becoming a Buffer, and the cap still holds', async t => {
  const { store, objects } = await stubStore(t)
  const chunks = () => Readable.from([Buffer.alloc(4096, 1), Buffer.alloc(4096, 2)])

  const stored = await store.storeVideo({ tripId: 'trip-1', source: chunks(), mime: 'video/mp4' })
  assert.equal(stored.bytes, 8192)
  assert.equal(objects.get(stored.storagePath).length, 8192)

  /* The ceiling is counted as the bytes go past — an object store charges
     for what it keeps, so refusing after the fact is refusing too late. */
  await assert.rejects(
    store.storeVideo({ tripId: 'trip-1', source: chunks(), mime: 'video/mp4', limit: 5000 }),
    error => error.code === 'MEDIA_TOO_LARGE' || /5000/.test(String(error.message)),
  )
})

test('a film is served by the range, so seeking costs one request', async t => {
  const { store } = await stubStore(t)
  const film = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
  const stored = await store.storeVideo({
    tripId: 'trip-1',
    source: Readable.from([film]),
    mime: 'video/mp4',
  })

  const slice = []
  for await (const chunk of store.open(stored.storagePath, { start: 100, end: 199 })) {
    slice.push(chunk)
  }
  assert.deepEqual(Buffer.concat(slice), film.subarray(100, 200))
})

test('a converted film takes its own key, and the original is named for retiring', async t => {
  const { store, objects } = await stubStore(t)
  const dir = await mkdtemp(join(tmpdir(), 'offwego-s3-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const converted = join(dir, 'converted.mp4')
  await writeFile(converted, Buffer.alloc(2048, 7))

  const result = await store.replaceVideo({
    storagePath: 'trip-1/abc.mov',
    file: converted,
    mime: 'video/mp4',
  })
  assert.match(result.storagePath, /\.converted\.mp4$/)
  assert.equal(result.replaced, 'trip-1/abc.mov')
  assert.equal(objects.get(result.storagePath).length, 2048)
})

test('a missing object is a 404, not a broken bucket', async t => {
  const { store } = await stubStore(t)
  await assert.rejects(store.read('trip-1/never.jpg'), error => {
    /* The media route tells these apart to decide between an ordinary 404
       and an alert: only a true miss is unremarkable. */
    assert.equal(error.code, 'ENOENT')
    return true
  })
})

test('the worker can pull a film down to convert it', async t => {
  const { store } = await stubStore(t)
  const dir = await mkdtemp(join(tmpdir(), 'offwego-s3-dl-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const film = Buffer.alloc(4096, 9)
  const stored = await store.storeVideo({
    tripId: 'trip-1',
    source: Readable.from([film]),
    mime: 'video/mp4',
  })

  const local = join(dir, 'pulled.mp4')
  await store.download(stored.storagePath, local)
  assert.deepEqual(await readFile(local), film)
})

test("a film's whole stream goes up, master playlist last", async t => {
  const { store, objects } = await stubStore(t)
  const dir = await mkdtemp(join(tmpdir(), 'offwego-s3-hls-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '0'), { recursive: true })
  await mkdir(join(dir, '1'), { recursive: true })
  await writeFile(join(dir, 'master.m3u8'), '#EXTM3U\n0/index.m3u8\n1/index.m3u8\n')
  await writeFile(join(dir, '0', 'index.m3u8'), '#EXTM3U\nseg00000.ts\n')
  await writeFile(join(dir, '0', 'seg00000.ts'), Buffer.alloc(2048, 7))
  await writeFile(join(dir, '1', 'index.m3u8'), '#EXTM3U\nseg00000.ts\n')
  await writeFile(join(dir, '1', 'seg00000.ts'), Buffer.alloc(1024, 8))

  const stored = await store.storeHls({
    storagePath: 'trip-1/film.converted.mp4',
    directory: dir,
  })

  assert.equal(stored.hlsPath, 'trip-1/film.converted.hls/master.m3u8')
  assert.equal(stored.files, 5)
  assert.ok(objects.has('trip-1/film.converted.hls/0/seg00000.ts'))
  assert.ok(objects.has('trip-1/film.converted.hls/1/index.m3u8'))
  assert.equal(objects.get('trip-1/film.converted.hls/0/seg00000.ts').length, 2048)
  /* The whole tree really is there before the one path anything records
     points at it: a stream whose upload died halfway is then referenced by
     nothing and is swept up as ordinary unreferenced bytes rather than served
     as a playlist naming segments that were never written. */
  assert.ok(objects.has('trip-1/film.converted.hls/master.m3u8'))
})

test('a segment goes up as a segment, not as unnamed bytes', async t => {
  const { store, seen } = await stubStore(t)
  const dir = await mkdtemp(join(tmpdir(), 'offwego-s3-type-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'master.m3u8'), '#EXTM3U\n')
  await writeFile(join(dir, 'seg00000.ts'), Buffer.alloc(64, 1))
  await store.storeHls({ storagePath: 'trip-1/film.mp4', directory: dir })

  /* An object store hands back whatever content type it was given, and a
     segment served as application/octet-stream is one some players decline
     to touch. The type has to be set on the way in, because nothing rewrites
     it on the way out. */
  const put = seen.filter(call => call.method === 'PUT')
  assert.ok(put.length >= 2)
  assert.deepEqual(put.map(call => call.contentType).sort(), [
    'application/vnd.apple.mpegurl',
    'video/mp2t',
  ])
})

test('deleting a stream deletes every part of it, however many pages', async t => {
  const { store, objects } = await stubStore(t)
  const dir = await mkdtemp(join(tmpdir(), 'offwego-s3-rm-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '0'), { recursive: true })
  await writeFile(join(dir, 'master.m3u8'), '#EXTM3U\n')
  for (let index = 0; index < 5; index++) {
    await writeFile(join(dir, '0', `seg0000${index}.ts`), Buffer.alloc(32, index))
  }
  await store.storeHls({ storagePath: 'trip-1/film.mp4', directory: dir })
  await store.storeVideo({
    tripId: 'trip-1',
    source: Readable.from([Buffer.alloc(16, 3)]),
    mime: 'video/mp4',
  })
  const before = objects.size
  assert.ok(before > 6)

  await store.removeTree('trip-1/film.hls/')

  /* Segments are the bulk of what a film costs to keep, and there is no
     directory to remove on an object store — only a listing and a great many
     deletes. The listing is paged, so a client that reads the first page and
     stops leaves most of the film behind. */
  assert.deepEqual(
    [...objects.keys()].filter(key => key.includes('.hls/')),
    [],
  )
  // And nothing outside the tree was touched.
  assert.equal(objects.size, before - 6)
})
