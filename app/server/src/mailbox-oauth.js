/* Connecting a mailbox: the parts that are ours rather than Microsoft's.

   This is the opposite direction to the MCP OAuth in this codebase. There we
   are the authorization server and a client asks us for a trip; here we are the
   client, asking Microsoft for a mailbox, on behalf of somebody who is already
   signed in to us. The user is the same person on both sides of that, which is
   exactly the confusion worth keeping the two files apart to avoid. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const base64url = value => Buffer.from(value).toString('base64url')

/** PKCE, because a public client's authorization code is worth nothing alone. */
export function createVerifier(random = randomBytes) {
  return base64url(random(32))
}

export function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

/* The state we hand Microsoft and check on the way back: proof the callback
   belongs to a request we made, for the person we made it for. */
export function createState(random = randomBytes) {
  return base64url(random(24))
}

export const stateHash = value => createHash('sha256').update(String(value)).digest('hex')

export function sameState(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

/* Read-only to begin with, deliberately. Sending mail is a scope people think
   twice about, and asking for it before anything uses it is how a connector
   gets refused at the consent screen. Adding it later re-prompts, which is the
   honest moment to ask. */
export const DEFAULT_SCOPES = ['offline_access', 'openid', 'email', 'User.Read', 'Mail.Read']

export function authorizeUrl({ clientId, tenant = 'common', redirectUri, state, challenge, scopes = DEFAULT_SCOPES, prompt }) {
  if (!clientId) throw new Error('No Microsoft client id is configured')
  if (!redirectUri) throw new Error('No redirect URI for the mailbox connector')
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  // A second mailbox on the same browser session lands straight back on the
  // first one unless Microsoft is asked to offer the account picker.
  if (prompt) query.set('prompt', prompt)
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${query}`
}

export const tokenUrl = (tenant = 'common') =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`

export function tokenRequestBody({ clientId, clientSecret, code, redirectUri, verifier, refreshToken }) {
  const body = new URLSearchParams({ client_id: clientId })
  if (clientSecret) body.set('client_secret', clientSecret)
  if (refreshToken) {
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', refreshToken)
  } else {
    body.set('grant_type', 'authorization_code')
    body.set('code', code)
    body.set('redirect_uri', redirectUri)
    body.set('code_verifier', verifier)
  }
  return body
}

/** When to refresh: a minute early, so a request never races the expiry. */
export function expiresAt(response, now = new Date()) {
  const seconds = Number(response?.expires_in)
  const life = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600
  return new Date(now.getTime() + Math.max(0, life - 60) * 1000)
}

export const isExpired = (connection, now = new Date()) =>
  !connection?.expiresAt || new Date(connection.expiresAt).getTime() <= now.getTime()
