import { authClient, hasBackend, isSample } from '../../../backend'
import { EMPTY_PLACE_LIST, placeListFrom, type Place, type PlaceList } from '../../../places-core'
import { SAMPLE_ATTRIBUTION, samplePins } from '../../../sample-places-core'
import { validLngLat } from '../../../shared/lib/geo'
import type { ApiError, AttractionPoi, Coordinates, Id } from '../../../shared/model/types'

/* The three ways in to the places layer.

   Thin on purpose: the server owns the ranking, the widening and the coverage
   bookkeeping, and anything this file decided for itself would be a second
   opinion drifting away from the first. What it does own is the four ways the
   client has always had to be careful.

   Auth goes through the one API client, so a place search carries the bearer
   and clears the session on a 401 like everything else does.

   A 404 is not an error here. The places routes are new, and an app talking to
   a server deployed before them must degrade to "no matches" — which still
   leaves free-text stops working — rather than throw a red toast at somebody
   trying to type the name of their gran's house.

   The sample trip has no trip_id the server would recognise, and sending one
   would be a 400 on the demo everybody sees first. It searches without the
   trip bias instead, which is the honest degradation.

   And every call takes a signal, because the typeahead fires on a keystroke:
   without aborting the last one, a slow answer for "riks" lands after the fast
   one for "rijksmuseum" and the list flips back to the wrong results. */

/** Below this a search is noise — every café in the city matches one letter. */
export const MIN_QUERY = 2

/** Matches MAX_RADIUS_METRES in server/src/places/rank.js: past this the
    server widens no further, so asking for more is asking for a refusal. */
const MAX_RADIUS_METRES = 50000

const nothing = (): PlaceList => ({ ...EMPTY_PLACE_LIST })

/** A request the caller replaced, rather than a failure worth telling anybody
    about. Every caller here needs the distinction, so it is drawn once. */
export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError'
}

async function listOrNothing(path: string, signal?: AbortSignal): Promise<PlaceList> {
  try {
    return placeListFrom(await authClient.request<unknown>(path, { signal }))
  } catch (error) {
    if ((error as ApiError)?.status === 404) return nothing()
    throw error
  }
}

export interface PlaceSearchQuery {
  query: string
  /** where the traveller is looking, so the near ones come first */
  near?: Coordinates | null
  /** the trip being edited, so its own geography is preferred */
  tripId?: Id | null
  limit?: number
  signal?: AbortSignal
}

/** Prefix and trigram search, biased to the trip. An empty answer is an
    answer: it means nobody has mapped this by that name, not that the stop
    cannot be made. */
export async function searchPlaces({
  query,
  near,
  tripId,
  limit = 8,
  signal,
}: PlaceSearchQuery): Promise<PlaceList> {
  const wanted = String(query || '').trim()
  if (!hasBackend || wanted.length < MIN_QUERY) return nothing()
  const params = new URLSearchParams({ q: wanted })
  if (near && validLngLat(near[0], near[1])) {
    params.set('near', `${near[0].toFixed(5)},${near[1].toFixed(5)}`)
  }
  if (tripId && !isSample(tripId)) params.set('trip_id', String(tripId))
  params.set('limit', String(Math.min(Math.max(1, Math.round(limit)), 25)))
  return listOrNothing(`/places/search?${params}`, signal)
}

/** One record in full, with its provenance — for a stop that already names a
    place and wants to show what is behind it. */
export async function placeById(id: string, signal?: AbortSignal): Promise<Place | null> {
  if (!hasBackend || !id) return null
  try {
    const payload = await authClient.request<unknown>(`/places/${encodeURIComponent(id)}`, {
      signal,
    })
    return placeListFrom({ places: [payload] }).places[0] || null
  } catch (error) {
    if ((error as ApiError)?.status === 404) return null
    throw error
  }
}

export interface NearbyQuery {
  lat: number
  lng: number
  radius?: number
  /** one of the twenty, or nothing at all for everything worth going to */
  category?: string | null
  limit?: number
  signal?: AbortSignal
}

/** What is around a point. The server ranks and widens; this only asks. */
export async function nearbyPlaces({
  lat,
  lng,
  radius = 1500,
  category,
  limit = 30,
  signal,
}: NearbyQuery): Promise<PlaceList> {
  if (!hasBackend || !validLngLat(lng, lat)) return nothing()
  const params = new URLSearchParams({
    lat: lat.toFixed(5),
    lng: lng.toFixed(5),
    radius: String(Math.min(Math.max(50, Math.round(radius)), MAX_RADIUS_METRES)),
    limit: String(Math.min(Math.max(1, Math.round(limit)), 60)),
  })
  if (category) params.set('category', category)
  return listOrNothing(`/places/nearby?${params}`, signal)
}

/** Sights nearby, the successor to the Wikipedia walk in features/sights.

    Deliberately no category filter: `sights` is one of the twenty and the
    obvious thing to ask for, but the server's nearby ranking already weights
    sights highest and then museums, galleries and the rest — so filtering to
    the one category would throw away the Rijksmuseum to keep a bridge. The
    ranking is the shortlist; the filter is for somebody who asked for cafés. */
export async function sightsNearby(query: Omit<NearbyQuery, 'category'>): Promise<PlaceList> {
  return nearbyPlaces({ ...query, category: null })
}

/* Every pin on the map's screen, from the places layer.
 *
 * What this replaced held two countries. The `attractions` table was seeded by
 * walking Wikipedia's geosearch a region at a time, and only the Netherlands
 * and Scotland were ever walked; everywhere else the map asked Wikipedia live
 * from this device, ten kilometres at a time, two requests a second, and got
 * rate-limited for it. Somebody in Canada saw an empty map filling in slowly
 * or not at all.
 *
 * One query now, answered anywhere, from data the server holds. `headline` is
 * the zoomed-out view: the server decides what deserves a dot from orbit,
 * because that is a question about the data and it owns the data. */
export interface PlacePins {
  places: AttractionPoi[]
  attribution: { license: string; notice: string; url: string | null }[]
  /** the ground under this view has not been ingested yet; it is filling in */
  degraded: boolean
}

export async function loadPlacePins(
  box: { west: number; south: number; east: number; north: number },
  { headline = false, limit = 300 } = {},
  signal?: AbortSignal,
): Promise<PlacePins | null> {
  /* The demo has no server to ask, so it draws its own canned Amsterdam —
     the same shape, through the same code path, rather than the browser
     walking Wikipedia to fill a map nobody is really using. */
  if (!hasBackend) {
    return {
      places: samplePins(box, { headline, limit }),
      attribution: SAMPLE_ATTRIBUTION,
      degraded: false,
    }
  }
  const query = new URLSearchParams({
    west: String(box.west),
    south: String(box.south),
    east: String(box.east),
    north: String(box.north),
    headline: String(headline),
    limit: String(Math.min(limit, 1000)),
  })
  try {
    return await authClient.request<PlacePins>(`/places/in-view?${query}`, { signal })
  } catch (error) {
    /* A server from before this route existed, or one with no places half at
       all, says so rather than erroring the map. */
    const status = (error as ApiError).status
    if (status === 404 || status === 503) return null
    throw error
  }
}
