const HUMAN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type AppRoute =
  | { name: 'home' }
  | { name: 'native-auth' }
  | { name: 'trip'; slug: string; legacy: boolean }
  | { name: 'user'; handle: string }

const pathValue = (pathname: string, prefix: string) => {
  const match = pathname.match(new RegExp(`^/${prefix}/([^/]+)/?$`))
  if (!match) return null
  let value
  try { value = decodeURIComponent(match[1]).toLowerCase() }
  catch { return null }
  return HUMAN_SLUG.test(value) ? value : null
}

export function parseAppRoute(pathname: string, search = ''): AppRoute {
  if (pathname === '/auth/native') return { name: 'native-auth' }
  const handle = pathValue(pathname, 'users')
  if (handle) return { name: 'user', handle }
  const slug = pathValue(pathname, 'trips')
  if (slug) return { name: 'trip', slug, legacy: false }
  const legacySlug = new URLSearchParams(search).get('t')?.toLowerCase() || ''
  if (HUMAN_SLUG.test(legacySlug)) return { name: 'trip', slug: legacySlug, legacy: true }
  return { name: 'home' }
}

export const tripHref = (slug: string) => `/trips/${encodeURIComponent(slug)}`
export const userHref = (handle: string) => `/users/${encodeURIComponent(handle)}`

export function absoluteTripHref(slug: string, currentOrigin: string, apiUrl = '') {
  let publicOrigin = currentOrigin
  if (apiUrl) {
    try {
      const endpoint = new URL(apiUrl, currentOrigin)
      if (endpoint.protocol === 'http:' || endpoint.protocol === 'https:') publicOrigin = endpoint.origin
    } catch {}
  }
  return publicOrigin.replace(/\/$/, '') + tripHref(slug)
}
