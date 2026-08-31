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

test('a linked OIDC subject keeps the same Off We Go account after its provider email changes', async () => {
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

test('magic-link authentication is unavailable', async () => {
  const sent = []
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const requested = await app.inject({
    method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' },
  })
  assert.equal(requested.statusCode, 404)
  assert.deepEqual(sent, [])
  const exchanged = await app.inject({
    method: 'POST', url: '/api/auth/exchange', payload: { token: 'x'.repeat(43) },
  })
  assert.equal(exchanged.statusCode, 401)
  await app.close()
})

test('custom password sign-in completes the Logto interaction without exposing hosted Logto pages', async () => {
  const upstream = []
  const identityProvider = createOidcProvider()
  const experienceFetch = async (url, options = {}) => {
    upstream.push({ url: String(url), options })
    const path = new URL(url).pathname
    if (path === '/oidc/auth') {
      return new Response(null, {
        status: 303,
        headers: { location: '/sign-in', 'set-cookie': 'logto_interaction=secret; Path=/; HttpOnly' },
      })
    }
    if (path === '/api/experience/submit') {
      return Response.json({ redirectTo: '/oidc/continue' })
    }
    if (path === '/oidc/continue') {
      const authorization = new URL(upstream[0].url)
      const callback = new URL(authorization.searchParams.get('redirect_uri'))
      callback.searchParams.set('code', 'provider-code')
      callback.searchParams.set('state', authorization.searchParams.get('state'))
      return new Response(null, { status: 302, headers: { location: callback.href } })
    }
    if (path === '/api/experience/verification/password') {
      return Response.json({ verificationId: 'password-verification' })
    }
    return new Response(null, { status: 204 })
  }
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider, experienceFetch,
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })

  const started = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
  assert.equal(started.statusCode, 200)
  assert.equal(started.json().started, true)
  assert.match(started.json().interaction, /^[A-Za-z0-9_-]{32,}$/)
  const interactionCookie = loginCookie(started)
  assert.match(interactionCookie, /^__Host-wayfare-experience=/)
  assert.doesNotMatch(String(started.headers['set-cookie']), /logto_interaction/)

  const calls = [
    ['PUT', '/api/auth/experience', { interactionEvent: 'SignIn' }],
    ['POST', '/api/auth/experience/verification/password', {
      identifier: { type: 'email', value: 'owner@example.com' }, password: 'correct horse battery staple',
    }],
    ['POST', '/api/auth/experience/identification', { verificationId: 'password-verification' }],
  ]
  for (const [method, url, payload] of calls) {
    const response = await app.inject({
      method, url, headers: { 'x-wayfare-experience': started.json().interaction }, payload,
    })
    assert.ok(response.statusCode < 300, `${method} ${url}: ${response.body}`)
  }
  const submitted = await app.inject({
    method: 'POST', url: '/api/auth/experience/submit',
    headers: { 'x-wayfare-experience': started.json().interaction }, payload: {},
  })
  assert.equal(submitted.statusCode, 200)
  assert.equal(submitted.json().user.email, 'owner@example.com')
  assert.match(submitted.json().accessToken, /^[A-Za-z0-9_-]{32,}$/)
  assert.equal(upstream.some(call => new URL(call.url).pathname === '/sign-in'), false)
  assert.match(String(upstream[1].options.headers.cookie), /logto_interaction=secret/)
  await app.close()
})

test('custom account creation sends a Logto verification code without requiring a trip invitation', async () => {
  let verificationCodeRequests = 0
  const experienceFetch = async (url, options = {}) => {
    const path = new URL(url).pathname
    if (path === '/oidc/auth') {
      return new Response(null, {
        status: 303,
        headers: { location: '/sign-in', 'set-cookie': 'logto_interaction=secret; Path=/; HttpOnly' },
      })
    }
    if (path === '/api/experience/verification/verification-code') verificationCodeRequests++
    return new Response(null, { status: 204 })
  }
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['invited@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(), experienceFetch,
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const started = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
  const cookie = loginCookie(started)
  await app.inject({
    method: 'PUT', url: '/api/auth/experience', headers: { cookie }, payload: { interactionEvent: 'Register' },
  })
  const sent = await app.inject({
    method: 'POST', url: '/api/auth/experience/verification/verification-code', headers: { cookie },
    payload: { identifier: { type: 'email', value: 'stranger@example.com' }, interactionEvent: 'Register' },
  })

  assert.equal(sent.statusCode, 204)
  assert.equal(verificationCodeRequests, 1)
  await app.close()
})

test('account creation reserves a normalized unique profile handle before contacting Logto', async () => {
  let upstreamHandleRequests = 0
  const experienceFetch = async (url) => {
    const path = new URL(url).pathname
    if (path === '/oidc/auth') {
      return new Response(null, {
        status: 303,
        headers: { location: '/sign-in', 'set-cookie': 'logto_interaction=secret; Path=/; HttpOnly' },
      })
    }
    if (path.endsWith('/handle')) upstreamHandleRequests++
    return new Response(null, { status: 204 })
  }
  const repository = createMemoryRepository()
  const app = await moduleUnderTest.buildServer({
    repository, mailer: { async send() {} },
    identityProvider: createOidcProvider(), experienceFetch,
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const first = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
  const second = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
  for (const interaction of [first.json().interaction, second.json().interaction]) {
    await app.inject({
      method: 'PUT', url: '/api/auth/experience',
      headers: { 'x-wayfare-experience': interaction }, payload: { interactionEvent: 'Register' },
    })
  }
  const reserve = interaction => app.inject({
    method: 'POST', url: '/api/auth/experience/handle',
    headers: { 'x-wayfare-experience': interaction }, payload: { handle: 'Adam-Young' },
  })

  const reserved = await reserve(first.json().interaction)
  assert.equal(reserved.statusCode, 200)
  assert.deepEqual(reserved.json(), { handle: 'adam-young' })

  const conflict = await reserve(second.json().interaction)
  assert.equal(conflict.statusCode, 409)
  assert.deepEqual(conflict.json(), {
    code: 'profile.handle_taken', error: 'That handle is already taken.',
  })
  assert.equal(upstreamHandleRequests, 0, 'private handle reservations must never be forwarded to Logto')

  const existing = await repository.ensureUser('existing@example.com')
  assert.deepEqual(await repository.updateProfile(existing, { handle: 'adam-young' }), { conflict: 'handle' },
    'editing a profile cannot steal a handle reserved by an account being created')

  const forged = await app.inject({
    method: 'POST', url: '/api/auth/experience/handle',
    headers: { 'x-wayfare-experience': 'not-an-issued-registration' }, payload: { handle: 'forged-handle' },
  })
  assert.equal(forged.statusCode, 400)
  await app.close()
})

test('account creation rejects malformed and impersonating profile handles', async () => {
  const experienceFetch = async url => new URL(url).pathname === '/oidc/auth'
    ? new Response(null, {
      status: 303,
      headers: { location: '/sign-in', 'set-cookie': 'logto_interaction=secret; Path=/; HttpOnly' },
    })
    : new Response(null, { status: 204 })
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository(), mailer: { async send() {} },
    identityProvider: createOidcProvider(), experienceFetch,
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const started = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
  await app.inject({
    method: 'PUT', url: '/api/auth/experience', headers: { 'x-wayfare-experience': started.json().interaction },
    payload: { interactionEvent: 'Register' },
  })
  for (const handle of ['ab', 'two--hyphens', 'email@example.com', 'support']) {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/experience/handle',
      headers: { 'x-wayfare-experience': started.json().interaction }, payload: { handle },
    })
    assert.equal(response.statusCode, 400, handle)
    assert.equal(response.json().code, 'profile.handle_invalid')
  }
  await app.close()
})

test('account creation binds the reserved handle to the new global profile', async () => {
  const upstream = []
  const identityProvider = createOidcProvider({
    issuer: 'https://identity.example.com/oidc', subject: 'new-identity',
    email: 'new@example.com', emailVerified: true,
  })
  const experienceFetch = async (url, options = {}) => {
    upstream.push({ url: String(url), options })
    const path = new URL(url).pathname
    if (path === '/oidc/auth') {
      return new Response(null, {
        status: 303,
        headers: { location: '/sign-in', 'set-cookie': 'logto_interaction=secret; Path=/; HttpOnly' },
      })
    }
    if (path === '/api/experience/verification/verification-code') {
      return Response.json({ verificationId: 'email-code' })
    }
    if (path === '/api/experience/submit') return Response.json({ redirectTo: '/oidc/continue' })
    if (path === '/oidc/continue') {
      const authorization = new URL(upstream[0].url)
      const callback = new URL(authorization.searchParams.get('redirect_uri'))
      callback.searchParams.set('code', 'provider-code')
      callback.searchParams.set('state', authorization.searchParams.get('state'))
      return new Response(null, { status: 302, headers: { location: callback.href } })
    }
    return new Response(null, { status: 204 })
  }
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository(), mailer: { async send() {} }, identityProvider, experienceFetch,
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const started = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
  const interaction = started.json().interaction
  const headers = { 'x-wayfare-experience': interaction }
  const calls = [
    ['PUT', '/api/auth/experience', { interactionEvent: 'Register' }],
    ['POST', '/api/auth/experience/handle', { handle: 'Prairie-Adam' }],
    ['POST', '/api/auth/experience/verification/verification-code', {
      identifier: { type: 'email', value: 'new@example.com' }, interactionEvent: 'Register',
    }],
    ['POST', '/api/auth/experience/verification/verification-code/verify', {
      verificationId: 'email-code', code: '204913',
    }],
    ['POST', '/api/auth/experience/profile', { type: 'password', value: 'a sufficiently long password' }],
    ['POST', '/api/auth/experience/identification', { verificationId: 'email-code' }],
  ]
  for (const [method, url, payload] of calls) {
    const response = await app.inject({ method, url, headers, payload })
    assert.ok(response.statusCode < 300, `${method} ${url}: ${response.body}`)
  }
  const registered = await app.inject({
    method: 'POST', url: '/api/auth/experience/submit', headers, payload: {},
  })
  assert.equal(registered.statusCode, 200)
  const authorization = `Bearer ${registered.json().accessToken}`
  await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization }, payload: { title: 'First Trip' },
  })
  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.equal(loaded.json().me.handle, 'prairie-adam')
  await app.close()
})

test('custom account creation translates Logto failures into safe actionable errors', async () => {
  const experienceFetch = async (url) => {
    const path = new URL(url).pathname
    if (path === '/oidc/auth') {
      return new Response(null, {
        status: 303,
        headers: { location: '/sign-in', 'set-cookie': 'logto_interaction=secret; Path=/; HttpOnly' },
      })
    }
    if (path === '/api/experience/verification/verification-code') {
      return Response.json({
        code: 'connector.not_found',
        message: 'Cannot find any available connector for type: Email.',
      }, { status: 501 })
    }
    return new Response(null, { status: 204 })
  }
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository(), mailer: { async send() {} },
    identityProvider: createOidcProvider(), experienceFetch,
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
  })
  const started = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
  const interaction = started.json().interaction
  await app.inject({
    method: 'PUT', url: '/api/auth/experience', headers: { 'x-wayfare-experience': interaction },
    payload: { interactionEvent: 'Register' },
  })
  const failed = await app.inject({
    method: 'POST', url: '/api/auth/experience/verification/verification-code',
    headers: { 'x-wayfare-experience': interaction },
    payload: { identifier: { type: 'email', value: 'new@example.com' }, interactionEvent: 'Register' },
  })

  assert.equal(failed.statusCode, 501)
  assert.deepEqual(failed.json(), {
    code: 'auth.email_delivery_unavailable',
    error: 'Email verification is temporarily unavailable. Please try again later.',
  })
  assert.doesNotMatch(failed.body, /connector|Logto/i)
  await app.close()
})

test('custom password checks are throttled per email before reaching Logto', async () => {
  let passwordChecks = 0
  const experienceFetch = async url => {
    const path = new URL(url).pathname
    if (path === '/oidc/auth') {
      return new Response(null, {
        status: 303,
        headers: { location: '/sign-in', 'set-cookie': 'logto_interaction=secret; Path=/; HttpOnly' },
      })
    }
    if (path === '/api/experience/verification/password') passwordChecks++
    return path === '/api/experience/verification/password'
      ? Response.json({ verificationId: 'password-verification' })
      : new Response(null, { status: 204 })
  }
  const app = await moduleUnderTest.buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} }, identityProvider: createOidcProvider(), experienceFetch,
    publicUrl: 'https://wayfare.example.com', sessionSecret: 'test-secret-that-is-long-enough',
    authRateLimit: { maxPerEmail: 2, maxPerIp: 20, windowMs: 60_000 },
  })
  const statuses = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = await app.inject({ method: 'POST', url: '/api/auth/experience/start' })
    const interaction = started.json().interaction
    await app.inject({
      method: 'PUT', url: '/api/auth/experience', headers: { 'x-wayfare-experience': interaction },
      payload: { interactionEvent: 'SignIn' },
    })
    statuses.push((await app.inject({
      method: 'POST', url: '/api/auth/experience/verification/password',
      headers: { 'x-wayfare-experience': interaction },
      payload: { identifier: { type: 'email', value: 'OWNER@example.com' }, password: 'guess' },
    })).statusCode)
  }
  assert.deepEqual(statuses, [200, 200, 429])
  assert.equal(passwordChecks, 2)
  await app.close()
})
