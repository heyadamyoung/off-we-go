/* The basemap itself, kept on the device, so a trip opened with no signal has
   streets under it rather than an empty ground colour.

   Everything the map draws — the tile index, the vector tiles, the glyphs —
   travels under our own URL scheme so that one handler sees all of it: online
   it fetches and keeps a copy, offline it answers from the copy. Only what has
   actually been looked at is held, which for a trip is the places the trip
   goes. OpenFreeMap's terms allow this; CARTO's did not, which is why the
   basemap moved. */

const CACHE_NAME = 'wayfare-basemap-v1'
/* A city at the zooms people read a trip at runs to a few hundred tiles. This
   leaves room for several, and past it the ones looked at longest ago go. */
const MAX_TILES = 4_000

/** Our scheme, so MapLibre hands these requests to us rather than the network. */
export const SCHEME = 'offwego'

export const protocolUrl = (url: string) => url.replace(/^https:\/\//, `${SCHEME}://`)
export const upstreamUrl = (url: string) => url.replace(new RegExp(`^${SCHEME}://`), 'https://')

/** The slice of the Cache API this needs; a Cache satisfies it as it stands. */
export interface TileStore {
  match(url: string): Promise<Response | undefined>
  put(url: string, response: Response): Promise<void>
  keys(): Promise<ReadonlyArray<{ url: string }>>
  delete(url: string): Promise<boolean>
}

/* A tile index names its tiles absolutely, so without this the tiles it points
   at would go straight to the network and never reach the cache. */
export function rewriteTileJson(document: unknown): unknown {
  if (!document || typeof document !== 'object') return document
  const bag = document as { tiles?: unknown }
  if (!Array.isArray(bag.tiles)) return document
  return {
    ...bag,
    tiles: bag.tiles.map(url => (typeof url === 'string' ? protocolUrl(url) : url)),
  }
}

/* Network first: a map that is being read online should be today's map, not
   whatever was here last time. The copy is what is left when the network is
   not there. */
export async function fetchTile(
  store: TileStore | null,
  fetchImpl: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<Response | null> {
  try {
    const response = await fetchImpl(url, signal ? { signal } : {})
    if (!response.ok) throw new Error(`Basemap answered ${response.status}`)
    if (store) {
      // put() consumes a body, so the caller keeps the original.
      await store.put(url, response.clone()).catch(() => {})
      /* Listing a cache is a scan of the whole thing, and this runs once per
         tile — so it sweeps on a count rather than on every write. */
      if (++sinceSweep >= SWEEP_EVERY) {
        sinceSweep = 0
        await prune(store)
      }
    }
    return response
  } catch (caught) {
    // A cancelled request is the map moving on, not a map that failed.
    if (signal?.aborted) throw caught
    const held = store ? await store.match(url).catch(() => undefined) : undefined
    return held ?? null
  }
}

let sinceSweep = 0
const SWEEP_EVERY = 200

export async function prune(store: TileStore, limit = MAX_TILES) {
  const held = await store.keys().catch(() => [])
  if (held.length <= limit) return
  for (const stale of held.slice(0, held.length - limit)) await store.delete(stale.url)
}

let opening: Promise<TileStore | null> | null = null

export function tileStore(): Promise<TileStore | null> {
  if (!opening) {
    opening = (async () => {
      try {
        if (typeof caches === 'undefined') return null
        return await caches.open(CACHE_NAME)
      } catch {
        return null
      }
    })()
  }
  return opening
}

/** How much of the map is on this device, for the settings screen to report. */
export async function offlineTileCount(): Promise<number> {
  const store = await tileStore()
  if (!store) return 0
  return (await store.keys().catch(() => [])).length
}

export async function forgetOfflineTiles(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME)
  } catch {
    /* nothing to forget */
  }
  opening = null
}
