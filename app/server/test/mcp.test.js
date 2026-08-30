import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

const root = 'https://wayfare.example.com'

const form = values => ({
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams(values).toString(),
})

async function fixture() {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send(message) { sent.push(message) } },
    publicUrl: root,
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: 'owner@example.com' } })
  const magicToken = new URL(sent[0].webUrl).searchParams.get('token')
  const login = await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token: magicToken } })
  const accessToken = login.json().accessToken
  return { app, repository, authorization: `Bearer ${accessToken}` }
}

async function registerClient(app) {
  const response = await app.inject({
    method: 'POST', url: '/oauth/register',
    payload: {
      client_name: 'Codex Desktop',
      redirect_uris: ['http://127.0.0.1:3210/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  })
  assert.equal(response.statusCode, 201)
  return response.json()
}

const pkce = verifier => createHash('sha256').update(verifier).digest('base64url')

async function authorize(app, authorization, clientId, scopes = 'trips:read trips:write') {
  const verifier = 'wayfare-test-pkce-verifier-that-is-more-than-forty-three-characters'
  const query = new URLSearchParams({
    response_type: 'code', client_id: clientId,
    redirect_uri: 'http://127.0.0.1:3210/callback',
    scope: scopes, state: 'client-state',
    code_challenge: pkce(verifier), code_challenge_method: 'S256',
    resource: `${root}/mcp`,
  })
  const page = await app.inject({ method: 'GET', url: `/oauth/authorize?${query}` })
  assert.equal(page.statusCode, 200)
  assert.match(page.headers['content-security-policy'], /default-src 'none'/)
  assert.match(page.body, /Codex Desktop/)
  assert.match(page.body, /View your trips/)
  if (scopes.includes('trips:write')) assert.match(page.body, /Create and edit trip details/)
  const requestToken = page.body.match(/name="request_token" value="([^"]+)"/)?.[1]
  assert.ok(requestToken)

  const consent = await app.inject({
    method: 'POST', url: '/api/oauth/consent', headers: { authorization },
    payload: { requestToken, approve: true, scope: scopes },
  })
  assert.equal(consent.statusCode, 200)
  const redirect = new URL(consent.json().redirectTo)
  assert.equal(redirect.origin + redirect.pathname, 'http://127.0.0.1:3210/callback')
  assert.equal(redirect.searchParams.get('state'), 'client-state')
  assert.ok(redirect.searchParams.get('code'))
  return { code: redirect.searchParams.get('code'), verifier }
}

async function exchangeCode(app, clientId, code, verifier) {
  const response = await app.inject({
    method: 'POST', url: '/oauth/token',
    ...form({
      grant_type: 'authorization_code', client_id: clientId, code,
      redirect_uri: 'http://127.0.0.1:3210/callback', code_verifier: verifier,
      resource: `${root}/mcp`,
    }),
  })
  assert.equal(response.statusCode, 200)
  return response.json()
}

test('publishes OAuth metadata for the protected MCP resource', async () => {
  const { app } = await fixture()
  const authorization = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })
  assert.equal(authorization.statusCode, 200)
  assert.deepEqual(authorization.json(), {
    issuer: root,
    authorization_endpoint: `${root}/oauth/authorize`,
    token_endpoint: `${root}/oauth/token`,
    registration_endpoint: `${root}/oauth/register`,
    revocation_endpoint: `${root}/oauth/revoke`,
    scopes_supported: ['trips:read', 'trips:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  })
  const resource = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' })
  assert.equal(resource.statusCode, 200)
  assert.deepEqual(resource.json(), {
    resource: `${root}/mcp`, authorization_servers: [root],
    scopes_supported: ['trips:read', 'trips:write'],
    bearer_methods_supported: ['header'], resource_name: 'Wayfare Trips',
  })
  const unrelatedRootResource = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })
  assert.equal(unrelatedRootResource.statusCode, 404)
  await app.close()
})

test('registers only public clients with safe exact redirect URIs', async () => {
  const { app } = await fixture()
  const client = await registerClient(app)
  assert.ok(client.client_id)
  assert.equal(client.client_name, 'Codex Desktop')
  assert.equal(client.token_endpoint_auth_method, 'none')
  assert.equal(client.client_secret, undefined)

  const unsafe = await app.inject({
    method: 'POST', url: '/oauth/register',
    payload: { client_name: 'Bad client', redirect_uris: ['https://good.example/callback#fragment'] },
  })
  assert.equal(unsafe.statusCode, 400)
  assert.equal(unsafe.json().error, 'invalid_redirect_uri')
  await app.close()
})

test('allows a registered loopback redirect to use an ephemeral port only', async () => {
  const { app } = await fixture()
  const client = await registerClient(app)
  const verifier = 'loopback-port-pkce-verifier-that-is-more-than-forty-three-characters'
  const query = new URLSearchParams({
    response_type: 'code', client_id: client.client_id,
    redirect_uri: 'http://127.0.0.1:49876/callback', scope: 'trips:read', state: 'loopback',
    code_challenge: pkce(verifier), code_challenge_method: 'S256', resource: `${root}/mcp`,
  })
  const page = await app.inject({ method: 'GET', url: `/oauth/authorize?${query}` })
  assert.equal(page.statusCode, 200)

  query.set('redirect_uri', 'http://127.0.0.1:49876/different-path')
  const wrongPath = await app.inject({ method: 'GET', url: `/oauth/authorize?${query}` })
  assert.equal(wrongPath.statusCode, 400)
  await app.close()
})

test('throttles unauthenticated dynamic client registration', async () => {
  const { app } = await fixture()
  const statuses = []
  for (let index = 0; index < 21; index++) {
    const response = await app.inject({
      method: 'POST', url: '/oauth/register',
      payload: {
        client_name: `Client ${index}`,
        redirect_uris: [`http://127.0.0.1:${4000 + index}/callback`],
        token_endpoint_auth_method: 'none',
      },
    })
    statuses.push(response.statusCode)
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(201))
  assert.equal(statuses[20], 429)
  const otherAddress = await app.inject({
    method: 'POST', url: '/oauth/register', headers: { 'x-forwarded-for': '203.0.113.52' },
    payload: {
      client_name: 'Different address', redirect_uris: ['http://127.0.0.1:4999/callback'],
      token_endpoint_auth_method: 'none',
    },
  })
  assert.equal(otherAddress.statusCode, 201)
  await app.close()
})

test('a user can decline an authorization request without signing in', async () => {
  const { app } = await fixture()
  const client = await registerClient(app)
  const verifier = 'another-wayfare-pkce-verifier-that-is-long-enough-for-oauth'
  const query = new URLSearchParams({
    response_type: 'code', client_id: client.client_id,
    redirect_uri: 'http://127.0.0.1:3210/callback', scope: 'trips:read', state: 'decline-state',
    code_challenge: pkce(verifier), code_challenge_method: 'S256', resource: `${root}/mcp`,
  })
  const page = await app.inject({ method: 'GET', url: `/oauth/authorize?${query}` })
  const requestToken = page.body.match(/name="request_token" value="([^"]+)"/)?.[1]
  const denied = await app.inject({
    method: 'POST', url: '/api/oauth/consent',
    payload: { requestToken, approve: false },
  })
  assert.equal(denied.statusCode, 200)
  const redirect = new URL(denied.json().redirectTo)
  assert.equal(redirect.searchParams.get('error'), 'access_denied')
  assert.equal(redirect.searchParams.get('state'), 'decline-state')
  await app.close()
})

test('runs authorization code with PKCE and rotates refresh tokens', async () => {
  const { app, authorization } = await fixture()
  const client = await registerClient(app)
  const grant = await authorize(app, authorization, client.client_id)
  const tokens = await exchangeCode(app, client.client_id, grant.code, grant.verifier)
  assert.equal(tokens.token_type, 'Bearer')
  assert.equal(tokens.expires_in, 3600)
  assert.equal(tokens.scope, 'trips:read trips:write')
  assert.ok(tokens.access_token)
  assert.ok(tokens.refresh_token)

  const replay = await app.inject({
    method: 'POST', url: '/oauth/token',
    ...form({
      grant_type: 'authorization_code', client_id: client.client_id, code: grant.code,
      redirect_uri: 'http://127.0.0.1:3210/callback', code_verifier: grant.verifier,
      resource: `${root}/mcp`,
    }),
  })
  assert.equal(replay.statusCode, 400)
  assert.equal(replay.json().error, 'invalid_grant')

  const refreshed = await app.inject({
    method: 'POST', url: '/oauth/token',
    ...form({
      grant_type: 'refresh_token', client_id: client.client_id,
      refresh_token: tokens.refresh_token, resource: `${root}/mcp`,
    }),
  })
  assert.equal(refreshed.statusCode, 200)
  assert.notEqual(refreshed.json().access_token, tokens.access_token)
  assert.notEqual(refreshed.json().refresh_token, tokens.refresh_token)

  const reusedRefresh = await app.inject({
    method: 'POST', url: '/oauth/token',
    ...form({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token }),
  })
  assert.equal(reusedRefresh.statusCode, 400)
  assert.equal(reusedRefresh.json().error, 'invalid_grant')
  await app.close()
})

test('rejects a low-entropy PKCE verifier even when its challenge matches', async () => {
  const { app, authorization } = await fixture()
  const client = await registerClient(app)
  const verifier = 'short'
  const query = new URLSearchParams({
    response_type: 'code', client_id: client.client_id,
    redirect_uri: 'http://127.0.0.1:3210/callback', scope: 'trips:read', state: 'weak-pkce',
    code_challenge: pkce(verifier), code_challenge_method: 'S256', resource: `${root}/mcp`,
  })
  const page = await app.inject({ method: 'GET', url: `/oauth/authorize?${query}` })
  const requestToken = page.body.match(/name="request_token" value="([^"]+)"/)?.[1]
  const consent = await app.inject({
    method: 'POST', url: '/api/oauth/consent', headers: { authorization },
    payload: { requestToken, approve: true, scope: 'trips:read' },
  })
  const code = new URL(consent.json().redirectTo).searchParams.get('code')
  const exchanged = await app.inject({
    method: 'POST', url: '/oauth/token',
    ...form({
      grant_type: 'authorization_code', client_id: client.client_id, code,
      redirect_uri: 'http://127.0.0.1:3210/callback', code_verifier: verifier,
      resource: `${root}/mcp`,
    }),
  })
  assert.equal(exchanged.statusCode, 400)
  assert.equal(exchanged.json().error, 'invalid_grant')
  await app.close()
})

test('requires a scoped OAuth token and can manipulate a trip through MCP tools', async () => {
  const { app, authorization } = await fixture()
  const created = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization },
    payload: { title: 'Scotland 2027', dayCount: 14 },
  })
  assert.equal(created.statusCode, 201)

  const missing = await app.inject({
    method: 'POST', url: '/mcp',
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  assert.equal(missing.statusCode, 401)
  assert.match(missing.headers['www-authenticate'], /oauth-protected-resource\/mcp/)

  const client = await registerClient(app)
  const grant = await authorize(app, authorization, client.client_id)
  const tokens = await exchangeCode(app, client.client_id, grant.code, grant.verifier)
  const mcpHeaders = {
    authorization: `Bearer ${tokens.access_token}`,
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
  }
  const listed = await app.inject({
    method: 'POST', url: '/mcp', headers: mcpHeaders,
    payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  })
  assert.equal(listed.statusCode, 200)
  assert.match(listed.body, /get_trip/)
  assert.match(listed.body, /update_trip/)

  const tripView = await app.inject({
    method: 'POST', url: '/mcp', headers: mcpHeaders,
    payload: {
      jsonrpc: '2.0', id: 21, method: 'tools/call',
      params: { name: 'get_trip', arguments: {} },
    },
  })
  assert.equal(tripView.statusCode, 200)
  assert.match(tripView.body, /Scotland 2027/)
  assert.doesNotMatch(tripView.body, /owner@example\.com/)

  const updated = await app.inject({
    method: 'POST', url: '/mcp', headers: mcpHeaders,
    payload: {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'update_trip', arguments: { tripId: created.json().id, title: 'Highlands 2027' } },
    },
  })
  assert.equal(updated.statusCode, 200)
  assert.match(updated.body, /Highlands 2027/)

  const loaded = await app.inject({ method: 'GET', url: '/api/trips/current', headers: { authorization } })
  assert.equal(loaded.json().trip.title, 'Highlands 2027')
  await app.close()
})

test('a read-only grant does not expose mutating trip tools', async () => {
  const { app, authorization } = await fixture()
  const client = await registerClient(app)
  const grant = await authorize(app, authorization, client.client_id, 'trips:read')
  const tokens = await exchangeCode(app, client.client_id, grant.code, grant.verifier)
  const listed = await app.inject({
    method: 'POST', url: '/mcp',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  assert.equal(listed.statusCode, 200)
  assert.match(listed.body, /get_trip/)
  assert.doesNotMatch(listed.body, /update_trip/)
  await app.close()
})
