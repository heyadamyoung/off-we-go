/* Link building that has to work outside the router: a share link has to name
   the public origin, which inside the native app is not the origin the WebView
   is running on. */

export const tripHref = (slug: string) => `/trips/${encodeURIComponent(slug)}`
export const userHref = (handle: string) => `/users/${encodeURIComponent(handle)}`

export function absoluteTripHref(slug: string, currentOrigin: string, apiUrl = '') {
  let publicOrigin = currentOrigin
  if (apiUrl) {
    try {
      const endpoint = new URL(apiUrl, currentOrigin)
      if (endpoint.protocol === 'http:' || endpoint.protocol === 'https:') publicOrigin = endpoint.origin
    } catch { /* a relative API path leaves the current origin alone */ }
  }
  return publicOrigin.replace(/\/$/, '') + tripHref(slug)
}
