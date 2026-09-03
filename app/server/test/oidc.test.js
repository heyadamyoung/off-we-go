import test from 'node:test'
import assert from 'node:assert/strict'

const moduleUnderTest = await import('../src/oidc.js').catch(() => null)

test('OIDC production configuration fails closed when provider credentials are incomplete', () => {
  assert.deepEqual(
    moduleUnderTest.readOidcConfig({
      WAYFARE_OIDC_ISSUER: 'https://identity.example.com/oidc/',
      WAYFARE_OIDC_CLIENT_ID: 'offwego-web',
      WAYFARE_OIDC_CLIENT_SECRET: 'provider-secret',
    }),
    {
      issuer: 'https://identity.example.com/oidc',
      clientId: 'offwego-web',
      clientSecret: 'provider-secret',
    },
  )
  assert.throws(
    () =>
      moduleUnderTest.readOidcConfig({ WAYFARE_OIDC_ISSUER: 'https://identity.example.com/oidc' }),
    /WAYFARE_OIDC_CLIENT_ID is required/,
  )
})

test('the OIDC adapter uses discovery, PKCE, state and nonce to return a verified identity', async () => {
  assert.ok(
    moduleUnderTest?.createOidcIdentityProvider,
    'the OIDC identity provider has not been implemented',
  )
  const configuration = { kind: 'discovered-configuration' }
  const oidc = {
    ClientSecretBasic(secret) {
      return { method: 'basic', secret }
    },
    async discovery(server, clientId, metadata, authentication) {
      assert.equal(server.href, 'https://identity.example.com/oidc')
      assert.equal(clientId, 'offwego-web')
      assert.deepEqual(metadata, { client_secret: 'provider-secret' })
      assert.deepEqual(authentication, { method: 'basic', secret: 'provider-secret' })
      return configuration
    },
    buildAuthorizationUrl(config, parameters) {
      assert.equal(config, configuration)
      const url = new URL('https://identity.example.com/oidc/auth')
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
      return url
    },
    buildEndSessionUrl(config, parameters) {
      assert.equal(config, configuration)
      const url = new URL('https://identity.example.com/oidc/session/end')
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
      return url
    },
    async authorizationCodeGrant(config, currentUrl, checks) {
      assert.equal(config, configuration)
      assert.equal(
        currentUrl.href,
        'https://offwego.example.com/api/auth/oidc/callback?code=abc&state=state-1',
      )
      assert.deepEqual(checks, {
        pkceCodeVerifier: 'verifier-1',
        expectedState: 'state-1',
        expectedNonce: 'nonce-1',
        idTokenExpected: true,
      })
      return {
        claims: () => ({
          iss: 'https://identity.example.com/oidc',
          sub: 'subject-1',
          email: 'OWNER@example.com',
          email_verified: true,
          name: 'Owner',
        }),
      }
    },
  }
  const provider = moduleUnderTest.createOidcIdentityProvider({
    issuer: 'https://identity.example.com/oidc',
    clientId: 'offwego-web',
    clientSecret: 'provider-secret',
    oidc,
  })

  const authorization = await provider.authorizationUrl({
    redirectUri: 'https://offwego.example.com/api/auth/oidc/callback',
    state: 'state-1',
    nonce: 'nonce-1',
    codeChallenge: 'challenge-1',
  })
  assert.equal(
    authorization,
    'https://identity.example.com/oidc/auth?redirect_uri=https%3A%2F%2Foffwego.example.com%2Fapi%2Fauth%2Foidc%2Fcallback&response_type=code&scope=openid+profile+email&state=state-1&nonce=nonce-1&code_challenge=challenge-1&code_challenge_method=S256',
  )

  const identity = await provider.exchangeCallback({
    currentUrl: 'https://offwego.example.com/api/auth/oidc/callback?code=abc&state=state-1',
    redirectUri: 'https://offwego.example.com/api/auth/oidc/callback',
    state: 'state-1',
    nonce: 'nonce-1',
    codeVerifier: 'verifier-1',
  })
  assert.deepEqual(identity, {
    issuer: 'https://identity.example.com/oidc',
    subject: 'subject-1',
    email: 'OWNER@example.com',
    emailVerified: true,
    name: 'Owner',
  })
  assert.equal(
    await provider.endSessionUrl({ postLogoutRedirectUri: 'https://offwego.example.com/' }),
    'https://identity.example.com/oidc/session/end?client_id=offwego-web&post_logout_redirect_uri=https%3A%2F%2Foffwego.example.com%2F',
  )
})

test('OIDC discovery is lazy and retries after a transient outage', async () => {
  let attempts = 0
  const oidc = {
    ClientSecretBasic() {
      return {}
    },
    async discovery() {
      attempts++
      if (attempts === 1) throw new Error('provider temporarily unavailable')
      return { kind: 'recovered' }
    },
    buildAuthorizationUrl() {
      return new URL('https://identity.example.com/authorize')
    },
  }
  const provider = moduleUnderTest.createOidcIdentityProvider({
    issuer: 'https://identity.example.com/oidc',
    clientId: 'offwego-web',
    clientSecret: 'provider-secret',
    oidc,
  })

  await assert.rejects(() => provider.authorizationUrl({}), /temporarily unavailable/)
  assert.equal(attempts, 1)
  assert.equal(await provider.authorizationUrl({}), 'https://identity.example.com/authorize')
  assert.equal(attempts, 2)
})
