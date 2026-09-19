import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

/* Being added to a trip by email is being on the trip. Nothing to accept:
   an account that exists is a member the moment it is added, one that does
   not is a member the moment it is made, and the mail says so either way. */

async function world() {
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
      payload: { title: 'Shared trip' },
    })
  ).json()
  const add = (payload, authorization = owner) =>
    app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/invites`,
      headers: { authorization },
      payload,
    })
  const current = authorization =>
    app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  return { app, repository, sent, owner, trip, add, current }
}

test('an account that exists is on the trip the moment it is added, and is told so', async () => {
  const { app, repository, sent, trip, add, current } = await world()
  const friend = await authenticate(repository, 'friend@example.com')
  assert.equal((await current(friend)).statusCode, 404)

  const added = await add({ email: 'friend@example.com', name: 'Alex', role: 'viewer' })
  assert.equal(added.statusCode, 201)
  assert.equal(added.json().joined, true, 'the account exists, so they are on the trip now')
  assert.ok(added.json().claimedAt, 'nothing is waiting to be accepted')
  assert.equal(added.json().mailed, true)
  assert.equal(sent.at(-1).kind, 'trip-access')
  assert.equal(sent.at(-1).to, 'friend@example.com')
  assert.equal(sent.at(-1).joined, true)
  assert.equal(sent.at(-1).role, 'viewer')
  assert.equal(sent.at(-1).tripUrl, `https://offwego.example.com/trips/${trip.slug}`)
  assert.equal(sent.at(-1).webUrl, undefined, 'the mail must not carry a sign-in token')

  const loaded = await current(friend)
  assert.equal(loaded.statusCode, 200)
  assert.equal(loaded.json().canEdit, false)
  assert.equal(
    loaded.json().me.name,
    'friend',
    'the person adding them cannot overwrite their global profile',
  )
  const forbidden = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/stops`,
    headers: { authorization: friend },
    payload: { name: 'Nope', lng: -3, lat: 55 },
  })
  assert.equal(forbidden.statusCode, 403)

  // Added again as an editor: the role changes, nothing else is asked of them.
  assert.equal((await add({ email: 'friend@example.com', role: 'editor' })).statusCode, 201)
  assert.equal((await current(friend)).json().canEdit, true)
  await app.close()
})

test('an address with no account yet is on the trip the moment the account is made', async () => {
  const { app, repository, sent, add, current } = await world()
  const added = await add({ email: 'later@example.com', name: 'Sam', role: 'editor' })
  assert.equal(added.statusCode, 201)
  assert.equal(added.json().joined, false, 'no account yet')
  assert.equal(added.json().claimedAt, null)
  assert.equal(sent.at(-1).joined, false)

  /* The address is allowed to make an account, and doing so puts them on
     the trip — no page of invitations, no button. */
  assert.equal(await repository.emailAllowed('later@example.com'), true)
  const later = await authenticate(repository, 'later@example.com')
  const loaded = await current(later)
  assert.equal(loaded.statusCode, 200)
  assert.equal(loaded.json().canEdit, true)
  await app.close()
})

test('only owners add people, and taking somebody off again removes their access', async () => {
  const { app, repository, trip, add, current, owner } = await world()
  const added = (await add({ email: 'editor@example.com', name: 'Ed', role: 'editor' })).json()
  const editor = await authenticate(repository, 'editor@example.com')
  assert.equal((await current(editor)).statusCode, 200)

  const byEditor = await add({ email: 'stranger@example.com', role: 'viewer' }, editor)
  assert.equal(byEditor.statusCode, 403)

  const listed = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/invites`,
    headers: { authorization: owner },
  })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json().length, 1)
  assert.ok(listed.json()[0].claimedAt, 'the row says the account is on the trip')

  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/invites/${added.id}`,
    headers: { authorization: owner },
  })
  assert.equal(revoked.statusCode, 204)
  assert.equal((await current(editor)).statusCode, 404)
  await app.close()
})

test('an owner can remove a member but cannot remove the trip owner', async () => {
  const { app, repository, trip, add, current, owner } = await world()
  await add({ email: 'friend@example.com', name: 'Friend', role: 'viewer' })
  const friend = await authenticate(repository, 'friend@example.com')
  const friendProfile = (await current(friend)).json().me
  const ownerProfile = (await current(owner)).json().me

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
  assert.equal((await current(friend)).statusCode, 404)
  await app.close()
})

test('the accept flow is gone: there is nothing pending and nothing to accept', async () => {
  const { app, repository, add } = await world()
  const added = (await add({ email: 'friend@example.com', role: 'viewer' })).json()
  const friend = await authenticate(repository, 'friend@example.com')
  for (const [method, url] of [
    ['GET', '/api/invites/pending'],
    ['POST', `/api/invites/${added.id}/accept`],
  ]) {
    const gone = await app.inject({ method, url, headers: { authorization: friend } })
    assert.equal(gone.statusCode, 404, `${method} ${url}`)
  }
  const landing = await app.inject({
    method: 'GET',
    url: '/api/trips',
    headers: { authorization: friend },
  })
  assert.deepEqual(Object.keys(landing.json()), ['trips'])
  assert.equal(landing.json().trips.length, 1, 'the trip is simply in their list')
  await app.close()
})
