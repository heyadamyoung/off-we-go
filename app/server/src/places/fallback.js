/* Tier three: the answer we give when we have not ingested where you are.
 *
 * This is the road in used as a road out, and it is a bad road on purpose.
 * Measured against the 2026-08-19.0 release: a warm bbox read is 300–500 ms,
 * a cold one 1.7 seconds, of which 907 ms is parsing a footer, and the files
 * carry no page index so twenty thousand rows come back whichever six hundred
 * were wanted. Nothing here makes that fast. What it does is make it bounded,
 * make it rare, and make it honest.
 *
 * Bounded, three ways, because the thing being read is a public bucket that
 * owes us nothing and a dependency nobody can page:
 *
 *   a deadline — 3 seconds, as an AbortSignal *and* a race. The signal alone
 *     is not enough: `readBox` checks it between batches of row groups, so a
 *     single fetch that never answers would sit past the deadline holding a
 *     connection. The race returns at the deadline whatever the reader is
 *     doing, and the signal tells the reader to stop wasting bytes.
 *
 *   a concurrency limit — 2, counted at module scope so it is a limit on the
 *     process and not on whoever happened to construct a fallback. Two is
 *     about the bucket, not about us: a handful of requests is polite, a
 *     hundred is a small denial of service we are performing on somebody
 *     else's infrastructure.
 *
 *   no queue. Over the limit the answer is immediate and degraded, with
 *     whatever local rows the caller already has. A queue here would turn one
 *     uncovered city into an unbounded pile of pending reads, each holding a
 *     request, and a bucket that answers slowly would then take the whole API
 *     down with it. Refusing to fall back is a worse answer; refusing to
 *     queue is a bounded one.
 *
 * Rare, because every degraded answer enqueues its cell (see coverage.js), so
 * the second traveller in that city is served from PostGIS.
 *
 * Honest, because the release index and the parsed footers are cached at
 * module scope — the 907 ms is paid once per part for the life of the process,
 * and a second query in the same city costs nothing extra — and because every
 * record goes through `placeFromOverture`, the same function the ingest uses.
 * A degraded record has the same shape, the same category vocabulary and the
 * same licence trail as a served one. The client is told `degraded: true` and
 * needs no second code path to render it.
 */

import { cellKey } from './cells.js'
import {
  COLUMNS,
  OSM_LICENSE,
  OVERTURE_LICENSE,
  licensesFor,
  placeFromOverture,
} from './overture.js'
import { createParquetReader } from './parquet.js'
import { metresBetween } from './resolve.js'
import { event } from '../tracing.js'

/** Long enough for a warm read and most cold ones; short enough that a
    traveller waiting on a list does not think the app has died. */
export const DEADLINE_MS = 3_000
/** Reads in flight across this process. See the note above on why 2. */
export const CONCURRENCY = 2
/** Rows read out of Parquet before we stop bothering. A row group is 20k rows
    and a city box can touch several; ranking a hundred thousand candidates to
    show twenty is work nobody sees. */
export const MAX_ROWS = 20_000

/* Module scope on purpose — see the file comment. The reader holds the parsed
   footers, the index holds the parts, and the counter is the process's. */
let sharedIndex = null
let sharedAt = 0
let sharedReader = null
let inFlight = 0

/** How long a loaded release index is trusted.
 *
 * "Forever" was wrong, and quietly: upstream deletes its own releases after
 * about sixty days, so a box up longer than that goes on reading a bucket
 * prefix that no longer exists, every fallback returns `failed`, and only a
 * restart fixes it. Half a day costs one rediscovery — a listing and sixteen
 * cached footers — and means a box picks up a new release on its own. */
export const INDEX_TTL_MS = 12 * 60 * 60_000

/** Reads happening right now, for tests and for the metrics. */
export const fallbackInFlight = () => inFlight

/** Drop the caches. Tests only: production wants them to live forever. */
export function resetFallbackCache() {
  sharedIndex = null
  sharedAt = 0
  sharedReader = null
  inFlight = 0
}

/**
 * The sources behind a degraded record, in the same shape `place_sources`
 * gives for a served one. `licensesFor` decides ODbL-versus-CDLA from the
 * dataset name, so the rule lives in one place: a record Overture took from
 * OpenStreetMap obliges us to attribute whether it came from the database or
 * from the bucket.
 */
export function sourcesForPlace(place) {
  const rows = [
    {
      source: 'overture',
      license: OVERTURE_LICENSE,
      upstreamId: place.upstreamId,
      version: place.version,
      confidence: place.confidence,
      fields: [],
    },
  ]
  for (const id of place.upstreamIds || []) {
    const at = id.indexOf(':')
    const dataset = at === -1 ? id : id.slice(0, at)
    const record = at === -1 ? id : id.slice(at + 1)
    const licenses = licensesFor([{ dataset }])
    rows.push({
      source: dataset,
      license: licenses.includes(OSM_LICENSE) ? OSM_LICENSE : OVERTURE_LICENSE,
      upstreamId: record,
      version: place.version,
      confidence: null,
      fields: [],
    })
  }
  return rows
}

/* A place from the bucket, wearing a served record's clothes.
 *
 * `id` is the GERS id rather than null, and that is not a shortcut. The client
 * keys its list on `id` and drops anything without one, so a null would make
 * every degraded record vanish on the way to the screen — the whole tier
 * silently doing nothing, which is the failure mode this codebase has been
 * bitten by before. The GERS id is the right value for it: migration 043 calls
 * it "the canonical join key across releases", `GET /api/places/:id` resolves
 * it (see store.js), and it goes on resolving — to the ingested row this time
 * — once the cell lands. `gersId` carries it as well, so nothing is hidden
 * about which kind of id this is. */
function degradedRecord(place, centre) {
  return {
    id: place.gersId ?? place.upstreamId ?? null,
    gersId: place.gersId,
    name: place.name,
    alternateNames: place.alternateNames,
    lng: place.lng,
    lat: place.lat,
    cell: place.cell,
    category: place.category,
    categoryRaw: place.categoryRaw,
    address: place.address,
    website: place.website,
    phone: place.phone,
    hours: place.hours,
    operating: place.operating,
    confidence: place.confidence,
    firstSeen: null,
    lastRefreshed: null,
    metres: centre ? metresBetween(centre, { lng: place.lng, lat: place.lat }) : null,
    similarity: null,
    sources: sourcesForPlace(place),
  }
}

/**
 * @param {object} options
 * @param {() => Promise<{version: string, index: {parts: Array}}|null>} [options.loadIndex]
 *   the current release's index — release.js owns building it; this only reads
 * @param {object} [options.readerOptions] passed to createParquetReader
 * @param {typeof createParquetReader} [options.makeReader]
 * @param {number} [options.deadlineMs]
 * @param {number} [options.concurrency]
 * @param {{requestNow: Function}} [options.coverage] so every miss enqueues its cell
 */
export function createPlaceFallback({
  loadIndex = null,
  readerOptions = {},
  makeReader = createParquetReader,
  deadlineMs = DEADLINE_MS,
  concurrency = CONCURRENCY,
  coverage = null,
  maxRows = MAX_ROWS,
  indexTtlMs = INDEX_TTL_MS,
} = {}) {
  async function release() {
    if (sharedIndex && Date.now() - sharedAt < indexTtlMs) return sharedIndex
    if (!loadIndex) return null
    const loaded = await loadIndex()
    if (!loaded?.index?.parts?.length) {
      /* A rediscovery that failed keeps what we have rather than dropping the
         tier, and resets the clock so the next query does not try again. An
         index for a release that has gone is still better than nothing: its
         parts may yet answer, and if they do not the read says so. */
      if (sharedIndex) sharedAt = Date.now()
      return sharedIndex
    }
    sharedIndex = loaded
    sharedAt = Date.now()
    return sharedIndex
  }

  function reader() {
    if (!sharedReader) sharedReader = makeReader(readerOptions)
    return sharedReader
  }

  /** Ask for the cells this box touched, whatever the read did. A degraded
      answer that does not lead to an ingested one is a permanent degradation. */
  async function enqueue(cells) {
    if (!coverage?.requestNow || !cells.length) return
    try {
      await coverage.requestNow(cells)
    } catch {
      /* The queue is an optimisation; a query already answered must not fail
         because the cell could not be written. The failure is recorded by
         coverage.js's own instrumentation. */
    }
  }

  /**
   * Places inside a box, from the bucket.
   *
   * Always resolves. `degraded` is always true — anything this returns is by
   * definition an answer we could not serve — and `reason` says why it is as
   * thin as it is: `busy` (over the concurrency limit), `deadline`,
   * `unavailable` (no release index configured), `failed`, or null when the
   * read simply finished.
   *
   * @param {{west: number, south: number, east: number, north: number}} bounds
   * @param {{limit?: number, centre?: {lng: number, lat: number}|null, cells?: string[], signal?: AbortSignal}} [options]
   */
  async function readBounds(bounds, { limit = 20, centre = null, cells = [], signal } = {}) {
    const touched = cells.length
      ? cells
      : [...new Set([cellKey(bounds.west, bounds.south), cellKey(bounds.east, bounds.north)])]
    const started = Date.now()

    if (inFlight >= concurrency) {
      /* Not queued, on purpose. The caller has local rows; it answers with
         those and says it is degraded. */
      event('places fallback refused', {
        'places.fallback.reason': 'busy',
        'places.fallback.in_flight': inFlight,
      })
      await enqueue(touched)
      return { places: [], degraded: true, reason: 'busy', cells: touched, ms: 0, rows: 0 }
    }

    /* Claimed before the first await. Checking the counter and then yielding
       to load the index would let every arrival pass the check together, and
       the limit would hold only when nothing was concurrent — which is the
       one case it is not for. */
    inFlight += 1
    let loaded = null
    try {
      loaded = await release()
    } catch {
      loaded = null
    }
    if (!loaded) {
      inFlight -= 1
      event('places fallback refused', { 'places.fallback.reason': 'unavailable' })
      await enqueue(touched)
      return { places: [], degraded: true, reason: 'unavailable', cells: touched, ms: 0, rows: 0 }
    }

    const controller = new AbortController()
    const stop = () => controller.abort()
    signal?.addEventListener('abort', stop, { once: true })
    let timer = null
    const expired = new Promise(resolve => {
      timer = setTimeout(() => {
        controller.abort()
        resolve('deadline')
      }, deadlineMs)
      timer.unref?.()
    })

    let rows = 0
    let reason = null
    let found = []
    let read = null
    try {
      read = reader()
        .readBox(loaded.index, bounds, COLUMNS, {
          signal: controller.signal,
          onGroup: count => {
            rows += count
            /* A city box can touch several row groups of twenty thousand. Past
               the ceiling the extra rows cannot change the top twenty and can
               only cost time and memory. */
            if (rows >= maxRows) controller.abort()
          },
        })
        .then(result => ({ result }))
        .catch(error => ({ error }))
      const outcome = await Promise.race([read, expired])
      if (outcome === 'deadline') reason = 'deadline'
      else if (outcome.error) reason = controller.signal.aborted ? 'deadline' : 'failed'
      else {
        for (const row of outcome.result) {
          const place = placeFromOverture(row, { version: loaded.version })
          if (place) found.push(degradedRecord(place, centre))
        }
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      /* The slot is held until the read settles, not until the race does.
         After a deadline the abort tears the fetches down, but it tears them
         down asynchronously, and freeing the slot on the race would admit the
         next read while this one still holds four sockets and their buffered
         bodies. `read` has its own catch, so it never rejects here. */
      if (read)
        void read.finally(() => {
          inFlight -= 1
        })
      else inFlight -= 1
    }

    if (centre) found.sort((a, b) => (a.metres ?? 0) - (b.metres ?? 0))
    found = found.slice(0, limit)
    const ms = Date.now() - started
    event('places fallback read', {
      'places.fallback.reason': reason ?? 'ok',
      'places.fallback.rows': rows,
      'places.fallback.kept': found.length,
      'places.fallback.ms': ms,
    })
    await enqueue(touched)
    return { places: found, degraded: true, reason, cells: touched, ms, rows }
  }

  return {
    readBounds,
    /** Whether this deployment can fall back at all. */
    get available() {
      return Boolean(loadIndex)
    },
    inFlight: fallbackInFlight,
  }
}
