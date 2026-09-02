import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SCOPES, authorizeUrl, challengeFor, createState, createVerifier, expiresAt,
  isExpired, sameState, stateHash, tokenRequestBody, tokenUrl,
} from '../server/src/mailbox-oauth.js'

const url = (over = {}) => new URL(authorizeUrl({
  clientId: 'client-abc', redirectUri: 'https://offwego.to/api/connectors/outlook/callback',
  state: 'state-1', challenge: 'challenge-1', ...over,
}))

test('the authorize URL asks Microsoft for exactly what we need', () => {
  const link = url()
  assert.equal(link.origin, 'https://login.microsoftonline.com')
  assert.equal(link.pathname, '/common/oauth2/v2.0/authorize')
  assert.equal(link.searchParams.get('client_id'), 'client-abc')
  assert.equal(link.searchParams.get('response_type'), 'code')
  assert.equal(link.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(link.searchParams.get('code_challenge'), 'challenge-1')
  assert.equal(link.searchParams.get('state'), 'state-1')
})

/* Read-only to start with: asking to send mail before anything sends mail is
   how a connector gets refused at the consent screen. */
test('it asks to read, and to keep working tomorrow, and nothing else', () => {
  const scopes = url().searchParams.get('scope').split(' ')
  assert.ok(scopes.includes('Mail.Read'))
  assert.ok(scopes.includes('offline_access'), 'without this it stops working in an hour')
  assert.ok(!scopes.includes('Mail.Send'), 'nothing sends mail yet, so nothing asks to')
  assert.deepEqual(scopes, DEFAULT_SCOPES)
})

test('a second mailbox is offered the account picker rather than the first one again', () => {
  assert.equal(url().searchParams.get('prompt'), null)
  assert.equal(url({ prompt: 'select_account' }).searchParams.get('prompt'), 'select_account')
})

test('a tenant of its own is honoured, and escaped', () => {
  assert.match(authorizeUrl({
    clientId: 'c', redirectUri: 'https://x/y', state: 's', challenge: 'ch', tenant: 'contoso.onmicrosoft.com',
  }), /\/contoso\.onmicrosoft\.com\/oauth2/)
  assert.match(tokenUrl('contoso.onmicrosoft.com'), /\/contoso\.onmicrosoft\.com\/oauth2\/v2\.0\/token$/)
})

test('a connector with nothing configured says so rather than sending someone nowhere', () => {
  assert.throws(() => authorizeUrl({ redirectUri: 'https://x/y', state: 's', challenge: 'c' }),
    /client id/)
  assert.throws(() => authorizeUrl({ clientId: 'c', state: 's', challenge: 'c' }), /redirect URI/)
})

test('PKCE: the challenge is the hash of the verifier, and both are fresh', () => {
  const verifier = createVerifier()
  assert.ok(verifier.length >= 40, 'a short verifier is a guessable one')
  assert.equal(challengeFor(verifier), challengeFor(verifier))
  assert.notEqual(challengeFor(verifier), challengeFor(createVerifier()))
  assert.notEqual(createState(), createState())
})

test('the state coming back is compared without leaking how much of it matched', () => {
  const state = createState()
  assert.equal(sameState(state, state), true)
  assert.equal(sameState(state, createState()), false)
  assert.equal(sameState(state, `${state}x`), false)
  assert.equal(sameState(state, ''), false)
  assert.equal(sameState(undefined, undefined), true)
  assert.equal(stateHash(state), stateHash(state))
  assert.notEqual(stateHash(state), state, 'the stored copy is not the one on the wire')
})

test('the code exchange and the refresh are the same call with different grants', () => {
  const exchange = tokenRequestBody({
    clientId: 'c', clientSecret: 's', code: 'code-1',
    redirectUri: 'https://x/y', verifier: 'verifier-1',
  })
  assert.equal(exchange.get('grant_type'), 'authorization_code')
  assert.equal(exchange.get('code_verifier'), 'verifier-1')
  assert.equal(exchange.get('client_secret'), 's')

  const refresh = tokenRequestBody({ clientId: 'c', clientSecret: 's', refreshToken: 'refresh-1' })
  assert.equal(refresh.get('grant_type'), 'refresh_token')
  assert.equal(refresh.get('refresh_token'), 'refresh-1')
  assert.equal(refresh.get('code'), null, 'a refresh has no code to send')
})

test('a token is treated as expiring a minute before it does', () => {
  const now = new Date('2026-09-02T12:00:00Z')
  assert.equal(expiresAt({ expires_in: 3600 }, now).toISOString(), '2026-09-02T12:59:00.000Z')
  assert.equal(expiresAt({}, now).toISOString(), '2026-09-02T12:59:00.000Z', 'a missing life is an hour')
  assert.equal(expiresAt({ expires_in: 30 }, now).toISOString(), '2026-09-02T12:00:00.000Z')

  assert.equal(isExpired({ expiresAt: '2026-09-02T12:30:00Z' }, now), false)
  assert.equal(isExpired({ expiresAt: '2026-09-02T11:30:00Z' }, now), true)
  assert.equal(isExpired({}, now), true, 'not knowing when it expires means refreshing it')
})
