import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentName, contentDisposition } from '../src/media-types.js'

/* The name of a downloaded file is the one thing on this route a stranger
   chooses, and it is written into a response header. So it is sanitised on the
   way out rather than trusted on the way in, and these are the shapes that
   would matter if it were not. */

test('an ordinary name comes through intact', () => {
  assert.equal(
    attachmentName('sunset-over-the-canal-2026-09-12-12ab34.jpg'),
    'sunset-over-the-canal-2026-09-12-12ab34.jpg',
  )
})

test('a newline cannot split the header in two', () => {
  /* The whole reason this function exists: a name carrying CRLF would end
     Content-Disposition and begin a header of the caller's choosing. */
  const name = attachmentName('a.jpg\r\nSet-Cookie: admin=1')
  assert.ok(!/[\r\n]/.test(name), name)
  assert.ok(!/[\r\n]/.test(contentDisposition(name)))
})

test('a quote cannot escape the quoted string it sits in', () => {
  const name = attachmentName('a".jpg')
  assert.ok(!name.includes('"'), name)
  assert.equal(contentDisposition(name).split('"').length, 3)
})

test('a path is reduced to the file at the end of it', () => {
  /* Not because this value reaches a filesystem — it does not — but because
     a name shaped like a traversal is a name that will one day be pasted
     somewhere that does. */
  assert.equal(attachmentName('../../etc/passwd'), 'passwd')
  assert.equal(attachmentName('C:\\Windows\\system32\\a.jpg'), 'a.jpg')
})

test('a leading dot cannot make a hidden file', () => {
  assert.equal(attachmentName('.bashrc'), 'bashrc')
  assert.equal(attachmentName('..'), 'off-we-go')
})

test('anything exotic becomes a dash rather than disappearing', () => {
  assert.equal(attachmentName('café brûlée.jpg'), 'caf-br-l-e.jpg')
})

test('a name nobody sensible chose still produces a filename', () => {
  assert.equal(attachmentName(''), 'off-we-go')
  assert.equal(attachmentName(null), 'off-we-go')
  assert.equal(attachmentName('///'), 'off-we-go')
})

test('an absurdly long name is cut to something a filesystem accepts', () => {
  const name = attachmentName('a'.repeat(500) + '.jpg')
  assert.ok(name.length <= 100, String(name.length))
})

test('the header is the shape a browser expects', () => {
  assert.equal(contentDisposition('a.jpg'), 'attachment; filename="a.jpg"')
})

/* And the route itself, because a sanitiser nothing calls is decoration. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildServer } from '../src/app.js'
import { createDiskFileStore } from '../src/files.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

async function aTripWithAPhotograph(t) {
  const directory = await mkdtemp(join(tmpdir(), 'offwego-download-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: createDiskFileStore({ directory }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`

  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await fetch(`${origin}/api/trips`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ title: 'Photo trip' }),
  }).then(response => response.json())

  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#c87842' },
  })
    .jpeg()
    .toBuffer()
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: 'image/jpeg' }), 'IMG_0001.jpg')
  form.set('caption', 'On the ridge')
  form.set('uploadKey', '01J8DOWNLOADKEY0000000000001')
  const photo = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  }).then(response => response.json())

  return { origin, photo }
}

test('asking to download hands the bytes back as a file, under the name given', async t => {
  const { origin, photo } = await aTripWithAPhotograph(t)
  const link = new URL(photo.src)
  link.searchParams.set('download', 'on-the-ridge-2027-06-04-12ab34.jpg')

  const served = await fetch(origin + link.pathname + link.search)

  assert.equal(served.status, 200)
  assert.equal(
    served.headers.get('content-disposition'),
    'attachment; filename="on-the-ridge-2027-06-04-12ab34.jpg"',
  )
  /* Still the picture, not a different representation of it. */
  assert.equal(served.headers.get('content-type'), 'image/jpeg')
  assert.ok((await served.arrayBuffer()).byteLength > 0)
})

test('the extra parameter does not disturb the signature it travels beside', async t => {
  /* The signature covers the path and the expiry, so a query the client adds
     must not invalidate it — otherwise every download is a 403. */
  const { origin, photo } = await aTripWithAPhotograph(t)
  const link = new URL(photo.src)
  link.searchParams.set('download', 'anything.jpg')

  assert.equal((await fetch(origin + link.pathname + link.search)).status, 200)
})

test('a photograph nobody asked to download is still a photograph to look at', async t => {
  /* The regression that would matter most: an attachment header leaking onto
     ordinary viewing turns every picture in the grid into a file prompt. */
  const { origin, photo } = await aTripWithAPhotograph(t)
  const link = new URL(photo.src)

  const served = await fetch(origin + link.pathname + link.search)

  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-disposition'), null)
})

test('a hostile filename reaches the header scrubbed', async t => {
  const { origin, photo } = await aTripWithAPhotograph(t)
  const link = new URL(photo.src)
  link.searchParams.set('download', 'a.jpg"\r\nSet-Cookie: admin=1')

  const served = await fetch(origin + link.pathname + link.search)

  assert.equal(served.status, 200)
  assert.equal(served.headers.get('set-cookie'), null)
  assert.equal(
    served.headers.get('content-disposition'),
    'attachment; filename="a.jpg-Set-Cookie-admin-1"',
  )
  const disposition = served.headers.get('content-disposition')
  assert.ok(!/[\r\n]/.test(disposition), disposition)
  /* Exactly one quoted run: a quote that survived would make three. */
  assert.equal(disposition.split('"').length, 3)
})
