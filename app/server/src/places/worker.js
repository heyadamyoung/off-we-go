/* Draining the coverage queue, on the box that serves the queries.
 *
 * Everything else in this directory fills a queue. A trip being written
 * notices the ground around its stops; a query that fell through to the
 * fallback asks for the cell it could not answer from. Both end as a row in
 * `place_coverage` with status `pending`, and until something reads those
 * rows the layer is a fallback tier with a database attached: every query
 * degraded, every degraded query asking again for a cell nobody will ever
 * fetch.
 *
 * This is the thing that reads them. In-process, beside the media worker and
 * the travel watch, for the same reason those are: this is one box. It
 * claims by moving a row to `ingesting` inside the ingest's own transaction,
 * so the day it is several boxes this same file runs on each of them and
 * nothing else changes.
 *
 * Four rules, and each of them is a failure this would otherwise have:
 *
 *   a few cells a tick    a cell is seconds of network and a transaction.
 *                         A queue of four hundred cells drained flat out is
 *                         the API server spending its afternoon reading
 *                         Parquet instead of answering people.
 *   bounded attempts      a cell that fails for a reason that will not
 *                         change — a part that 404s, a row nothing can parse
 *                         — sorts to the front of the queue forever on its
 *                         old requested_at and starves everything behind it.
 *                         After MAX_ATTEMPTS it is left alone and its error
 *                         is on the row for somebody to read.
 *   stuck cells recovered a process killed mid-cell leaves `ingesting` and a
 *                         cursor. Nothing else will ever move that row, and
 *                         the cursor is exactly what a resumed read wants.
 *   the refresh trickles  when upstream publishes a new release every ready
 *                         cell is out of date at once. Marking them all
 *                         stale in one statement would turn the whole map
 *                         degraded until the queue caught up. A few per tick
 *                         instead, oldest first, so the refresh is a slow
 *                         tide rather than a cliff — and each cell's reload
 *                         is one transaction, so nothing is ever half
 *                         refreshed on screen.
 */

import { createIngest } from './ingest.js'
import { createParquetReader } from './parquet.js'
import { pendingCells } from './store.js'
import { event } from '../tracing.js'

/** How often the queue is looked at. */
export const TICK_MS = 60_000
/** How many cells one tick may ingest. */
export const CELLS_PER_TICK = 4
/** After this many tries a cell is left alone rather than retried forever. */
export const MAX_ATTEMPTS = 5
/** An `ingesting` row older than this belonged to a process that is gone. */
export const STUCK_AFTER_MS = 30 * 60_000
/** How many ready cells a tick may mark stale when the release moves on. */
export const REFRESH_PER_TICK = 8

const STUCK_SQL = `
  update place_coverage set status = 'pending'
  where status = 'ingesting' and started_at < $1
  returning cell`

/* `versions` is written by the ingest as {source: version}; a cell loaded
   from a release that is no longer the current one is what "stale" means.
   Oldest refresh first, so a cell nobody has touched since spring goes
   before one loaded last week. */
const REFRESH_SQL = `
  update place_coverage set status = 'stale'
  where cell = any(
    select cell from place_coverage
    where status = 'ready' and coalesce(versions->>$1, '') <> $2
    order by last_refresh asc nulls first, cell asc
    limit $3
  )
  returning cell`

/**
 * @param {object} options
 * @param {{query: Function, connect: Function}} options.pool
 * @param {() => Promise<{source: string, version: string, index: object}|null>} options.loadIndex
 *   the Overture release — places/upstream.js builds one
 * @param {() => Promise<{source: string, version: string, index: object}|null>} [options.loadSecondIndex]
 *   Foursquare, when a deployment has one. A second opinion, never a
 *   dependency: a run without it is a thinner run, not a failed one.
 * @param {{loadFooter: Function, saveFooter: Function}} [options.footers]
 * @param {(message: string) => void} [options.log]
 */
export function createPlaceWorker({
  pool,
  loadIndex,
  loadSecondIndex = null,
  footers = {},
  fetch: fetchImpl = globalThis.fetch,
  log = () => {},
  tickMs = TICK_MS,
  cellsPerTick = CELLS_PER_TICK,
  maxAttempts = MAX_ATTEMPTS,
  stuckAfterMs = STUCK_AFTER_MS,
  refreshPerTick = REFRESH_PER_TICK,
  makeIngest = createIngest,
  makeReader = createParquetReader,
  now = () => new Date(),
} = {}) {
  let timer = null
  let running = null
  let stopped = false
  let ingest = null
  /* Said once rather than every minute: a box with no egress would otherwise
     write a line a minute for the life of the process. */
  let saidNoRelease = false

  /** The ingest, built from whatever releases can be discovered. Kept: the
      index is half a megabyte of numbers and the reader's warm footers are
      the difference between seconds and a fraction of one. */
  async function pipeline() {
    if (ingest) return ingest
    const overture = await loadIndex?.()
    if (!overture?.index) {
      if (!saidNoRelease) log('places: no upstream release, so the queue cannot be drained')
      saidNoRelease = true
      return null
    }
    saidNoRelease = false
    const releases = { overture: { version: overture.version, index: overture.index } }
    const second = loadSecondIndex ? await loadSecondIndex() : null
    if (second?.index) releases[second.source] = { version: second.version, index: second.index }
    else if (loadSecondIndex) log('places: draining with Overture alone')
    ingest = makeIngest({
      pool,
      reader: makeReader({ fetch: fetchImpl, ...footers }),
      releases,
      log,
      now,
    })
    return ingest
  }

  /** Rows abandoned by a process that died mid-cell. */
  async function recoverStuck() {
    const before = new Date(now().getTime() - stuckAfterMs)
    const result = await pool.query(STUCK_SQL, [before])
    if (result.rowCount) {
      log(`places: ${result.rowCount} cell(s) left ingesting by a stopped process, queued again`)
    }
    return result.rowCount
  }

  /** Ready cells whose release has moved on, a few at a time. */
  async function markRefreshable(version) {
    if (!version || refreshPerTick <= 0) return 0
    const result = await pool.query(REFRESH_SQL, ['overture', version, refreshPerTick])
    if (result.rowCount) log(`places: ${result.rowCount} cell(s) marked stale for ${version}`)
    return result.rowCount
  }

  /**
   * The cells this tick will do.
   *
   * Two reads rather than one. A single query over all three statuses sorts
   * by `requested_at`, so cells that have failed their last attempt — which
   * are old by definition — would fill the window ahead of a traveller who
   * asked a minute ago. Waiting work first, retries only with the room left.
   */
  async function claim() {
    const fresh = await pendingCells(pool, {
      statuses: ['pending', 'stale'],
      limit: cellsPerTick,
    })
    if (fresh.length >= cellsPerTick) return fresh
    const retries = await pendingCells(pool, {
      statuses: ['failed'],
      limit: cellsPerTick * 4,
    })
    const room = cellsPerTick - fresh.length
    return [...fresh, ...retries.filter(row => (row.attempts ?? 0) < maxAttempts).slice(0, room)]
  }

  async function tick() {
    if (stopped) return
    const pipe = await pipeline()
    if (!pipe) return
    await recoverStuck()
    await markRefreshable(pipe.versions?.overture)
    const cells = await claim()
    if (!cells.length) return
    const started = Date.now()
    const { results } = await pipe.ingestCells(cells.map(row => row.cell))
    const loaded = results.reduce((total, result) => total + (result.places ?? 0), 0)
    const failed = results.filter(result => result.status === 'failed').length
    log(
      `places: ${results.length} cell(s), ${loaded} place(s), ${failed} failed, ${Math.round((Date.now() - started) / 100) / 10}s`,
    )
    event('places queue drained', {
      'places.queue.cells': results.length,
      'places.queue.places': loaded,
      'places.queue.failed': failed,
      'places.queue.ms': Date.now() - started,
    })
  }

  /* A tick never throws. It runs on a timer with nobody to catch it, and an
     unhandled rejection from a bucket having a bad afternoon would take the
     API server down with it. */
  async function safeTick() {
    try {
      await tick()
    } catch (error) {
      log(`places: draining the queue failed — ${String(error?.message || error)}`)
      event('places queue failed', { error: String(error?.message || error).slice(0, 200) })
    }
  }

  function schedule() {
    if (stopped || timer) return
    timer = setTimeout(() => {
      timer = null
      running = safeTick().finally(() => {
        running = null
        schedule()
      })
    }, tickMs)
    /* Never a reason for the process to stay alive. */
    timer.unref?.()
  }

  return {
    start() {
      stopped = false
      schedule()
    },
    /** Stop after the cell in flight; the ingest leaves it resumable. */
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      ingest?.stop?.()
      await running
    },
    /** Tests and the first boot: run one pass now rather than in a minute. */
    async once() {
      await safeTick()
    },
  }
}
