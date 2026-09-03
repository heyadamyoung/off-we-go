import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildServer } from '../src/app.js'
import { createSecretBox } from '../src/secret-box.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const KEY = randomBytes(32).toString('base64')

/* A stand-in for Microsoft: it answers the token endpoint and /me, so the
   exchange can be checked without an Azure tenant. */
function fakeMicrosoft(accounts = [{ id: 'ms-1', mail: 'adam@outlook.com', displayName: 'Adam' }]) {
  const calls = []
  let next = 0
  return {
    calls,
    async fetch(url, options = {}) {
      calls.push({ url: String(url), body: options.body ? String(options.body) : null })
      if (String(url).includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'access-' + next,
            refresh_token: 'refresh-' + next,
            expires_in: 3600,
            scope: 'offline_access Mail.Read User.Read',
          }),
        }
      }
      return { ok: true, json: async () => accounts[Math.min(next++, accounts.length - 1)] }
    },
  }
}

async function server(accounts) {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const microsoft = fakeMicrosoft(accounts)
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    microsoft: { clientId: 'client-abc', clientSecret: 'shhh', tenant: 'consumers' },
    mailboxTokenKey: KEY,
    connectorFetch: microsoft.fetch,
  })
  return { app, repository, microsoft }
}

async function connect(app) {
  const started = await app.inject({
    method: 'POST',
    url: '/api/connectors/outlook/start',
    headers: { authorization: SESSION.value },
  })
  const state = new URL(started.json().authorizeUrl).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: '/api/connectors/outlook/callback?code=code-1&state=' + encodeURIComponent(state),
  })
  return { started, callback }
}

const SESSION = { value: '' }
const listConnections = (app, session) =>
  app
    .inject({
      method: 'GET',
      url: '/api/connectors',
      headers: { authorization: session },
    })
    .then(reply => reply.json())

test('connecting a mailbox sends you to Microsoft and brings back a usable connection', async () => {
  const { app, repository } = await server()
  SESSION.value = await authenticate(repository, 'owner@example.com')

  const { started, callback } = await connect(app)
  const link = new URL(started.json().authorizeUrl)

  assert.equal(link.origin, 'https://login.microsoftonline.com', 'the consent screen is Microsofts')
  assert.equal(
    link.searchParams.get('redirect_uri'),
    'https://offwego.example.com/api/connectors/outlook/callback',
  )
  /* No forced account picker on a first connection: Microsoft's /common
     endpoint misroutes fresh-session personal accounts when select_account is
     sent, so the first sign-in lets HRD route the typed identity naturally. */
  assert.equal(link.searchParams.get('prompt'), null)
  assert.ok(link.searchParams.get('code_challenge'), 'PKCE, because the code alone is not enough')

  assert.equal(callback.statusCode, 302)
  assert.match(callback.headers.location, /\/profile\?tab=connections&connected=yes$/)

  const listed = await listConnections(app, SESSION.value)
  assert.equal(listed.configured, true)
  assert.equal(listed.connections.length, 1)
  assert.equal(listed.connections[0].email, 'adam@outlook.com')
  assert.equal(listed.connections[0].needsReconnect, false)
})

test('a second mailbox gets the account picker; the first never does', async () => {
  const { app, repository } = await server()
  SESSION.value = await authenticate(repository, 'owner@example.com')

  /* Without the picker, Microsoft silently reconnects the first account — and
     by the second connection a Microsoft session exists, which is the one
     condition under which select_account routes personal accounts correctly. */
  await connect(app)
  const { started } = await connect(app)
  const link = new URL(started.json().authorizeUrl)
  assert.equal(link.searchParams.get('prompt'), 'select_account')
})

/* The screen shows which mailbox is connected; it must never show what opens
   it. The tokens are sealed at rest and stay on the server. */
test('the tokens are sealed in storage and never reach the browser', async () => {
  const { app, repository } = await server()
  SESSION.value = await authenticate(repository, 'owner@example.com')
  const user = await repository.ensureUser('owner@example.com')
  await connect(app)

  const listed = await listConnections(app, SESSION.value)
  const asJson = JSON.stringify(listed)
  assert.equal(asJson.includes('access-'), false, 'an access token reached the browser')
  assert.equal(asJson.includes('refresh-'), false, 'a refresh token reached the browser')

  const [stored] = await repository.listMailboxConnections(user.id)
  assert.notEqual(stored.refreshToken, 'refresh-0', 'the refresh token is stored in the clear')
  assert.equal(createSecretBox(KEY).open(stored.refreshToken), 'refresh-0', 'and reads back')
})

test('a second mailbox is a second connection, not a replacement', async () => {
  const { app, repository } = await server([
    { id: 'ms-1', mail: 'adam@outlook.com', displayName: 'Adam' },
    { id: 'ms-2', mail: 'catherine@outlook.com', displayName: 'Catherine' },
  ])
  SESSION.value = await authenticate(repository, 'owner@example.com')

  await connect(app)
  await connect(app)

  const listed = await listConnections(app, SESSION.value)
  assert.deepEqual(
    listed.connections.map(item => item.email),
    ['adam@outlook.com', 'catherine@outlook.com'],
  )
})

test('a callback nobody asked for is refused', async () => {
  const { app, repository } = await server()
  SESSION.value = await authenticate(repository, 'owner@example.com')

  const forged = await app.inject({
    method: 'GET',
    url: '/api/connectors/outlook/callback?code=code-1&state=made-up',
  })
  assert.equal(forged.statusCode, 302)
  assert.match(forged.headers.location, /connected=expired$/)

  const denied = await app.inject({
    method: 'GET',
    url: '/api/connectors/outlook/callback?error=access_denied&state=whatever',
  })
  assert.match(denied.headers.location, /connected=denied$/)
})

test('a mailbox can be disconnected, and not by somebody else', async () => {
  const { app, repository } = await server()
  SESSION.value = await authenticate(repository, 'owner@example.com')
  await connect(app)
  const [connection] = (await listConnections(app, SESSION.value)).connections

  const stranger = await authenticate(repository, 'stranger@example.com')
  const refused = await app.inject({
    method: 'DELETE',
    url: '/api/connectors/' + connection.id,
    headers: { authorization: stranger },
  })
  assert.equal(refused.statusCode, 404, 'somebody elses mailbox is not theirs to disconnect')

  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/connectors/' + connection.id,
    headers: { authorization: SESSION.value },
  })
  assert.equal(removed.statusCode, 204)
  assert.deepEqual((await listConnections(app, SESSION.value)).connections, [])
})

/* With no Azure application configured the screen should offer nothing, rather
   than send somebody to a sign-in that cannot work. */
test('a server with no connector configured says so instead of half-offering one', async () => {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const session = await authenticate(repository, 'owner@example.com')

  const listed = await listConnections(app, session)
  assert.equal(listed.configured, false)
  assert.deepEqual(listed.providers, [])

  const started = await app.inject({
    method: 'POST',
    url: '/api/connectors/outlook/start',
    headers: { authorization: session },
  })
  assert.equal(started.statusCode, 503)
})

test('connecting a mailbox requires being signed in to us first', async () => {
  const { app } = await server()
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/connectors/outlook/start' })).statusCode,
    401,
  )
  assert.equal((await app.inject({ method: 'GET', url: '/api/connectors' })).statusCode, 401)
})
