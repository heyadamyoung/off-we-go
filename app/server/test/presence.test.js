import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

test('trip presence shows active people once, survives another tab closing, and expires stale viewers', async () => {
  let now = new Date('2027-06-01T12:00:00Z')
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => now,
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization: owner }, payload: { title: 'Shared trip' },
  })).json()
  const invitation = (await app.inject({
    method: 'POST', url: `/api/trips/${trip.id}/invites`, headers: { authorization: owner },
    payload: { email: 'friend@example.com', name: 'Alex', role: 'viewer' },
  })).json()
  const friend = await authenticate(repository, 'friend@example.com')
  await app.inject({
    method: 'POST', url: `/api/invites/${invitation.id}/accept`, headers: { authorization: friend },
  })
  const friendId = (await app.inject({
    method: 'GET', url: '/api/trips/current', headers: { authorization: friend },
  })).json().me.id

  const ownerFirstTab = await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/presence`, headers: { authorization: owner },
    payload: { clientId: 'owner-tab-1' },
  })
  assert.equal(ownerFirstTab.statusCode, 200)
  assert.deepEqual(ownerFirstTab.json().userIds, [trip.ownerId])

  await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/presence`, headers: { authorization: owner },
    payload: { clientId: 'owner-tab-2' },
  })
  const together = await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/presence`, headers: { authorization: friend },
    payload: { clientId: 'friend-tab' },
  })
  assert.deepEqual(together.json().userIds, [trip.ownerId, friendId])

  await app.inject({
    method: 'DELETE', url: `/api/trips/${trip.id}/presence`, headers: { authorization: owner },
    payload: { clientId: 'owner-tab-1' },
  })
  const afterOneTabCloses = await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/presence`, headers: { authorization: owner },
    payload: { clientId: 'owner-tab-2' },
  })
  assert.deepEqual(afterOneTabCloses.json().userIds, [trip.ownerId, friendId])

  now = new Date(now.getTime() + 46_000)
  const afterExpiry = await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/presence`, headers: { authorization: owner },
    payload: { clientId: 'owner-tab-2' },
  })
  assert.deepEqual(afterExpiry.json().userIds, [trip.ownerId])
  await app.close()
})

test('trip presence is available only to trip members', async () => {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com', 'stranger@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const stranger = await authenticate(repository, 'stranger@example.com')
  const trip = (await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization: owner }, payload: { title: 'Private trip' },
  })).json()

  const forbidden = await app.inject({
    method: 'PUT', url: `/api/trips/${trip.id}/presence`, headers: { authorization: stranger },
    payload: { clientId: 'stranger-tab' },
  })
  assert.equal(forbidden.statusCode, 403)
  await app.close()
})
