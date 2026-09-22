/* Finding a release, and finding it again a month later.
 *
 * Neither source publishes an address that keeps. Overture holds two releases
 * on S3 at a time and deletes the older one about sixty days in; Foursquare
 * dates its own the same way. So the version written into
 * `place_coverage.versions` is a record of what we ingested, never a URL that
 * can be dialled again — and the two things that will dial it again are
 * exactly the two that must not fail: the planet run that resumes on Tuesday
 * after dying on Monday, and the fallback query that reaches for a cached
 * index on a cell nobody has ingested yet. Both of those hitting 404 is how
 * a whole afternoon disappears into "but it worked last month".
 *
 * So there is no constant here holding a release URL. Every path into the
 * data starts by listing the bucket, and `discoverRelease` takes the version
 * we think we are on and answers with the version that actually exists,
 * saying `expired` and a sentence in `notice` when those differ. A caller
 * that ignores the notice still gets working URLs; a caller that logs it —
 * and the CLI does — tells the operator the pin moved before the numbers do.
 *
 * On parsing the listing: it is XML, and it is read one <Contents> block at a
 * time rather than by sweeping two regexes across the document. The sweep is
 * what we wrote first and it worked until a release carried an object with no
 * <Size>, at which point every key married the size of the object after it,
 * the index recorded a 630 MB part as 700 MB, and range requests off the end
 * of the file came back as 416s an hour into a planet run. Key and size are
 * read from the same block or the block is skipped.
 *
 * Nothing here holds a connection or a clock: `fetch` is injectable so the
 * tests can state a bucket's contents exactly and never touch S3.
 */

import { buildIndex } from './parquet.js'

/** The two buckets. Public, unsigned, and listed anonymously. */
export const OVERTURE_BUCKET = 'https://overturemaps-us-west-2.s3.amazonaws.com/'
export const FSQ_BUCKET = 'https://fsq-os-places-us-east-1.s3.amazonaws.com/'

/** Where each source's dated releases sit, and how to get from a release to
    its parquet parts. Stated as data so a third source is a new entry rather
    than a new branch in five functions. */
export const SOURCES = Object.freeze({
  overture: {
    bucket: OVERTURE_BUCKET,
    /* release/2026-08-19.0/ */
    releasePrefix: 'release/',
    version: prefix => prefix.slice('release/'.length).replace(/\/$/, ''),
    /* One theme, one type; the sixteen parts live directly under it. */
    partsPrefix: version => `release/${version}/theme=places/type=place/`,
  },
  fsq: {
    bucket: FSQ_BUCKET,
    /* release/dt=2025-06-10/ — Foursquare keeps the Hive-style partition name. */
    releasePrefix: 'release/',
    version: prefix => prefix.slice('release/'.length).replace(/\/$/, '').replace(/^dt=/, ''),
    partsPrefix: version => `release/dt=${version}/places/parquet/`,
  },
})

/** S3 caps a listing page at a thousand keys however many you ask for; a
    release of sixteen parts needs one page and the guard is for the day
    somebody points this at a prefix with a million objects under it. */
const MAX_PAGES = 50

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** XML text as text. S3 escapes `&` in keys and nothing else we meet, but a
    key that arrives half-decoded is a 404 that looks like an expiry. */
const decode = value =>
  String(value ?? '').replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_whole, name) =>
    name.startsWith('#') ? String.fromCodePoint(Number(name.slice(1))) : ENTITIES[name],
  )

const tag = (block, name) => {
  const found = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return found ? decode(found[1]) : null
}

/** Every `<X>...</X>` block in the document, as strings. */
const blocks = (xml, name) => {
  const out = []
  const pattern = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g')
  let found = pattern.exec(xml)
  while (found) {
    out.push(found[1])
    found = pattern.exec(xml)
  }
  return out
}

/**
 * One page of a ListObjectsV2 response.
 *
 * Objects missing a key or a size are dropped rather than guessed at: a part
 * whose length we do not know cannot be range-read, and pretending otherwise
 * is the bug in the header comment.
 *
 * @param {string} xml
 * @returns {{objects: Array<{key: string, size: number, lastModified: string|null}>,
 *            prefixes: string[], truncated: boolean, next: string|null, name: string|null}}
 */
export function parseListing(xml) {
  const text = String(xml ?? '')
  const objects = []
  for (const block of blocks(text, 'Contents')) {
    const key = tag(block, 'Key')
    /* `Number(null)` is 0, not NaN, so an absent <Size> has to be tested for
       before it is converted — otherwise a part with no size becomes a part
       of length zero, which is a different wrong answer from the one in the
       header comment and just as hard to see. */
    const declared = tag(block, 'Size')
    const size = declared === null ? Number.NaN : Number(declared)
    if (!key || !Number.isFinite(size)) continue
    objects.push({ key, size, lastModified: tag(block, 'LastModified') })
  }
  const prefixes = []
  for (const block of blocks(text, 'CommonPrefixes')) {
    const prefix = tag(block, 'Prefix')
    if (prefix) prefixes.push(prefix)
  }
  return {
    objects,
    prefixes,
    truncated: tag(text, 'IsTruncated') === 'true',
    next: tag(text, 'NextContinuationToken'),
    name: tag(text, 'Name'),
  }
}

/** A bucket key as a URL. Each segment is encoded separately so the slashes
    survive and the `=` in `theme=places` is spelled the way S3 signs it. */
export const objectUrl = (bucket, key) =>
  bucket + String(key).split('/').map(encodeURIComponent).join('/')

/**
 * Every object and common prefix under `prefix`, following continuation
 * tokens.
 *
 * @param {string} bucket
 * @param {object} [options]
 * @param {string} [options.prefix]
 * @param {string} [options.delimiter] '/' to get folders back as prefixes
 * @param {typeof fetch} [options.fetch]
 */
export async function listObjects(
  bucket,
  { prefix = '', delimiter = '', fetch: fetchImpl = globalThis.fetch } = {},
) {
  const objects = []
  const prefixes = []
  let token = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' })
    if (delimiter) query.set('delimiter', delimiter)
    if (token) query.set('continuation-token', token)
    const response = await fetchImpl(`${bucket}?${query}`)
    if (!response.ok) {
      throw new Error(`${bucket} answered ${response.status} to a listing of ${prefix || '/'}`)
    }
    const listed = parseListing(await response.text())
    objects.push(...listed.objects)
    prefixes.push(...listed.prefixes)
    if (!listed.truncated || !listed.next) return { objects, prefixes }
    token = listed.next
  }
  return { objects, prefixes }
}

const VERSION = /^(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?$/

/** A dated version as something sortable. Lexicographic order is right for
    the dates and wrong for the revision — 2026-08-19.10 is newer than .2 and
    sorts before it — so the revision is compared as a number. */
export function versionOrder(version) {
  const found = VERSION.exec(String(version ?? ''))
  if (!found) return null
  const [, year, month, day, revision] = found
  return Number(year) * 1e7 + Number(month) * 1e5 + Number(day) * 1e3 + Number(revision ?? 0)
}

/** Newest first. Anything that is not a dated version is left out rather than
    sorted arbitrarily: the bucket also holds LICENSE.txt and friends. */
export const newestFirst = versions =>
  versions
    .filter(version => versionOrder(version) !== null)
    .sort((a, b) => versionOrder(b) - versionOrder(a))

/**
 * The releases a source is currently publishing, newest first.
 *
 * @param {'overture'|'fsq'} source
 * @param {{fetch?: typeof fetch}} [options]
 * @returns {Promise<string[]>}
 */
export async function listReleases(source, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const config = SOURCES[source]
  if (!config) throw new Error(`places: no such source "${source}"`)
  const { prefixes } = await listObjects(config.bucket, {
    prefix: config.releasePrefix,
    delimiter: '/',
    fetch: fetchImpl,
  })
  return newestFirst(prefixes.map(prefix => config.version(prefix)))
}

/**
 * The parquet parts of one release, in key order so two runs index the same
 * release identically.
 *
 * @returns {Promise<Array<{url: string, size: number, key: string}>>}
 */
export async function listParts(source, version, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const config = SOURCES[source]
  if (!config) throw new Error(`places: no such source "${source}"`)
  const { objects } = await listObjects(config.bucket, {
    prefix: config.partsPrefix(version),
    fetch: fetchImpl,
  })
  return objects
    .filter(object => object.key.endsWith('.parquet') && object.size > 0)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(object => ({
      url: objectUrl(config.bucket, object.key),
      size: object.size,
      key: object.key,
    }))
}

/**
 * The release to read, discovered now rather than remembered.
 *
 * Never throws for an expired pin — that is the normal case sixty days on,
 * and a planet run that aborts because its pin aged out is worse than one
 * that reads the current release and says so. It returns:
 *
 *   version   the release that exists and will be read
 *   requested what the caller asked for, if anything
 *   expired   true when the pin is gone and the newest was taken instead
 *   notice    the sentence to log when something moved; null when nothing did
 *   problem   set, with version null, when the source lists no release at all
 *
 * `problem` rather than a throw because the sources are not equals: losing
 * Foursquare costs us a second opinion, losing Overture costs us the run, and
 * only the caller knows which it is holding.
 *
 * @param {object} options
 * @param {'overture'|'fsq'} options.source
 * @param {string|null} [options.pinned]
 * @param {typeof fetch} [options.fetch]
 */
export async function discoverRelease({
  source,
  pinned = null,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const available = await listReleases(source, { fetch: fetchImpl })
  const shape = { source, requested: pinned || null, available }
  if (!available.length) {
    return {
      ...shape,
      version: null,
      parts: [],
      expired: false,
      notice: null,
      /* Named as what it is, because the old wording guessed and guessed
       * wrong. It said "the publisher has moved the data or the bucket is no
       * longer listable", and when Foursquare's release prefix came back empty
       * that reading sent us looking for a listing problem on our side. Asked
       * directly:
       *
       *   GET fsq-os-places-us-east-1.s3.amazonaws.com/?prefix=release/
       *     → 200 OK, KeyCount 0
       *   GET fsq-os-places-us-east-1.s3.amazonaws.com/?delimiter=/
       *     → 200 OK, Key: LICENSE.txt, Key: NOTICE.txt
       *
       * The bucket is alive and anonymously listable. It is empty but for the
       * Apache-2.0 licence and a © 2025 Foursquare Labs notice: the dataset was
       * removed. So the message says the listing worked and found nothing,
       * which is a fact, and leaves the why to whoever reads it. */
      problem: `${source}: ${SOURCES[source].bucket}${SOURCES[source].releasePrefix} lists clean and holds no dated release — the publisher has emptied or moved it`,
    }
  }
  const newest = available[0]
  const expired = Boolean(pinned) && !available.includes(pinned)
  const version = expired || !pinned ? newest : pinned
  const parts = await listParts(source, version, { fetch: fetchImpl })
  const notice = expired
    ? `${source}: pinned release ${pinned} has expired and is no longer published; reading ${newest} instead (live: ${available.join(', ')})`
    : null
  return {
    ...shape,
    version,
    parts,
    expired,
    notice,
    problem: parts.length
      ? null
      : `${source}: release ${version} lists no parquet parts under ${SOURCES[source].partsPrefix(version)}`,
  }
}

/* The index is plain numbers and strings by construction — buildIndex turns
   every bigint from the footer into a Number — so JSON is the whole of the
   serialisation, and these two functions exist to say that once and to guard
   the one value JSON cannot carry. A part whose row groups declared no bbox
   statistics comes out of buildIndex with ±Infinity extents, which
   JSON.stringify writes as null and JSON.parse hands back as null, and a null
   extent compared against a bounding box is false every time: the part would
   be silently skipped and a country would quietly go missing. Non-finite
   extents become the whole world instead, so such a part is always read and
   is merely slow rather than absent. */
const WORLD = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 }

const finiteBox = box => ({
  xmin: Number.isFinite(box?.xmin) ? box.xmin : WORLD.xmin,
  xmax: Number.isFinite(box?.xmax) ? box.xmax : WORLD.xmax,
  ymin: Number.isFinite(box?.ymin) ? box.ymin : WORLD.ymin,
  ymax: Number.isFinite(box?.ymax) ? box.ymax : WORLD.ymax,
})

/** The index as JSON text. */
export function indexToJson(index) {
  return JSON.stringify({
    version: index?.version ?? null,
    builtAt: index?.builtAt ?? null,
    parts: (index?.parts || []).map(part => ({
      url: part.url,
      size: part.size,
      rows: part.rows,
      ...finiteBox(part),
      groups: (part.groups || []).map(group => ({
        s: group.s,
        e: group.e,
        ...finiteBox(group),
      })),
    })),
  })
}

/** The index back from JSON text, with the shape checked rather than assumed:
    a truncated cache file is a plausible thing to find on disk. */
export function indexFromJson(text) {
  const parsed = typeof text === 'string' ? JSON.parse(text) : text
  if (!parsed || !Array.isArray(parsed.parts)) throw new Error('places: not a release index')
  for (const part of parsed.parts) {
    if (typeof part.url !== 'string' || !Number.isFinite(part.size)) {
      throw new Error('places: release index has a part with no url or size')
    }
    if (!Array.isArray(part.groups)) throw new Error(`places: ${part.url} has no row groups`)
  }
  return parsed
}

/**
 * The release's index, from the store when it is already there and from the
 * bucket when it is not.
 *
 * Keyed by source and version, because an index is only true of the release
 * it was built from and the whole point of the module above is that the
 * release changes under us.
 *
 * @param {{source: string, version: string, parts: Array}} release
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {{read: Function, write: Function}|null} [options.store]
 * @param {(message: string) => void} [options.log]
 */
export async function releaseIndex(
  release,
  { fetch: fetchImpl = globalThis.fetch, store = null, log = () => {} } = {},
) {
  const key = `${release.source}-${release.version}`
  if (store) {
    const held = await store.read(key)
    if (held) {
      log(`places: release index for ${key} read from cache (${held.parts.length} parts)`)
      return held
    }
  }
  const started = Date.now()
  const built = await buildIndex(release.parts, { fetch: fetchImpl })
  const index = { ...built, version: release.version, source: release.source }
  log(
    `places: release index for ${key} built from ${index.parts.length} parts in ${Math.round((Date.now() - started) / 100) / 10}s`,
  )
  /* The cache is an optimisation and is treated as one. It used to be
     `await store.write(...)` bare, and that one unguarded line took the whole
     layer down in production: the container runs as `node`, /data is owned by
     root, so the mkdir threw EACCES — and the throw propagated out of a
     function that had just spent seconds building a perfectly good index,
     past the loader, into its catch, which logged "no upstream release" and
     returned null. No release meant the worker could not drain the queue, so
     every cell stayed pending, so every view came back degraded for ever and
     the map said "still loading places here" and never stopped. A directory
     nobody could write to made the map permanently empty.
     Failing to keep a copy costs the next boot a rebuild. It is not allowed
     to cost this one its answer. */
  if (store) {
    try {
      await store.write(key, index)
    } catch (error) {
      log(
        `places: release index for ${key} could not be cached — ${String(error?.message || error)}`,
      )
    }
  }
  return index
}

/**
 * A place on disk to keep built indexes. Files, not the database: the index is
 * half a megabyte of numbers that only ever describes a release the publisher
 * may already have deleted, and a cache that can be thrown away by deleting a
 * directory is easier to reason about than one that needs a migration.
 *
 * @param {{directory: string, fs?: object}} options
 */
export function createIndexStore({ directory, fs = null }) {
  const files = fs || import('node:fs/promises')
  const path = key => `${directory.replace(/\/$/, '')}/${key}.json`
  return {
    async read(key) {
      const node = await files
      try {
        return indexFromJson(await node.readFile(path(key), 'utf8'))
      } catch {
        /* Absent, unreadable or half-written are one case: build it again. */
        return null
      }
    },
    async write(key, index) {
      const node = await files
      await node.mkdir(directory, { recursive: true })
      await node.writeFile(path(key), indexToJson(index))
    },
  }
}
