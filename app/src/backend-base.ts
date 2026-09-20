import { createApiClient } from './api-client-core'
import { sessionStorage } from './mobile'
import type { Id } from './shared/model/types'

/* The one API client and the path grammar every backend module shares. Split
   out so those modules can lean on it without leaning on each other. */
const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const hasBackend = Boolean(API_URL)
export const functionsUrl = hasBackend ? `${API_URL}/ingest` : null

/* Which generation of tiles to ask for.
 *
 * A tile is cached hard — an hour in the browser with a day of
 * stale-while-revalidate behind it — and that is the point of it. It is also
 * the reason a tile that was wrong could not be taken back: squares built
 * over ground that had not been ingested yet cached empty, and no amount of
 * fixing the server reaches into a phone that already holds the hole. A
 * traveller in the Highlands was looking at empty squares the server had been
 * answering correctly for an hour.
 *
 * So the generation is part of the URL. Bumping it is how a bad tile is
 * recalled from every browser and every edge at once, because the old URL is
 * simply never asked for again. Bump it only when tiles already out there are
 * wrong — a deploy on its own must not, or every release throws away an edge
 * cache that was doing its job.
 *
 *   1  the first tiled release
 *   2  the squares built over un-ingested ground, which cached empty for ever
 *      (see migration 045 for the server's half of the same recall) */
export const PLACE_TILES_EPOCH = 2

/* Where the map fetches its places from, as a tile template the map library
   expands itself. Null in the demo, which has no server and draws its own
   canned Amsterdam from a GeoJSON source instead.
   Relative when nothing named an API, because that is the same-origin case
   and a relative tile URL is one MapLibre resolves against the page. */
export const placeTilesUrl = hasBackend
  ? `${API_URL}/places/tiles/{z}/{x}/{y}?v=${PLACE_TILES_EPOCH}`
  : `/api/places/tiles/{z}/{x}/{y}?v=${PLACE_TILES_EPOCH}`

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
