import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

async function signedInApp() {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  return { app, repository, authorization: await authenticate(repository, 'owner@example.com') }
}

test('an authenticated owner can create and reload a trip in the app contract', async () => {
  const { app, authorization } = await signedInApp()
  const created = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization },
    payload: {
      title: 'Scotland 2027', crew: 'The family', dates: 'June 1–14',
      dayCount: 14, startsOn: '2027-06-01', endsOn: '2027-06-14',
    },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().title, 'Scotland 2027')
  assert.equal(created.json().slug, 'scotland-2027')

  const loaded = await app.inject({
    method: 'GET', url: `/api/trips/current?t=${created.json().slug}`,
    headers: { authorization },
  })
  assert.equal(loaded.statusCode, 200)
  assert.deepEqual(loaded.json(), {
    source: 'vps', tripId: created.json().id,
    trip: {
      id: created.json().id, slug: created.json().slug, title: 'Scotland 2027',
      crew: 'The family', dates: 'June 1–14', dayCount: 14,
      startsOn: '2027-06-01', endsOn: '2027-06-14',
    },
    stops: [], photos: [], route: [], comments: {}, likes: [],
    family: [{
      id: created.json().ownerId, handle: 'owner-user', name: 'owner', role: 'Travelling',
      memberRole: 'owner', avatar: null,
    }],
    canEdit: true,
    me: {
      id: created.json().ownerId, handle: 'owner-user', name: 'owner', role: 'Travelling',
      memberRole: 'owner', avatar: null,
    },
  })

  const duplicate = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization },
    payload: { title: 'Scotland 2027' },
  })
  assert.equal(duplicate.statusCode, 201)
  assert.equal(duplicate.json().slug, 'scotland-2027-2')

  const renamed = await app.inject({
    method: 'PATCH', url: `/api/trips/${created.json().id}`, headers: { authorization },
    payload: { title: 'Highlands 2027' },
  })
  assert.equal(renamed.statusCode, 200)
  assert.equal(renamed.json().slug, 'scotland-2027', 'renaming a trip must not break shared links')
  await app.close()
})

test('the trip landing contract lists every accessible trip and pending invitation', async () => {
  const { app, repository, authorization } = await signedInApp()
  const owned = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization },
    payload: { title: 'Scotland 2027', crew: 'The family', dates: 'June 1–14' },
  })
  const hostAuthorization = await authenticate(repository, 'host@example.com')
  const invited = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization: hostAuthorization },
    payload: { title: 'Japan 2028', crew: 'Old friends', dates: 'April 3–17' },
  })
  await app.inject({
    method: 'POST', url: `/api/trips/${invited.json().id}/invites`,
    headers: { authorization: hostAuthorization },
    payload: { email: 'owner@example.com', name: 'Owner', role: 'viewer' },
  })

  const landing = await app.inject({ method: 'GET', url: '/api/trips', headers: { authorization } })

  assert.equal(landing.statusCode, 200)
  assert.deepEqual(landing.json(), {
    trips: [{
      id: owned.json().id, slug: 'scotland-2027', title: 'Scotland 2027',
      crew: 'The family', dates: 'June 1–14', dayCount: 1,
      startsOn: null, endsOn: null, role: 'owner',
      // The home globe draws each trip from these, and the cards count from them.
      places: [], stopCount: 0, photoCount: 0, memberCount: 1,
    }],
    invites: [{
      id: '00000000-0000-4000-8000-000000500001',
      email: 'owner@example.com', name: 'Owner', role: 'viewer',
      tripId: invited.json().id, tripSlug: 'japan-2028', tripTitle: 'Japan 2028',
    }],
  })
  await app.close()
})
