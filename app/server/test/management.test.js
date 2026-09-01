import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

async function setup(fileStore = null) {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository, fileStore, mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://offwego.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const authorization = await authenticate(repository, 'owner@example.com')
  const user = await repository.findUserByEmail('owner@example.com')
  const trip = (await app.inject({ method: 'POST', url: '/api/trips', headers: { authorization }, payload: { title: 'Before' } })).json()
  return { app, repository, authorization, trip, user }
}

test('an owner can update trip details and their global profile', async () => {
  const { app, repository, authorization, trip, user } = await setup()
  const changed = await app.inject({
    method: 'PATCH', url: `/api/trips/${trip.id}`, headers: { authorization },
    payload: { title: 'After', crew: 'Us', dayCount: 8 },
  })
  assert.equal(changed.statusCode, 200)
  assert.equal(changed.json().title, 'After')

  const profile = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { name: 'Alex', handle: 'alex-travels', avatarPath: 'another-profile/private.jpg' },
  })
  assert.equal(profile.statusCode, 200)
  assert.equal(profile.json().id, user.id)
  assert.equal(profile.json().name, 'Alex')
  assert.equal(profile.json().handle, 'alex-travels')
  assert.equal(profile.json().avatar, null)

  const otherTrip = (await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization }, payload: { title: 'Elsewhere' },
  })).json()
  const loaded = await app.inject({
    method: 'GET', url: `/api/trips/current?t=${otherTrip.slug}`, headers: { authorization },
  })
  assert.equal(loaded.json().me.name, 'Alex')
  assert.equal(loaded.json().me.handle, profile.json().handle)

  const otherAuthorization = await authenticate(repository, 'other@example.com')
  const conflict = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization: otherAuthorization },
    payload: { handle: 'Alex-Travels' },
  })
  assert.equal(conflict.statusCode, 409)
  assert.deepEqual(conflict.json(), {
    code: 'profile.handle_taken', error: 'That handle is already taken.',
  })
  await app.close()
})

test('profile handles resolve only for authenticated people who share a trip', async () => {
  const { app, repository, authorization, trip } = await setup()
  const changed = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { name: 'Alex Young', handle: 'alex-young' },
  })
  assert.equal(changed.statusCode, 200)

  const anonymous = await app.inject({ method: 'GET', url: '/api/users/alex-young' })
  assert.equal(anonymous.statusCode, 401)

  const outsiderAuthorization = await authenticate(repository, 'outsider@example.com')
  const privateProfile = await app.inject({
    method: 'GET', url: '/api/users/alex-young', headers: { authorization: outsiderAuthorization },
  })
  assert.equal(privateProfile.statusCode, 404)

  const invitation = (await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/invites`, headers: { authorization },
    payload: { email: 'friend@example.com', role: 'viewer' },
  })).json()
  const friendAuthorization = await authenticate(repository, 'friend@example.com')
  assert.equal((await app.inject({
    method: 'POST', url: `/api/invites/${invitation.id}/accept`, headers: { authorization: friendAuthorization },
  })).statusCode, 200)

  const visibleProfile = await app.inject({
    method: 'GET', url: '/api/users/alex-young', headers: { authorization: friendAuthorization },
  })
  assert.equal(visibleProfile.statusCode, 200)
  assert.deepEqual(visibleProfile.json(), {
    id: changed.json().id, handle: 'alex-young', name: 'Alex Young', avatar: null,
  })
  await app.close()
})

test('a trip cannot accumulate an unbounded number of registered phones', async () => {
  const { app, authorization, trip } = await setup()
  const statuses = []
  for (let index = 0; index < 21; index++) statuses.push((await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/devices`, headers: { authorization },
    payload: { name: `Phone ${index + 1}` },
  })).statusCode)
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(201))
  assert.equal(statuses[20], 409)
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

test('an owner can upload a private avatar and attach it to their global profile', async () => {
  const stored = []
  const removed = []
  const { app, authorization, trip } = await setup({
    async storeAvatar(input) {
      stored.push(input)
      const suffix = stored.length === 1 ? `${input.profileId}-legacy.jpg` : `${input.profileId}.jpg`
      return { avatarPath: `profiles/${suffix}` }
    },
    async remove(path) { removed.push(path) },
  })
  const form = new FormData()
  form.append('avatar', new Blob([Buffer.from('image-bytes')], { type: 'image/jpeg' }), 'me.jpg')
  const response = await app.inject({
    method: 'POST', url: '/api/profile/avatar', headers: { authorization },
    payload: form,
  })
  assert.equal(response.statusCode, 201)
  const firstPath = response.json().avatarPath
  assert.equal(stored.length, 1)

  const replacement = new FormData()
  replacement.append('avatar', new Blob([Buffer.from('replacement-image')], { type: 'image/jpeg' }), 'me-again.jpg')
  const replaced = await app.inject({
    method: 'POST', url: '/api/profile/avatar', headers: { authorization },
    payload: replacement,
  })
  assert.equal(replaced.statusCode, 201)
  assert.deepEqual(removed, [firstPath])
  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.match(loaded.json().me.avatar, /^https:\/\/offwego\.example\.com\/api\/media\//)
  await app.close()
})
