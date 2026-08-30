import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryRepository } from './memory-repository.js'

const moduleUnderTest = await import('../src/app.js').catch(() => null)

test('an invited email can exchange a one-time link for an authenticated session', async () => {
  assert.ok(moduleUnderTest?.buildServer, 'the self-hosted Wayfare API has not been implemented')

  const sent = []
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })

  const health = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.json(), { ok: true })

  const requested = await app.inject({
    method: 'POST', url: '/api/auth/magic-link', payload: { email: ' OWNER@example.com ' },
  })
  assert.equal(requested.statusCode, 202)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'owner@example.com')
  assert.match(sent[0].webUrl, /^https:\/\/wayfare\.example\.com\/auth\/callback\?token=/)
  assert.equal(sent[0].nativeUrl, sent[0].webUrl)

  const token = new URL(sent[0].webUrl).searchParams.get('token')
  const exchanged = await app.inject({
    method: 'POST', url: '/api/auth/exchange', payload: { token },
  })
  assert.equal(exchanged.statusCode, 200)
  const session = exchanged.json()
  assert.equal(session.user.email, 'owner@example.com')
  assert.match(session.accessToken, /^[A-Za-z0-9_-]{32,}$/)

  const replay = await app.inject({
    method: 'POST', url: '/api/auth/exchange', payload: { token },
  })
  assert.equal(replay.statusCode, 401)

  const current = await app.inject({
    method: 'GET', url: '/api/auth/session',
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  assert.equal(current.statusCode, 200)
  assert.deepEqual(current.json().user, session.user)

  await app.close()
})

test('magic-link requests are throttled per email before they can spam SMTP or invalidate more tokens', async () => {
  const sent = []
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
    clock: () => new Date('2027-01-01T00:00:00Z'),
    authRateLimit: { maxPerEmail: 2, maxPerIp: 10, windowMs: 60_000 },
  })
  const statuses = []
  for (let index = 0; index < 3; index++) statuses.push((await app.inject({
    method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' },
  })).statusCode)
  assert.deepEqual(statuses, [202, 202, 429])
  assert.equal(sent.length, 2)
  await app.close()
})
