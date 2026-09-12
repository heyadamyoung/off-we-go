import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'
import { createDiskFileStore } from '../src/files.js'

/* One photograph, out of the trip and on the open web because somebody on the
   trip said so — and back off it when they say otherwise. */

async function stand(t) {
  const directory = await mkdtemp(join(tmpdir(), 'offwego-share-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = createMemoryRepository({
    allowedEmails: ['owner@example.com', 'stranger@example.com'],
  })
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

  const token = (await authenticate(repository, 'owner@example.com')).slice(7)
  const auth = { authorization: `Bearer ${token}` }
  const trip = await (
    await fetch(`${origin}/api/trips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ title: 'Share trip' }),
    })
  ).json()

  const bytes = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#c8464a' },
  })
    .jpeg()
    .toBuffer()
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: 'image/jpeg' }), 'IMG_1.jpg')
  form.set('caption', 'Sunset over the canal')
  form.set('uploadKey', '01J8SHAREUPLOADKEY0000000000001')
  const photo = await (
    await fetch(`${origin}/api/trips/${trip.id}/photos`, {
      method: 'POST',
      headers: auth,
      body: form,
    })
  ).json()

  return { origin, auth, trip, photo, repository, token }
}

const share = (origin, auth, trip, photo, method = 'POST') =>
  fetch(`${origin}/api/trips/${trip.id}/photos/${photo.id}/share`, { method, headers: auth })

test('a shared photograph is readable by somebody with no account at all', async t => {
  const { origin, auth, trip, photo } = await stand(t)

  const made = await share(origin, auth, trip, photo)
  assert.equal(made.status, 200)
  const { url } = await made.json()
  assert.match(url, /^https:\/\/offwego\.example\.com\/s\/[A-Za-z0-9_-]{20,}$/)

  /* No header, no cookie, no signature — which is the whole point, and why
     the token has to be unguessable rather than merely unique. */
  const path = new URL(url).pathname
  const page = await fetch(`${origin}${path}`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /<meta property="og:image"/)
  assert.match(html, /Sunset over the canal/)

  const media = await fetch(`${origin}${path}/media`)
  assert.equal(media.status, 200)
  assert.equal(media.headers.get('content-type'), 'image/jpeg')
  assert.ok(Number(media.headers.get('content-length')) > 1000)
})

test('sharing the same photograph twice is the same link, not a second one', async t => {
  const { origin, auth, trip, photo } = await stand(t)
  const first = await (await share(origin, auth, trip, photo)).json()
  const again = await (await share(origin, auth, trip, photo)).json()
  /* Two live tokens for one picture would make revoking feel like it worked
     while the other one carried on serving. */
  assert.equal(again.url, first.url)
})

test('revoking takes the link off the internet, page and picture both', async t => {
  const { origin, auth, trip, photo } = await stand(t)
  const { url } = await (await share(origin, auth, trip, photo)).json()
  const path = new URL(url).pathname
  assert.equal((await fetch(`${origin}${path}`)).status, 200)

  const revoked = await share(origin, auth, trip, photo, 'DELETE')
  assert.equal(revoked.status, 200)
  assert.deepEqual(await revoked.json(), { revoked: 1 })

  assert.equal((await fetch(`${origin}${path}`)).status, 404)
  assert.equal((await fetch(`${origin}${path}/media`)).status, 404)
})

test('sharing again after revoking does not bring the old link back', async t => {
  const { origin, auth, trip, photo } = await stand(t)
  const { url: first } = await (await share(origin, auth, trip, photo)).json()
  await share(origin, auth, trip, photo, 'DELETE')
  const { url: second } = await (await share(origin, auth, trip, photo)).json()

  assert.notEqual(second, first, 'a revoked token was handed out again')
  // The one already sent to somebody stays dead.
  assert.equal((await fetch(`${origin}${new URL(first).pathname}`)).status, 404)
  assert.equal((await fetch(`${origin}${new URL(second).pathname}`)).status, 200)
})

test('a token nobody issued is not a link', async t => {
  const { origin } = await stand(t)
  assert.equal((await fetch(`${origin}/s/not-a-real-token`)).status, 404)
  assert.equal((await fetch(`${origin}/s/not-a-real-token/media`)).status, 404)
})

test('somebody not on the trip cannot put its photographs on the internet', async t => {
  const { origin, trip, photo, repository } = await stand(t)
  const stranger = (await authenticate(repository, 'stranger@example.com')).slice(7)
  const refused = await share(origin, { authorization: `Bearer ${stranger}` }, trip, photo)
  assert.equal(refused.status, 404)
})

test('and neither can somebody with no session', async t => {
  const { origin, trip, photo } = await stand(t)
  const refused = await fetch(`${origin}/api/trips/${trip.id}/photos/${photo.id}/share`, {
    method: 'POST',
  })
  assert.ok(refused.status === 401 || refused.status === 403, `got ${refused.status}`)
})

test('the viewer can ask whether a photograph is already out there', async t => {
  const { origin, auth, trip, photo } = await stand(t)
  const before = await (await share(origin, auth, trip, photo, 'GET')).json()
  assert.equal(before.url, null)

  const { url } = await (await share(origin, auth, trip, photo)).json()
  const after = await (await share(origin, auth, trip, photo, 'GET')).json()
  assert.equal(after.url, url)
})
