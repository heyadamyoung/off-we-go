import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createMemoryRepository } from './memory-repository.js'

const moduleUnderTest = await import('../src/app.js').catch(() => null)

function createOidcProvider(identity = {
  issuer: 'https://identity.example.com/oidc', subject: 'identity-user-1',
  email: 'owner@example.com', emailVerified: true,
}) {
  let authorization = null
  return {
    async authorizationUrl(input) {
      authorization = input
      const url = new URL('https://identity.example.com/oidc/auth')
      for (const [key, value] of Object.entries({
        client_id: 'wayfare-web', redirect_uri: input.redirectUri,
        response_type: 'code', scope: 'openid profile email', state: input.state,
        nonce: input.nonce, code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
      })) url.searchParams.set(key, value)
      return url.href
    },
    async exchangeCallback(input) {
      assert.equal(input.state, authorization?.state)
      assert.equal(input.nonce, authorization?.nonce)
      assert.equal(input.redirectUri, authorization?.redirectUri)
      assert.match(input.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/)
      return identity
    },
    async endSessionUrl({ postLogoutRedirectUri }) {
      const url = new URL('https://identity.example.com/oidc/session/end')
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
      return url.href
    },
  }
}

const loginCookie = response => String(response.headers['set-cookie'] || '').split(';', 1)[0]

test('an invited user can complete OIDC authorization code with PKCE and exchange a one-time app handoff', async () => {
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })

  const started = await app.inject({ method: 'GET', url: '/api/auth/oidc/start?client=web' })
  assert.equal(started.statusCode, 302)
  const authorization = new URL(started.headers.location)
  assert.equal(authorization.origin, 'https://identity.example.com')
  assert.equal(authorization.pathname, '/oidc/auth')
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://wayfare.example.com/api/auth/oidc/callback')
  assert.equal(authorization.searchParams.get('response_type'), 'code')
  assert.equal(authorization.searchParams.get('scope'), 'openid profile email')
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
  assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/)
  assert.match(authorization.searchParams.get('state'), /^[A-Za-z0-9_-]{32,}$/)
  assert.match(authorization.searchParams.get('nonce'), /^[A-Za-z0-9_-]{32,}$/)

  const state = authorization.searchParams.get('state')
  const callback = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?code=provider-code&state=${encodeURIComponent(state)}`,
  })
  assert.equal(callback.statusCode, 302)
  const handoff = new URL(callback.headers.location, 'https://wayfare.example.com')
  assert.equal(handoff.pathname, '/auth/callback')
  assert.match(handoff.searchParams.get('token'), /^[A-Za-z0-9_-]{32,}$/)

  const exchanged = await app.inject({
    method: 'POST', url: '/api/auth/exchange',
    headers: { cookie: loginCookie(started) }, payload: { token: handoff.searchParams.get('token') },
  })
  assert.equal(exchanged.statusCode, 200)
  assert.equal(exchanged.json().user.email, 'owner@example.com')

  const replayedCallback = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?code=provider-code&state=${encodeURIComponent(state)}`,
  })
  assert.equal(replayedCallback.statusCode, 400)

  const replayedHandoff = await app.inject({
    method: 'POST', url: '/api/auth/exchange',
    headers: { cookie: loginCookie(started) }, payload: { token: handoff.searchParams.get('token') },
  })
  assert.equal(replayedHandoff.statusCode, 401)
  await app.close()
})

test('OIDC sign-in rejects an identity whose email was not verified by the provider', async () => {
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} },
    identityProvider: createOidcProvider({
      issuer: 'https://identity.example.com/oidc', subject: 'identity-user-1',
      email: 'owner@example.com', emailVerified: false,
    }),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const started = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })
  const state = new URL(started.headers.location).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?code=provider-code&state=${encodeURIComponent(state)}`,
  })

  assert.equal(callback.statusCode, 302)
  const destination = new URL(callback.headers.location)
  assert.equal(destination.pathname, '/auth/callback')
  assert.equal(destination.searchParams.get('error'), 'A verified email address is required to sign in')
  assert.equal(callback.headers['cache-control'], 'no-store')
  assert.equal(callback.headers['referrer-policy'], 'no-referrer')
  await app.close()
})

test('a cancelled native provider flow returns an actionable error to the app', async () => {
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const verifier = 'native-device-verifier-that-is-long-enough-1234567890'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const started = await app.inject({
    method: 'GET', url: `/api/auth/oidc/start?client=native&challenge=${challenge}`,
  })
  const state = new URL(started.headers.location).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?error=access_denied&state=${encodeURIComponent(state)}`,
  })

  assert.equal(callback.statusCode, 302)
  const destination = new URL(callback.headers.location)
  assert.equal(destination.pathname, '/auth/native')
  assert.equal(destination.searchParams.get('error'), 'Sign-in was cancelled or could not be completed')
  await app.close()
})

test('a linked OIDC subject keeps the same Wayfare account after its provider email changes', async () => {
  const identity = {
    issuer: 'https://identity.example.com/oidc', subject: 'identity-user-1',
    email: 'owner@example.com', emailVerified: true,
  }
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(identity),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const signIn = async () => {
    const started = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })
    const state = new URL(started.headers.location).searchParams.get('state')
    const callback = await app.inject({
      method: 'GET', url: `/api/auth/oidc/callback?code=provider-code&state=${encodeURIComponent(state)}`,
    })
    assert.equal(callback.statusCode, 302)
    const token = new URL(callback.headers.location).searchParams.get('token')
    const exchanged = await app.inject({
      method: 'POST', url: '/api/auth/exchange', headers: { cookie: loginCookie(started) }, payload: { token },
    })
    assert.equal(exchanged.statusCode, 200)
    return exchanged.json().user
  }

  const original = await signIn()
  identity.email = 'renamed@example.com'
  const renamed = await signIn()

  assert.deepEqual(renamed, original)
  assert.equal(renamed.email, 'owner@example.com')
  await app.close()
})

test('OIDC app handoffs do not invalidate a pending emailed invitation login', async () => {
  const sent = []
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } }, identityProvider: createOidcProvider(),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.inject({
    method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' },
  })
  const emailToken = new URL(sent[0].webUrl).searchParams.get('token')

  const started = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })
  const state = new URL(started.headers.location).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?code=provider-code&state=${encodeURIComponent(state)}`,
  })
  const oidcToken = new URL(callback.headers.location).searchParams.get('token')

  const oidcExchange = await app.inject({
    method: 'POST', url: '/api/auth/exchange',
    headers: { cookie: loginCookie(started) }, payload: { token: oidcToken },
  })
  const emailExchange = await app.inject({
    method: 'POST', url: '/api/auth/exchange', payload: { token: emailToken },
  })
  assert.equal(oidcExchange.statusCode, 200)
  assert.equal(emailExchange.statusCode, 200)
  await app.close()
})

test('native OIDC sign-in returns through the app universal-link handoff', async () => {
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const verifier = 'native-device-verifier-that-is-long-enough-1234567890'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const started = await app.inject({
    method: 'GET', url: `/api/auth/oidc/start?client=native&challenge=${challenge}`,
  })
  const state = new URL(started.headers.location).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?code=provider-code&state=${encodeURIComponent(state)}`,
  })

  const destination = new URL(callback.headers.location)
  assert.equal(destination.pathname, '/auth/native')
  assert.match(destination.searchParams.get('token'), /^[A-Za-z0-9_-]{32,}$/)
  const stolen = await app.inject({
    method: 'POST', url: '/api/auth/exchange',
    payload: { token: destination.searchParams.get('token'), client: 'native', verifier: 'wrong-device-verifier' },
  })
  assert.equal(stolen.statusCode, 401)
  const exchanged = await app.inject({
    method: 'POST', url: '/api/auth/exchange',
    payload: { token: destination.searchParams.get('token'), client: 'native', verifier },
  })
  assert.equal(exchanged.statusCode, 200)
  await app.close()
})

test('a web OIDC handoff cannot be exchanged from a second browser', async () => {
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const started = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })
  const state = new URL(started.headers.location).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?code=provider-code&state=${encodeURIComponent(state)}`,
  })
  const token = new URL(callback.headers.location).searchParams.get('token')

  const stolen = await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token } })
  assert.equal(stolen.statusCode, 401)
  const legitimate = await app.inject({
    method: 'POST', url: '/api/auth/exchange', headers: { cookie: loginCookie(started) }, payload: { token },
  })
  assert.equal(legitimate.statusCode, 200)
  await app.close()
})

test('OIDC authorization starts are throttled per network address', async () => {
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
    authRateLimit: { maxPerEmail: 3, maxPerIp: 2, windowMs: 60_000 },
    clock: () => new Date('2027-01-01T00:00:00Z'),
  })
  const statuses = []
  for (let index = 0; index < 3; index++) {
    statuses.push((await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })).statusCode)
  }

  assert.deepEqual(statuses, [302, 302, 429])
  await app.close()
})

test('OIDC logout ends the provider session and uses a fixed safe return', async () => {
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository(), mailer: { async send() {} }, identityProvider: createOidcProvider(),
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const web = await app.inject({ method: 'GET', url: '/api/auth/oidc/logout?return=https://evil.example' })
  assert.equal(web.statusCode, 302)
  assert.equal(new URL(web.headers.location).searchParams.get('post_logout_redirect_uri'), 'https://wayfare.example.com/')
  const native = await app.inject({ method: 'GET', url: '/api/auth/oidc/logout?client=native' })
  assert.equal(new URL(native.headers.location).searchParams.get('post_logout_redirect_uri'),
    'https://wayfare.example.com/auth/native?logout=1')
  await app.close()
})

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
  assert.match(sent[0].nativeUrl, /^https:\/\/wayfare\.example\.com\/auth\/native\?token=/)
  assert.equal(
    new URL(sent[0].nativeUrl).searchParams.get('token'),
    new URL(sent[0].webUrl).searchParams.get('token'),
  )

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

  const oversizedExchange = await app.inject({
    method: 'POST', url: '/api/auth/exchange', payload: { token: 'x'.repeat(100_000) },
  })
  assert.equal(oversizedExchange.statusCode, 413)

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

  const oversized = await app.inject({
    method: 'POST', url: '/api/auth/magic-link',
    payload: { email: `${'x'.repeat(20_000)}@example.com` },
  })
  assert.equal(oversized.statusCode, 413)
  await app.close()
})

test('a malformed OAuth continuation cannot break or redirect a magic link', async () => {
  const sent = []
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const requested = await app.inject({
    method: 'POST', url: '/api/auth/magic-link',
    payload: { email: 'owner@example.com', continue: 'http://[' },
  })
  assert.equal(requested.statusCode, 202)
  assert.equal(sent.length, 1)
  assert.equal(new URL(sent[0].webUrl).searchParams.has('continue'), false)
  await app.close()
})
