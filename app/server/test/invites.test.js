import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

async function exchange(app, sent, email) {
  const before = sent.length
  await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email } })
  const token = new URL(sent[before].webUrl).searchParams.get('token')
  const response = await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token } })
  return `Bearer ${response.json().accessToken}`
}

test('an owner invitation lets a viewer sign in and read but not edit the trip', async () => {
  const sent = []
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await exchange(app, sent, 'owner@example.com')
  const tripResponse = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization: owner }, payload: { title: 'Shared trip' },
  })
  const trip = tripResponse.json()

  const invited = await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/invites`, headers: { authorization: owner },
    payload: { email: 'friend@example.com', name: 'Alex', role: 'viewer' },
  })
  assert.equal(invited.statusCode, 201)
  assert.equal(invited.json().mailed, true)
  assert.equal(sent.at(-1).to, 'friend@example.com')

  const viewer = await exchange(app, sent, 'friend@example.com')
  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization: viewer } })
  assert.equal(loaded.statusCode, 200)
  assert.equal(loaded.json().canEdit, false)
  assert.equal(loaded.json().me.name, 'Alex')

  const forbidden = await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/stops`, headers: { authorization: viewer },
    payload: { name: 'Nope', lng: -3, lat: 55 },
  })
  assert.equal(forbidden.statusCode, 403)
  await app.close()
})

test('only owners manage invitations and revoking a claimed invitation removes trip access', async () => {
  const sent = []
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await exchange(app, sent, 'owner@example.com')
  const trip = (await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization: owner }, payload: { title: 'Private trip' },
  })).json()
  const invitation = (await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/invites`, headers: { authorization: owner },
    payload: { email: 'editor@example.com', name: 'Ed', role: 'editor' },
  })).json()
  const editor = await exchange(app, sent, 'editor@example.com')

  const editorInvite = await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/invites`, headers: { authorization: editor },
    payload: { email: 'stranger@example.com', role: 'viewer' },
  })
  assert.equal(editorInvite.statusCode, 403)

  const revoked = await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/invites/${invitation.id}`, headers: { authorization: owner },
  })
  assert.equal(revoked.statusCode, 204)
  const noLongerMember = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization: editor } })
  assert.equal(noLongerMember.statusCode, 404)
  await app.close()
})

test('an owner can remove a claimed member but cannot remove the trip owner', async () => {
  const sent = []
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await exchange(app, sent, 'owner@example.com')
  const trip = (await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization: owner }, payload: { title: 'Private trip' },
  })).json()
  await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/invites`, headers: { authorization: owner },
    payload: { email: 'friend@example.com', name: 'Friend', role: 'viewer' },
  })
  const friend = await exchange(app, sent, 'friend@example.com')
  const friendProfile = (await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization: friend } })).json().me
  const ownerProfile = (await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization: owner } })).json().me

  const selfRemoval = await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/members/${ownerProfile.id}`, headers: { authorization: owner },
  })
  assert.equal(selfRemoval.statusCode, 409)
  const removed = await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/members/${friendProfile.id}`, headers: { authorization: owner },
  })
  assert.equal(removed.statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization: friend } })).statusCode, 404)
  await app.close()
})
