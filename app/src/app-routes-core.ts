/* Link building that has to work outside the router: a share link has to name
   the public origin, which inside the native app is not the origin the WebView
   is running on. */

export const tripHref = (slug: string) => `/trips/${encodeURIComponent(slug)}`
export const userHref = (handle: string) => `/users/${encodeURIComponent(handle)}`

function absoluteOrigin(currentOrigin: string, apiUrl = '') {
  let publicOrigin = currentOrigin
  if (apiUrl) {
    try {
      const endpoint = new URL(apiUrl, currentOrigin)
      if (endpoint.protocol === 'http:' || endpoint.protocol === 'https:')
        publicOrigin = endpoint.origin
    } catch {
      /* a relative API path leaves the current origin alone */
    }
  }
  return publicOrigin.replace(/\/$/, '')
}

export function absoluteTripHref(slug: string, currentOrigin: string, apiUrl = '') {
  return absoluteOrigin(currentOrigin, apiUrl) + tripHref(slug)
}

/* The pairing handshake: a QR code on the organiser's screen, scanned by the
   phone that will do the sharing. The payload rides in the URL fragment —
   fragments never reach server logs or proxies — and the universal link opens
   the native app directly on the phone. */
export interface PairPayload {
  endpoint: string
  token: string
  deviceId: string
  name: string
}

export function absolutePairHref(payload: PairPayload, currentOrigin: string, apiUrl = '') {
  const query = new URLSearchParams({
    e: payload.endpoint,
    t: payload.token,
    d: String(payload.deviceId),
    n: payload.name,
  })
  return `${absoluteOrigin(currentOrigin, apiUrl)}/pair#${query}`
}

export function parsePairHash(hash: string): PairPayload | null {
  const query = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  const endpoint = query.get('e') || ''
  const token = query.get('t') || ''
  const deviceId = query.get('d') || ''
  const name = query.get('n') || ''
  if (!endpoint || !token || !deviceId) return null
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  } catch {
    return null
  }
  return { endpoint, token, deviceId, name: name || 'This phone' }
}
