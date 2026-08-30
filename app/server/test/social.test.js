import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

test('a trip member can comment on and like a photo, then undo both', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' } })
  const magic = new URL(sent[0].webUrl).searchParams.get('token')
  const login = await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token: magic } })
  const authorization = `Bearer ${login.json().accessToken}`
  const created = await app.inject({ method: 'POST', url: '/api/trips', headers: { authorization }, payload: { title: 'Social' } })
  const trip = created.json()
  const photo = repository.seedPhoto(trip.id)

  const comment = await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/photos/${photo.id}/comments`,
    headers: { authorization }, payload: { body: 'Worth the climb' },
  })
  assert.equal(comment.statusCode, 201)
  assert.equal(comment.json().text, 'Worth the climb')

  const liked = await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/photos/${photo.id}/like`, headers: { authorization },
  })
  assert.equal(liked.statusCode, 204)
  let loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.equal(loaded.json().comments[photo.id][0].text, 'Worth the climb')
  assert.deepEqual(loaded.json().likes, [photo.id])

  assert.equal((await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/comments/${comment.json().id}`, headers: { authorization },
  })).statusCode, 204)
  assert.equal((await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/photos/${photo.id}/like`, headers: { authorization },
  })).statusCode, 204)
  loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.deepEqual(loaded.json().comments, {})
  assert.deepEqual(loaded.json().likes, [])
  await app.close()
})
