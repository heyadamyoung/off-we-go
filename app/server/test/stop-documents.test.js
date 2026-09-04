import assert from 'node:assert/strict'
import test from 'node:test'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

/* Paperwork on itinerary stops, the same rules as travel legs: the museum
   ticket lives on the museum, arrives via multipart or the assistant's
   mailbox jump, and rides the trip payload with a served src. */

const SECRET = 'test-secret-that-is-long-enough'

async function server() {
  const stored = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: SECRET,
    fileStore: {
      async ready() {},
      async storeDocument({ tripId, bytes, extension }) {
        const storagePath = `docs/${tripId}/${stored.length}.${extension}`
        stored.push(storagePath)
        return { storagePath, bytes: bytes.length }
      },
      async remove() {},
    },
  })
  return { repository, app }
}

test('a stop takes a document, shows it on the trip, and gives it up on delete', async () => {
  const { repository, app } = await server()
  const owner = await authenticate(repository, 'owner@example.com')
  const ownerUser = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(ownerUser, { title: 'Amsterdam' })
  const created = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/stops`,
    headers: { authorization: owner },
    payload: { name: 'Rijksmuseum', day: 'Day 1', lng: 4.88, lat: 52.36 },
  })
  const stop = created.json()

  const boundary = 'form-boundary'
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="name"',
    '',
    'Entry tickets',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="tickets.pdf"',
    'Content-Type: application/pdf',
    '',
    '%PDF-1.4 pretend',
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const uploaded = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/stops/${stop.id}/documents`,
    headers: {
      authorization: owner,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  })
  assert.equal(uploaded.statusCode, 200)
  const doc = uploaded.json()
  assert.equal(doc.name, 'Entry tickets')
  assert.match(doc.src, /docs\//)
  assert.equal('storagePath' in doc, false, 'storage internals never reach the client')

  const loaded = await app.inject({
    method: 'GET',
    url: '/api/trips/current',
    headers: { authorization: owner },
  })
  const shown = loaded.json().stops.find(value => value.id === stop.id)
  assert.equal(shown.documents.length, 1)
  assert.equal(shown.documents[0].name, 'Entry tickets')
  assert.match(shown.documents[0].src, /docs\//)

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/stops/documents/${doc.id}`,
    headers: { authorization: owner },
  })
  assert.equal(removed.statusCode, 204)
  const after = await app.inject({
    method: 'GET',
    url: '/api/trips/current',
    headers: { authorization: owner },
  })
  assert.equal(after.json().stops.find(value => value.id === stop.id).documents.length, 0)
})
