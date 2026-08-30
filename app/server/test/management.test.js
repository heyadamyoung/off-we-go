import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

async function setup(fileStore = null) {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository, fileStore, mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' } })
  const token = new URL(sent[0].webUrl).searchParams.get('token')
  const login = await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token } })
  const authorization = `Bearer ${login.json().accessToken}`
  const trip = (await app.inject({ method: 'POST', url: '/api/trips', headers: { authorization }, payload: { title: 'Before' } })).json()
  return { app, repository, authorization, trip, user: login.json().user }
}

test('an owner can update trip details and their trip profile', async () => {
  const { app, authorization, trip, user } = await setup()
  const changed = await app.inject({
    method: 'PATCH', url: `/api/trips/${trip.id}`, headers: { authorization },
    payload: { title: 'After', crew: 'Us', dayCount: 8 },
  })
  assert.equal(changed.statusCode, 200)
  assert.equal(changed.json().title, 'After')

  const profile = await app.inject({
    method: 'PATCH', url: `/api/trips/${trip.id}/members/me`, headers: { authorization },
    payload: { name: 'Alex' },
  })
  assert.equal(profile.statusCode, 200)
  assert.equal(profile.json().id, user.id)
  assert.equal(profile.json().name, 'Adam')
  await app.close()
})

test('an owner can list and revoke a phone', async () => {
  const { app, authorization, trip } = await setup()
  const device = (await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/devices`, headers: { authorization }, payload: { name: 'Phone' },
  })).json()
  const listed = await app.inject({ method: 'GET', url: `/api/trips/${trip.id}/devices`, headers: { authorization } })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json()[0].id, device.id)
  assert.equal((await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/devices/${device.id}`, headers: { authorization },
  })).statusCode, 204)
  assert.deepEqual((await app.inject({
    method: 'GET', url: `/api/trips/${trip.id}/devices`, headers: { authorization },
  })).json(), [])
  await app.close()
})

test('an owner can edit and delete a photo record', async () => {
  const { app, repository, authorization, trip } = await setup()
  const photo = repository.seedPhoto(trip.id)
  const changed = await app.inject({
    method: 'PATCH', url: `/api/trips/${trip.id}/photos/${photo.id}`, headers: { authorization },
    payload: { caption: 'Changed', stopId: null },
  })
  assert.equal(changed.statusCode, 200)
  assert.equal(changed.json().caption, 'Changed')
  assert.equal((await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/photos/${photo.id}`, headers: { authorization },
  })).statusCode, 204)
  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.deepEqual(loaded.json().photos, [])
  await app.close()
})

test('an owner can upload a private avatar and attach it to their trip profile', async () => {
  const stored = []
  const { app, authorization, trip } = await setup({
    async storeAvatar(input) { stored.push(input); return { avatarPath: `${input.tripId}/avatars/user.jpg` } },
  })
  const form = new FormData()
  form.append('avatar', new Blob([Buffer.from('image-bytes')], { type: 'image/jpeg' }), 'me.jpg')
  const response = await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/members/me/avatar`, headers: { authorization },
    payload: form,
  })
  assert.equal(response.statusCode, 201)
  assert.equal(response.json().avatarPath, `${trip.id}/avatars/user.jpg`)
  assert.equal(stored.length, 1)
  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.match(loaded.json().me.avatar, /^\/api\/media\//)
  await app.close()
})
