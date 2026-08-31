import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

async function ownerHarness() {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const authorization = await authenticate(repository, 'owner@example.com')
  const created = await app.inject({ method: 'POST', url: '/api/trips', headers: { authorization }, payload: { title: 'Editable' } })
  return { app, authorization, trip: created.json() }
}

test('an owner can create, change and delete a stop', async () => {
  const { app, authorization, trip } = await ownerHarness()
  const created = await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/stops`, headers: { authorization },
    payload: {
      name: 'Edinburgh Castle', kind: 'Castle', icon: 'castle', day: 'Day 1',
      time: '10:00', lng: -3.2008, lat: 55.9486, status: 'next', note: 'Book ahead', seq: 0,
    },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().name, 'Edinburgh Castle')

  const changed = await app.inject({
    method: 'PATCH', url: `/api/trips/${trip.id}/stops/${created.json().id}`,
    headers: { authorization }, payload: { note: 'Tickets booked', status: 'done' },
  })
  assert.equal(changed.statusCode, 200)
  assert.equal(changed.json().note, 'Tickets booked')

  const removed = await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/stops/${created.json().id}`,
    headers: { authorization },
  })
  assert.equal(removed.statusCode, 204)

  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.deepEqual(loaded.json().stops, [])
  await app.close()
})

test('replacing a route is atomic and keeps point order', async () => {
  const { app, authorization, trip } = await ownerHarness()
  const route = [[-3.2, 55.94], [-3.1, 55.95], [-3.0, 55.96]]
  const response = await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/route`, headers: { authorization }, payload: { points: route },
  })
  assert.equal(response.statusCode, 204)
  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.deepEqual(loaded.json().route, route)
  await app.close()
})
