/* The live upstream release, for the fallback tier.
 *
 * Tier three of the places layer reads Parquet over HTTP from the publisher's
 * own bucket when a cell has not been ingested yet, and to read a part it
 * needs that release's index: which parts exist, and which row group in each
 * covers which corner of the world. release.js builds one; this decides when.
 *
 * Which is a question about a running server rather than about Parquet, so it
 * lives here rather than there:
 *
 *   once, lazily      building an index reads sixteen footers over the
 *                     network. A box that never falls back should never pay
 *                     for one, and a box that does should pay once — the
 *                     fallback keeps the loaded index for the life of the
 *                     process, and the disk cache keeps it across restarts.
 *   never twice       a burst of degraded queries on a cold box would
 *                     otherwise each start their own build. They share one.
 *   never fatal       the publisher moves a bucket, an S3 outage, no egress
 *                     at all: the honest answer is a query served from what
 *                     we have with `degraded` set, not a 500. A failure is
 *                     logged, remembered for RETRY_MS, and retried after.
 *
 * The release is discovered rather than pinned, because upstream deletes its
 * own releases after about sixty days and a pin that has expired is a
 * fallback that reads a bucket prefix which no longer exists. A pin is still
 * honoured when one is given — that is how a deployment holds a known-good
 * release while something is investigated — and discoverRelease says loudly
 * in its notice when the pin has gone.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createIndexStore, discoverRelease, releaseIndex } from './release.js'

/** Where built indexes are kept between restarts. Under /data because that is
    the volume that survives a deploy; everything else in the tree is replaced
    by the next release. */
export const DEFAULT_INDEX_DIR = '/data/places'

/** How long a failed discovery is remembered before trying again. Long enough
    that an outage is not hammered, short enough that a box recovers on its
    own within a coffee break. */
export const RETRY_MS = 10 * 60_000

/**
 * A `loadIndex` for createPlaceFallback.
 *
 * @param {object} [options]
 * @param {'overture'|'fsq'} [options.source]
 * @param {string|null} [options.pinned] a release version to hold to
 * @param {string} [options.directory] where to cache built indexes
 * @param {typeof fetch} [options.fetch]
 * @param {{read: Function, write: Function}|null} [options.store] overrides directory
 * @param {(message: string) => void} [options.log]
 * @param {() => number} [options.now]
 * @returns {() => Promise<{source: string, version: string, index: object}|null>}
 */
export function createReleaseLoader({
  source = 'overture',
  pinned = null,
  directory = DEFAULT_INDEX_DIR,
  fetch: fetchImpl = globalThis.fetch,
  store = null,
  log = () => {},
  now = Date.now,
  retryMs = RETRY_MS,
} = {}) {
  const cache = store ?? createIndexStore({ directory })
  let pending = null
  let failedAt = 0
  let loaded = null

  async function build() {
    try {
      const release = await discoverRelease({ source, pinned, fetch: fetchImpl })
      if (release.notice) log(release.notice)
      if (release.problem) throw new Error(release.problem)
      const index = await releaseIndex(
        { source, version: release.version, parts: release.parts },
        { fetch: fetchImpl, store: cache, log },
      )
      failedAt = 0
      loaded = release.version
      return { source, version: release.version, index }
    } catch (error) {
      failedAt = now()
      /* Not thrown: the caller is a query that has already been answered from
         the database, and the worst this may do is leave it un-enriched. */
      log(`places: no upstream release to fall back on — ${String(error?.message || error)}`)
      return null
    }
  }

  async function loadIndex() {
    if (pending) return pending
    if (failedAt && now() - failedAt < retryMs) return null
    pending = build().finally(() => {
      pending = null
    })
    return pending
  }

  /* The version last loaded, for the staleness check on the serving path —
     which needs to know what "current" is, and cannot ask a bucket on the way
     to answering a query. Null until the first load, which the worker does
     within a minute of boot. */
  Object.defineProperty(loadIndex, 'current', { get: () => loaded })
  return loadIndex
}

/**
 * Parsed Parquet footers on disk.
 *
 * A footer is 1.6 MB per part and is parsed to find which row group holds
 * which corner of the world. Keeping them is the difference between a
 * 1.7-second cold read and a 300-millisecond warm one, measured — and across
 * a restart it is the difference between a traveller's first degraded query
 * waiting on sixteen downloads and waiting on none.
 *
 * Same directory and same naming as the ingest script uses, deliberately: a
 * planet run leaves the footers warm for the server, and the server leaves
 * them warm for the next run.
 *
 * @param {{directory?: string}} [options]
 */
export function createFooterStore({ directory = DEFAULT_INDEX_DIR } = {}) {
  const path = url => join(directory, `footer-${Buffer.from(url).toString('base64url')}.bin`)
  return {
    async loadFooter(url) {
      try {
        return new Uint8Array(await readFile(path(url)))
      } catch {
        /* Absent, unreadable or half-written are one case: fetch it again. */
        return null
      }
    },
    async saveFooter(url, footer) {
      await mkdir(directory, { recursive: true }).catch(() => {})
      await writeFile(path(url), footer).catch(() => {})
    },
  }
}
