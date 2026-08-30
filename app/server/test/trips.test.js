import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

async function signedInApp() {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' } })
  const token = new URL(sent[0].webUrl).searchParams.get('token')
  const login = await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token } })
  return { app, repository, authorization: `Bearer ${login.json().accessToken}` }
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
      id: created.json().ownerId, name: 'owner', role: 'Travelling',
      memberRole: 'owner', avatar: null,
    }],
    canEdit: true,
    me: {
      id: created.json().ownerId, name: 'owner', role: 'Travelling',
      memberRole: 'owner', avatar: null,
    },
  })
  await app.close()
})
