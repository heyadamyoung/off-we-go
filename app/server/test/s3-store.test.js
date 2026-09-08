import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Readable } from 'node:stream'
import { createS3FileStore } from '../src/s3-store.js'

/* An object store made of a Map. It is deliberately strict about the things
   that are easy to get wrong and invisible when you do — an unsigned request,
   a range ignored — so the test fails here rather than against a real bucket
   at three in the morning. */
async function stubStore(t) {
  const objects = new Map()
  const seen = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const key = decodeURIComponent(request.url.split('?')[0].replace(/^\/[^/]+\//, ''))
    seen.push({ method: request.method, key, auth: request.headers.authorization })

    if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=')) {
      response.writeHead(403).end('unsigned')
      return
    }
    if (request.method === 'PUT') {
      objects.set(key, body)
      response.writeHead(200).end()
    } else if (request.method === 'DELETE') {
      objects.delete(key)
      response.writeHead(204).end()
    } else if (request.method === 'HEAD') {
      const held = objects.get(key)
      if (!held && key) return response.writeHead(404).end()
      response.writeHead(200, { 'content-length': String(held ? held.length : 0) }).end()
    } else {
      const held = objects.get(key)
      if (!held) return response.writeHead(404).end()
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '')
      if (!range) return response.writeHead(200).end(held)
      const start = range[1] === '' ? held.length - Number(range[2]) : Number(range[1])
      const end = range[1] === '' || range[2] === '' ? held.length - 1 : Number(range[2])
      response
        .writeHead(206, { 'content-range': `bytes ${start}-${end}/${held.length}` })
        .end(held.subarray(start, end + 1))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const store = createS3FileStore({
    bucket: 'trips',
    region: 'auto',
    endpoint: `http://127.0.0.1:${server.address().port}`,
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    forcePathStyle: true,
  })
  return { store, objects, seen }
}

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
