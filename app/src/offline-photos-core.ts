/* The photographs themselves, kept as bytes, so a trip opened with no signal
   is not a page of grey rectangles where the pictures were.

   Only what has actually been looked at is kept — eagerly downloading every
   photograph in a trip would spend a traveller's data to guess at what they
   might want. And only our own media: third-party pictures a stop was
   enriched with are somebody else's bytes to serve. */

const CACHE_NAME = 'wayfare-photos-v1'
/* Roughly a large trip's worth of thumbnails. Past this the oldest go, which
   with insertion-ordered keys means the ones looked at longest ago. */
const MAX_PHOTOS = 200
/* A full-size original is not what makes a trip readable offline, and it is
   the strip and the cards that people scroll. */
const MAX_PHOTO_BYTES = 2_000_000

/** The slice of the Cache API this needs; a Cache satisfies it as it stands. */
export interface PhotoStore {
  match(url: string): Promise<Response | undefined>
  put(url: string, response: Response): Promise<void>
  keys(): Promise<ReadonlyArray<{ url: string }>>
  delete(url: string): Promise<boolean>
}

/** Our own media, which is signed, private, and ours to keep a copy of. */
export const isOwnPhoto = (url: string) => url.includes('/api/media/')

/* Media links are signed and expire within the hour, so the same photograph
   arrives under a different URL on every load. Keyed on the whole URL nothing
   would ever be found again: each reload would re-download every picture and
   evict the copies made under the old keys — leaving the cache empty of
   exactly the photographs it was filled with. The path is the photograph. */
export const photoKey = (url: string) => {
  try {
    return new URL(url, 'https://offwego.invalid').pathname
  } catch {
    return url.split('?')[0] ?? url
  }
}

export async function keepPhoto(
  store: PhotoStore,
  url: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (!isOwnPhoto(url)) return false
  const key = photoKey(url)
  try {
    // Already held: no second copy, and no second request for it either.
    if (await store.match(key)) return false
    const response = await fetchImpl(url)
    if (!response.ok) return false
    /* content-length is absent on a chunked or compressed response, and
       Number(null) is 0 — which passed the cap rather than failing it. Measure
       the bytes we actually hold. */
    const bytes = await response.clone().blob()
    if (bytes.size > MAX_PHOTO_BYTES) return false
    await store.put(key, response)
    await prune(store)
    return true
  } catch {
    // Offline, or a browser that will not keep anything: the picture still
    // rendered, we simply have no copy of it.
    return false
  }
}

async function prune(store: PhotoStore) {
  const held = await store.keys()
  if (held.length <= MAX_PHOTOS) return
  for (const stale of held.slice(0, held.length - MAX_PHOTOS)) await store.delete(stale.url)
}

export async function recallPhoto(store: PhotoStore, url: string): Promise<Blob | null> {
  try {
    const held = await store.match(photoKey(url))
    return held ? await held.blob() : null
  } catch {
    return null
  }
}

let opening: Promise<PhotoStore | null> | null = null

/* One cache, opened once. Absent in a page served without a secure context and
   in some webviews, in which case the feature is simply not there. */
export function photoStore(): Promise<PhotoStore | null> {
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

export async function keepPhotoOffline(url: string): Promise<void> {
  const store = await photoStore()
  if (store) await keepPhoto(store, url, globalThis.fetch.bind(globalThis))
}

/** A blob: URL for a photograph we already hold, or null. Revoke it when done. */
export async function recallPhotoUrl(url: string): Promise<string | null> {
  const store = await photoStore()
  if (!store) return null
  const blob = await recallPhoto(store, url)
  return blob ? URL.createObjectURL(blob) : null
}
