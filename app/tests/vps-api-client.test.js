import test from 'node:test'
import assert from 'node:assert/strict'

const moduleUnderTest = await import('../src/api-client-core.ts').catch(() => null)
const liveModule = await import('../src/live-positions-core.ts').catch(() => null)

test('the VPS client exchanges a magic token, persists the session and authenticates requests', async () => {
  assert.ok(moduleUnderTest?.createApiClient, 'the self-hosted API client has not been implemented')
  const saved = new Map()
  const calls = []
  const client = moduleUnderTest.createApiClient({
    baseUrl: '/api',
    storage: {
      getItem(key) { return saved.get(key) || null },
      setItem(key, value) { saved.set(key, value) },
      removeItem(key) { saved.delete(key) },
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, options })
      if (url === '/api/auth/exchange') return new Response(JSON.stringify({
        accessToken: 'session-token', user: { id: 'user-1', email: 'owner@example.com' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ title: 'Scotland' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    },
  })

  const session = await client.exchangeMagicToken('one-time-token')
  assert.equal(session.user.email, 'owner@example.com')
  assert.deepEqual(JSON.parse(saved.get('wayfare-session')), session)

  assert.deepEqual(await client.request('/trips/current'), { title: 'Scotland' })
  assert.equal(calls[1].options.headers.authorization, 'Bearer session-token')
})

test('API errors expose their HTTP status so the app can distinguish an empty account', async () => {
  const client = moduleUnderTest.createApiClient({
    baseUrl: '/api',
    storage: { getItem() { return null }, setItem() {}, removeItem() {} },
    fetch: async () => new Response(JSON.stringify({ error: 'No trip found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    }),
  })
  await assert.rejects(client.request('/trips/current'), error => {
    assert.equal(error.message, 'No trip found')
    assert.equal(error.status, 404)
    return true
  })
})

test('magic-link continuation only returns to the same-origin OAuth authorization page', () => {
  assert.equal(
    moduleUnderTest.safeOAuthContinuation('/oauth/authorize?client_id=abc', 'https://wayfare.example.com'),
    '/oauth/authorize?client_id=abc',
  )
  assert.equal(moduleUnderTest.safeOAuthContinuation('https://evil.example/oauth/authorize', 'https://wayfare.example.com'), null)
  assert.equal(moduleUnderTest.safeOAuthContinuation('/account', 'https://wayfare.example.com'), null)
})

test('the API client restores a session from asynchronous native secure storage', async () => {
  const stored = JSON.stringify({ accessToken: 'keychain-token', user: { id: 'old', email: 'owner@example.com' } })
  const client = moduleUnderTest.createApiClient({
    baseUrl: '/api',
    storage: {
      async getItem(key) { return key === 'wayfare-session' ? stored : null },
      async setItem() {},
      async removeItem() {},
    },
    fetch: async (_url, options) => {
      assert.equal(options.headers.authorization, 'Bearer keychain-token')
      return new Response(JSON.stringify({ user: { id: 'fresh', email: 'owner@example.com' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    },
  })

  const restored = await client.restore()

  assert.equal(restored.accessToken, 'keychain-token')
  assert.equal(restored.user.id, 'fresh')
})

test('live GPS retention is bounded independently for every phone and removes duplicate fixes', () => {
  assert.ok(liveModule?.mergeLiveFixes, 'the per-device live GPS buffer has not been implemented')
  const at = value => new Date(`2027-01-01T00:00:0${value}.000Z`)
  const existing = [
    { deviceId: 'a', at: at(1), lat: 1 }, { deviceId: 'a', at: at(2), lat: 2 },
    { deviceId: 'b', at: at(1), lat: 3 }, { deviceId: 'c', at: at(1), lat: 4 },
  ]
  const incoming = [
    { deviceId: 'a', at: at(2), lat: 2 }, { deviceId: 'a', at: at(3), lat: 5 },
    { deviceId: 'b', at: at(2), lat: 6 }, { deviceId: 'b', at: at(3), lat: 7 },
    { deviceId: 'c', at: at(2), lat: 8 }, { deviceId: 'c', at: at(3), lat: 9 },
  ]

  const result = liveModule.mergeLiveFixes(existing, incoming, 2)

  assert.equal(result.length, 6)
  assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(result, value => value.deviceId))), {
    a: [{ deviceId: 'a', at: at(2), lat: 2 }, { deviceId: 'a', at: at(3), lat: 5 }],
    b: [{ deviceId: 'b', at: at(2), lat: 6 }, { deviceId: 'b', at: at(3), lat: 7 }],
    c: [{ deviceId: 'c', at: at(2), lat: 8 }, { deviceId: 'c', at: at(3), lat: 9 }],
  })
})
