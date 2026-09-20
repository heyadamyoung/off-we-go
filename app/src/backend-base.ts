import { createApiClient } from './api-client-core'
import { sessionStorage } from './mobile'
import type { Id } from './shared/model/types'

/* The one API client and the path grammar every backend module shares. Split
   out so those modules can lean on it without leaning on each other. */
const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const hasBackend = Boolean(API_URL)
export const functionsUrl = hasBackend ? `${API_URL}/ingest` : null

/* Where the map fetches its places from, as a tile template the map library
   expands itself. Null in the demo, which has no server and draws its own
   canned Amsterdam from a GeoJSON source instead.
   Relative when nothing named an API, because that is the same-origin case
   and a relative tile URL is one MapLibre resolves against the page. */
export const placeTilesUrl = hasBackend
  ? `${API_URL}/places/tiles/{z}/{x}/{y}`
  : '/api/places/tiles/{z}/{x}/{y}'

export const authClient = createApiClient({
  baseUrl: API_URL || '/api',
  storage: sessionStorage,
  /* Lazily, never bound at import time: this module loads before telemetry
     starts, and a pre-bound fetch escapes Faro's tracing patch — which
     silently costs every API call its browser span AND its traceparent, the
     whole cross-tier correlation. */
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
})

export const isSample = (tripId: Id) => tripId === 'sample' || !hasBackend
export const tripPath = (tripId: Id) => `/trips/${encodeURIComponent(tripId)}`
