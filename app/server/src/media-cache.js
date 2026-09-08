/* Making a signed media link something a cache in front of us can hold.

   The links were already the right shape for an edge: the grant is an HMAC and
   an expiry in the query string, so a cache can answer without a cookie, a
   session or a database. What stopped anything caching them was two smaller
   things, and both are here.

   The first is that every link was minted against the clock, so two people
   opening the same trip a second apart got two different URLs for the same
   bytes. A cache keys on the URL, so that is a guaranteed miss every time —
   a hit rate of zero, dressed up as caching. Rounding the expiry to a window
   fixes it: everyone who asks within the same window gets a byte-identical
   URL, and the bytes behind it are fetched from us once instead of once per
   reader.

   The second is that every response said `private`, which is the header that
   tells a shared cache not to store it at all. That was the safe default
   before the links were deterministic; it is simply wrong now, because the
   signature in the URL is the authorisation and a cache that does not have
   the URL cannot construct it.

   Nothing here knows about HTTP or storage. It is arithmetic and a string. */

/* How long a cached copy may live. Deliberately not the life of the link.

   A signed link lives a day so that an app left open keeps drawing. A cached
   copy living a day would mean a photograph somebody deleted going on being
   served by an edge for the rest of that day, and deletion here is a promise
   rather than a convenience. An hour is what the browser already held, so
   this makes those bytes shareable without making them longer-lived. */
export const DEFAULT_CACHE_SECONDS = 60 * 60

/* How wide the window in which everybody gets the same URL. An hour, matching
   the cache lifetime: a longer window would raise the hit rate and blunt the
   expiry, a shorter one sharpens the expiry and splits the cache. */
export const DEFAULT_BUCKET_SECONDS = 60 * 60

/**
 * When a link minted now should stop working, rounded to a shared boundary.
 *
 * The rounding is up, never down, so bucketing can only ever lengthen a
 * link's life — never hand somebody a URL that expires sooner than the life
 * it was promised.
 *
 * @param {number} nowSeconds unix seconds
 * @param {number} ttlSeconds how long the link is meant to last
 * @param {number} bucketSeconds the window; 0 or 1 mints against the clock
 */
export function linkExpiry(nowSeconds, ttlSeconds, bucketSeconds = DEFAULT_BUCKET_SECONDS) {
  const at = Math.floor(nowSeconds) + Math.floor(ttlSeconds)
  const bucket = Math.floor(bucketSeconds)
  if (!(bucket > 1)) return at
  return Math.ceil(at / bucket) * bucket
}

/* What kind of thing lives at a path, as far as caching is concerned.

   `immutable` is a claim about the path, not the file: everything a trip
   stores is named with a fresh identifier, a converted film gets a new path
   rather than overwriting the old one, and a stream is written into its own
   directory. Nothing that already exists is ever rewritten in place.

   Except an avatar, which is deliberately stored at a stable path so that
   replacing it does not leave the old face on the volume as unreferenced
   personal data. That makes it the one mutable thing here, and marking it
   immutable would leave a changed profile picture stale in every cache that
   had seen the old one. */
export function mediaKindFor(storagePath) {
  const path = String(storagePath || '')
  if (path.startsWith('profiles/')) return 'mutable'
  if (path.endsWith('.m3u8')) return 'playlist'
  return 'immutable'
}

/** How long a changed avatar may go on being the old one. */
const MUTABLE_SECONDS = 5 * 60

/**
 * The cache-control for one media response.
 *
 * @param {object} options
 * @param {string} options.storagePath what is being served
 * @param {number} options.expires when this link stops working, unix seconds
 * @param {number} options.now unix seconds
 * @param {number} [options.maxSeconds] the ceiling on a cached copy's life
 * @param {number} [options.bucketSeconds] the window links are minted in
 */
export function mediaCacheControl({
  storagePath,
  expires,
  now,
  maxSeconds = DEFAULT_CACHE_SECONDS,
  bucketSeconds = DEFAULT_BUCKET_SECONDS,
}) {
  const kind = mediaKindFor(storagePath)
  /* Never past the link's own expiry. A cached copy that outlived its
     signature would be an edge quietly extending a grant we had already
     decided should end. */
  const left = Math.max(0, Math.floor(expires) - Math.floor(now))

  if (kind === 'mutable') {
    // One reader's own browser only: this path's bytes change under it.
    return `private, max-age=${Math.min(MUTABLE_SECONDS, left)}`
  }

  if (kind === 'playlist') {
    /* A playlist is only identical between readers for as long as the links
       inside it are, which is one bucket. Past that its body differs and a
       shared copy would hand somebody another reader's signatures — still
       links to the same film they can already read, but not ones we minted
       for them, and not ones that expire when we said they would. */
    const shareable = Math.min(left, maxSeconds, Math.floor(bucketSeconds))
    return shareable > 1 ? `public, max-age=${shareable}` : 'private, no-store'
  }

  const age = Math.min(left, maxSeconds)
  /* `immutable` is what stops a browser revalidating on every reload of a
     photograph that cannot have changed — the request it saves is the whole
     point on a phone with a bad connection. */
  return age > 0 ? `public, max-age=${age}, immutable` : 'private, max-age=0, must-revalidate'
}
