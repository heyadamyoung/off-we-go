import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

test('account deletion removes the user, sole-owned trip content, private files and active session', async () => {
  const sent = [], removed = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: { async remove(path) { removed.push(path) } },
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' } })
  const token = new URL(sent[0].webUrl).searchParams.get('token')
  const login = (await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token } })).json()
  const headers = { authorization: `Bearer ${login.accessToken}` }
  const trip = (await app.inject({ method: 'POST', url: '/api/trips', headers, payload: { title: 'Private trip' } })).json()
  repository.seedPhoto(trip.id)

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/account', headers, payload: { confirm: 'DELETE' } })).statusCode, 204)
  assert.deepEqual(removed.sort(), [`${trip.id}/seed.jpg`])
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/session', headers })).statusCode, 401)
  assert.equal(await repository.findUserByEmail('owner@example.com'), null)
  await app.close()
})
