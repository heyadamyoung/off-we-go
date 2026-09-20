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
      return { source, version: release.version, index }
    } catch (error) {
      failedAt = now()
      /* Not thrown: the caller is a query that has already been answered from
         the database, and the worst this may do is leave it un-enriched. */
      log(`places: no upstream release to fall back on — ${String(error?.message || error)}`)
      return null
    }
  }

  return async function loadIndex() {
    if (pending) return pending
    if (failedAt && now() - failedAt < retryMs) return null
    pending = build().finally(() => {
      pending = null
    })
    return pending
  }
}
