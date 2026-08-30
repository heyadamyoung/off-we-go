import test from 'node:test'
import assert from 'node:assert/strict'

const moduleUnderTest = await import('../src/apiClientCore.js').catch(() => null)

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
