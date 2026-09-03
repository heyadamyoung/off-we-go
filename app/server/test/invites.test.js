import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

test('an invited account must explicitly accept before it can read the trip', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const tripResponse = await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization: owner },
    payload: { title: 'Shared trip' },
  })
  const trip = tripResponse.json()

  const invited = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/invites`,
    headers: { authorization: owner },
    payload: { email: 'friend@example.com', name: 'Alex', role: 'viewer' },
  })
  assert.equal(invited.statusCode, 201)
  assert.equal(invited.json().mailed, true)
  assert.equal(sent.at(-1).to, 'friend@example.com')
  assert.equal(sent.at(-1).kind, 'trip-invitation')
  assert.equal(sent.at(-1).appUrl, 'https://offwego.example.com/')
  assert.equal(sent.at(-1).webUrl, undefined, 'trip invitations must not contain a sign-in token')

  const viewer = await authenticate(repository, 'friend@example.com')
  const beforeAcceptance = await app.inject({
    method: 'GET',
    url: '/api/trips/current',
    headers: { authorization: viewer },
  })
  assert.equal(beforeAcceptance.statusCode, 404)

  const pending = await app.inject({
    method: 'GET',
    url: '/api/invites/pending',
    headers: { authorization: viewer },
  })
  assert.equal(pending.statusCode, 200)
  assert.deepEqual(pending.json(), [
    {
      id: invited.json().id,
      email: 'friend@example.com',
      name: 'Alex',
      role: 'viewer',
      tripId: trip.id,
      tripSlug: trip.slug,
      tripTitle: 'Shared trip',
    },
  ])

  const stranger = await authenticate(repository, 'stranger@example.com')
  const stolen = await app.inject({
    method: 'POST',
    url: `/api/invites/${invited.json().id}/accept`,
    headers: { authorization: stranger },
  })
  assert.equal(stolen.statusCode, 404)

  const accepted = await app.inject({
    method: 'POST',
    url: `/api/invites/${invited.json().id}/accept`,
    headers: { authorization: viewer },
  })
  assert.equal(accepted.statusCode, 200)
  assert.equal(accepted.json().tripId, trip.id)

  const loaded = await app.inject({
    method: 'GET',
    url: '/api/trips/current',
    headers: { authorization: viewer },
  })
  assert.equal(loaded.statusCode, 200)
  assert.equal(loaded.json().canEdit, false)
  assert.equal(
    loaded.json().me.name,
    'friend',
    'an inviter cannot overwrite the invited user’s global profile',
  )

  const forbidden = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/stops`,
    headers: { authorization: viewer },
    payload: { name: 'Nope', lng: -3, lat: 55 },
  })
  assert.equal(forbidden.statusCode, 403)
  await app.close()
})

test('only owners manage invitations and revoking a claimed invitation removes trip access', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Private trip' },
    })
  ).json()
  const invitation = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/invites`,
      headers: { authorization: owner },
      payload: { email: 'editor@example.com', name: 'Ed', role: 'editor' },
    })
  ).json()
  const editor = await authenticate(repository, 'editor@example.com')
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/invites/${invitation.id}/accept`,
        headers: { authorization: editor },
      })
    ).statusCode,
    200,
  )

  const editorInvite = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/invites`,
    headers: { authorization: editor },
    payload: { email: 'stranger@example.com', role: 'viewer' },
  })
  assert.equal(editorInvite.statusCode, 403)

  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/invites/${invitation.id}`,
    headers: { authorization: owner },
  })
  assert.equal(revoked.statusCode, 204)
  const noLongerMember = await app.inject({
    method: 'GET',
    url: '/api/trips/current',
    headers: { authorization: editor },
  })
  assert.equal(noLongerMember.statusCode, 404)
  await app.close()
})

test('an owner can remove a claimed member but cannot remove the trip owner', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Private trip' },
    })
  ).json()
  const invitation = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/invites`,
      headers: { authorization: owner },
      payload: { email: 'friend@example.com', name: 'Friend', role: 'viewer' },
    })
  ).json()
  const friend = await authenticate(repository, 'friend@example.com')
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/invites/${invitation.id}/accept`,
        headers: { authorization: friend },
      })
    ).statusCode,
    200,
  )
  const friendProfile = (
    await app.inject({
      method: 'GET',
      url: '/api/trips/current',
      headers: { authorization: friend },
    })
  ).json().me
  const ownerProfile = (
    await app.inject({
      method: 'GET',
      url: '/api/trips/current',
      headers: { authorization: owner },
    })
  ).json().me

  const selfRemoval = await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/members/${ownerProfile.id}`,
    headers: { authorization: owner },
  })
  assert.equal(selfRemoval.statusCode, 409)
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/members/${friendProfile.id}`,
    headers: { authorization: owner },
  })
  assert.equal(removed.statusCode, 204)
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/trips/current',
        headers: { authorization: friend },
      })
    ).statusCode,
    404,
  )
  await app.close()
})
