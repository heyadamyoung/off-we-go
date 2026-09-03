/* The assistant's credential: per question, per person, per role, minutes.

   The browser user asking a question is already authenticated; the codex
   process answering it is not. Rather than teach the agent OAuth, the
   assistant route mints a stateless HMAC token binding the agent to exactly
   that user for a few minutes, and the MCP endpoint honours it only from
   loopback — the agent lives in the same container as this server. There is
   no row to store and nothing to revoke: the token dies of old age before it
   could be carried anywhere it would also work.

   The token also carries the scopes the route decided the asker deserves —
   read-only for a viewer, read and write for an editor — so what the agent
   can do is settled where the asker's role is known, and the MCP endpoint
   only has to believe the signature. */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const AGENT_TOKEN_PREFIX = 'wf_agent_'
export const AGENT_TOKEN_TTL_MS = 10 * 60_000
const KNOWN_SCOPES = ['trips:read', 'trips:write']

export function signAgentToken(user, secret, now = new Date(), scopes = ['trips:read']) {
  const payload = Buffer.from(
    JSON.stringify({
      id: user.id,
      email: user.email || null,
      scopes,
      issuedAt: now.getTime(),
    }),
  ).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${AGENT_TOKEN_PREFIX}${payload}.${signature}`
}

/** The user and scopes the token stands for, or null for anything expired or reshaped. */
export function readAgentToken(token, secret, now = new Date()) {
  if (typeof token !== 'string' || !token.startsWith(AGENT_TOKEN_PREFIX)) return null
  const [payload, signature, extra] = token.slice(AGENT_TOKEN_PREFIX.length).split('.')
  if (!payload || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const left = Buffer.from(signature),
    right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!value.id || !Number.isFinite(value.issuedAt)) return null
    if (value.issuedAt > now.getTime() + 60_000) return null
    if (now.getTime() - value.issuedAt > AGENT_TOKEN_TTL_MS) return null
    const scopes = value.scopes
    if (
      !Array.isArray(scopes) ||
      !scopes.length ||
      !scopes.includes('trips:read') ||
      scopes.some(scope => !KNOWN_SCOPES.includes(scope))
    )
      return null
    return { user: { id: value.id, email: value.email || null }, scopes }
  } catch {
    return null
  }
}
