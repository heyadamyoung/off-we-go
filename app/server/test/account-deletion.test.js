import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

test('account deletion removes the user, sole-owned trip content, private files and active session', async () => {
  const sent = [], removed = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: { async remove(path) { removed.push(path) } },
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://offwego.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (await app.inject({ method: 'POST', url: '/api/trips', headers, payload: { title: 'Private trip' } })).json()
  repository.seedPhoto(trip.id)

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/account', headers, payload: { confirm: 'DELETE' } })).statusCode, 204)
  assert.deepEqual(removed.sort(), [`${trip.id}/seed.jpg`])
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/session', headers })).statusCode, 401)
  assert.equal(await repository.findUserByEmail('owner@example.com'), null)
  await app.close()
})

test('account deletion retries private-file removal after a filesystem failure and restart', async () => {
  const sent = [], removed = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  let failing = true
  let now = new Date('2027-01-01T00:00:00Z')
  const fileStore = {
    async remove(path) {
      if (failing) throw new Error('disk temporarily unavailable')
      removed.push(path)
    },
  }
  const options = {
    repository, fileStore,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://offwego.example.com', sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => now,
  }
  const app = await buildServer(options)
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (await app.inject({ method: 'POST', url: '/api/trips', headers, payload: { title: 'Private trip' } })).json()
  repository.seedPhoto(trip.id)

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/account', headers, payload: { confirm: 'DELETE' } })).statusCode, 204)
  assert.deepEqual(removed, [])
  await app.close()

  failing = false
  now = new Date('2027-01-01T00:01:01Z')
  const restarted = await buildServer(options)
  assert.deepEqual(removed, [`${trip.id}/seed.jpg`])
  await restarted.close()
})
