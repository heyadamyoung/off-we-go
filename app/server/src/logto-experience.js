import { createHash, randomBytes } from 'node:crypto'
import { safeExperienceError } from './auth-errors.js'

const newToken = () => randomBytes(32).toString('base64url')
const pkceChallenge = verifier => createHash('sha256').update(verifier).digest('base64url')

const allowedRequests = new Map([
  ['PUT ', 'experience'],
  ['POST verification/password', 'verification/password'],
  ['POST verification/verification-code', 'verification/verification-code'],
  ['POST verification/verification-code/verify', 'verification/verification-code/verify'],
  ['POST profile', 'profile'],
  ['POST identification', 'identification'],
  ['POST submit', 'submit'],
])

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie()
  const combined = response.headers.get('set-cookie')
  return combined ? [combined] : []
}

function mergeCookies(current, response) {
  const values = new Map(String(current || '').split(';').map(value => value.trim()).filter(Boolean)
    .map(value => [value.split('=', 1)[0], value]))
  for (const header of responseCookies(response)) {
    const pair = String(header).split(';', 1)[0]
    if (pair.includes('=')) values.set(pair.split('=', 1)[0], pair)
  }
  return [...values.values()].join('; ')
}

async function responseBody(response) {
  const text = await response.text()
  return { text, contentType: response.headers.get('content-type') || 'application/json' }
}

export function createLogtoExperienceService({ identityProvider, publicUrl, fetch: fetchFn = fetch,
  clock = () => new Date() }) {
  if (!identityProvider) return null
  const interactions = new Map()
  const redirectUri = `${publicUrl.replace(/\/$/, '')}/api/auth/oidc/callback`

  const get = handle => {
    const interaction = interactions.get(handle)
    if (!interaction || interaction.expiresAt <= clock()) {
      if (handle) interactions.delete(handle)
      return null
    }
    return interaction
  }

  const absoluteProviderUrl = (value, origin) => {
    const url = new URL(value, origin)
    if (url.origin !== origin) throw new Error('Logto returned an unsafe interaction redirect')
    return url
  }

  return {
    async start() {
      const state = newToken(), nonce = newToken(), codeVerifier = newToken()
      const authorizationUrl = await identityProvider.authorizationUrl({
        redirectUri, state, nonce, codeChallenge: pkceChallenge(codeVerifier),
      })
      const providerOrigin = new URL(authorizationUrl).origin
      const response = await fetchFn(authorizationUrl, { method: 'GET', redirect: 'manual' })
      const cookies = mergeCookies('', response)
      if (!cookies) throw new Error('Logto did not start an interaction')
      const handle = newToken()
      interactions.set(handle, {
        cookies, providerOrigin, state, nonce, codeVerifier,
        expiresAt: new Date(clock().getTime() + 15 * 60_000), event: null,
      })
      for (const [id, value] of interactions) if (value.expiresAt <= clock()) interactions.delete(id)
      return handle
    },

    event(handle) { return get(handle)?.event || null },

    async forward({ handle, method, path = '', body }) {
      const interaction = get(handle)
      if (!interaction) return { status: 401, body: JSON.stringify({ error: 'No active sign-in attempt' }) }
      const normalizedPath = String(path).replace(/^\/+|\/+$/g, '')
      if (!allowedRequests.has(`${method} ${normalizedPath}`)) {
        return { status: 404, body: JSON.stringify({ error: 'Unsupported sign-in operation' }) }
      }
      if (method === 'PUT' && normalizedPath === '') {
        const event = body?.interactionEvent
        if (!['SignIn', 'Register'].includes(event)) {
          return { status: 400, body: JSON.stringify({ error: 'Unsupported sign-in operation' }) }
        }
        interaction.event = event
      }
      const target = `${interaction.providerOrigin}/api/experience${normalizedPath ? `/${normalizedPath}` : ''}`
      const response = await fetchFn(target, {
        method, redirect: 'manual',
        headers: { cookie: interaction.cookies, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      interaction.cookies = mergeCookies(interaction.cookies, response)
      const result = await responseBody(response)
      if (!response.ok) {
        return {
          status: response.status,
          body: JSON.stringify(safeExperienceError(response.status, result.text, normalizedPath)),
          contentType: 'application/json',
        }
      }
      if (normalizedPath !== 'submit') {
        return { status: response.status, body: result.text, contentType: result.contentType }
      }

      let redirectTo = null
      try { redirectTo = JSON.parse(result.text).redirectTo }
      catch {}
      if (!redirectTo) return { status: 502, body: JSON.stringify({ error: 'Logto did not complete sign-in' }) }

      let next = absoluteProviderUrl(redirectTo, interaction.providerOrigin)
      for (let hop = 0; hop < 8; hop++) {
        const continued = await fetchFn(next, {
          method: 'GET', redirect: 'manual', headers: { cookie: interaction.cookies },
        })
        interaction.cookies = mergeCookies(interaction.cookies, continued)
        if (![301, 302, 303, 307, 308].includes(continued.status)) {
          return { status: 502, body: JSON.stringify({ error: 'Logto did not return an authorization code' }) }
        }
        const location = continued.headers.get('location')
        if (!location) return { status: 502, body: JSON.stringify({ error: 'Logto returned an invalid redirect' }) }
        const candidate = new URL(location, next)
        const callback = new URL(redirectUri)
        if (candidate.origin === callback.origin && candidate.pathname === callback.pathname) {
          const identity = await identityProvider.exchangeCallback({
            currentUrl: candidate.href, redirectUri, state: interaction.state,
            nonce: interaction.nonce, codeVerifier: interaction.codeVerifier,
          })
          interactions.delete(handle)
          return { status: 200, identity }
        }
        next = absoluteProviderUrl(candidate.href, interaction.providerOrigin)
      }
      return { status: 502, body: JSON.stringify({ error: 'Logto sign-in took too many redirects' }) }
    },
  }
}
