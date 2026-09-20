/* Tier two: knowing where a trip is going before it gets there.
 *
 * The serving path is only fast because the rows are already in PostGIS, and
 * the rows are only there because something asked for them. Tier three — the
 * Parquet fallback — exists so a traveller who outruns us still gets an
 * answer, but it is a second and a half cold and it reads a public bucket
 * that owes us nothing. Every fallback is a miss, and this file's whole job is
 * to make misses rare by noticing, at the moment a trip is created or its
 * stops move, which cells that trip will stand in, and asking for them.
 *
 * The lead time is the gift: somebody plans Lisbon in March and flies in June.
 * Weeks, for work that takes seconds a cell. So the request is written
 * immediately and the ingest happens whenever the drain gets to it.
 *
 * Two rules the implementation is shaped by:
 *
 *   It must never block the write that triggered it. A stop dragged up the
 *   list is a person waiting for a screen to settle; a coverage lookup on that
 *   path adds a round trip to every drag, and a coverage lookup that fails
 *   would fail the drag. So `noteStops` returns nothing, synchronously,
 *   having only added to an in-memory set; a timer flushes the set. If the
 *   process dies with cells unflushed, the next query on that cell requests
 *   it — the queue is an optimisation, not a promise.
 *
 *   It must not ingest inline. Nothing here reads Parquet or writes places. It
 *   writes `pending` rows to `place_coverage` and stops. What drains them is
 *   `server/scripts/places-ingest.mjs`, which is somebody else's file, and
 *   which finds its work with `pendingCells()` — `status in (pending, stale)`,
 *   oldest `requested_at` first. In production that runs as a periodic job;
 *   by hand it is `node server/scripts/places-ingest.mjs --drain`.
 *
 * On priority: the table can only order by `requested_at`, which is when the
 * cell was asked for, not when the traveller needs it. Ordering by departure
 * would need a column on `place_coverage` that migration 043 does not have,
 * and 043 is applied and must not be edited. Until a 044 adds one, a scheduler
 * that wants soonest-departure-first joins `stops` to `trips` itself and
 * drains those cells ahead of the queue; oldest-ask-first is the honest
 * default and is never wrong, only sometimes not the best order.
 */

import { cellsForPoints, cellsWithin } from './cells.js'
import { event, recordFailure } from '../tracing.js'

/* How far past a stop we claim the traveller will look. A stop three hundred
   metres from a cell edge will ask "what is near me" and half the answer is
   in the next cell; five kilometres is enough to carry the default nearby
   radius and its first widening across the boundary, and small enough that a
   stop in the middle of a cell adds no cells at all. Widening past that is
   the sparse-country case, which is by definition thin and cheap to serve
   from whatever is already there. */
export const LOOKAHEAD_METRES = 5_000

/* A cell asked about again inside this window is not looked up again. A trip
   being edited fires this path on every stop move; without it a minute of
   dragging is a minute of coverage queries for an answer that cannot have
   changed. */
export const REMEMBER_MS = 60_000

/* How long the set of noticed cells is allowed to sit before it is written.
   Long enough to coalesce a burst of stop edits into one statement, short
   enough that a trip created and then abandoned still gets queued. */
export const FLUSH_DELAY_MS = 250

/** Statuses that mean a query can be answered from `places` alone. */
const SERVEABLE = new Set(['ready', 'empty'])
/** Statuses that mean somebody is already going to fill this cell. */
const CLAIMED = new Set(['pending', 'ingesting'])

/**
 * The cells a set of stops touches, plus the ones just over their edges.
 * @param {Array<{lng: number, lat: number}>} stops
 * @param {{lookaheadMetres?: number}} [options]
 * @returns {string[]}
 */
export function cellsForStops(stops, { lookaheadMetres = LOOKAHEAD_METRES } = {}) {
  const points = (stops || []).filter(
    stop => Number.isFinite(Number(stop?.lng)) && Number.isFinite(Number(stop?.lat)),
  )
  const cells = new Set(cellsForPoints(points.map(stop => ({ lng: +stop.lng, lat: +stop.lat }))))
  for (const stop of points) {
    for (const cell of cellsWithin(+stop.lng, +stop.lat, lookaheadMetres)) cells.add(cell)
  }
  return [...cells].sort()
}

/**
 * Whether a source has moved on since this cell was filled.
 *
 * Release names are dated and zero-padded — "2026-07-22.0", "2026-08-19.0" —
 * so a string comparison is a date comparison, which is why no date parsing
 * happens here. A source the cell has never heard of is newer than nothing,
 * so a cell filled before Foursquare was added is stale the moment it is.
 *
 * @param {{versions?: Record<string, string>}} row
 * @param {Record<string, string>} releases  source → its current release
 */
export function isStale(row, releases = {}) {
  const held = row?.versions || {}
  for (const [source, current] of Object.entries(releases)) {
    if (!current) continue
    if (String(held[source] ?? '') < String(current)) return true
  }
  return false
}

/**
 * Whether a query landing here can be served from `places`.
 * @param {object|undefined} row  from `coverageFor`, or undefined when there is none
 * @param {Record<string, string>} releases
 */
export function isReady(row, releases = {}) {
  if (!row || !SERVEABLE.has(row.status)) return false
  return !isStale(row, releases)
}

/**
 * Whether this cell should be put on the queue.
 *
 * A cell already `pending` or `ingesting` is left alone: asking twice does not
 * make it arrive sooner, and re-stamping a claimed row is how two workers end
 * up on one cell. A `failed` cell is asked for again — whatever broke may have
 * been the network, and `attempts` is there for the drain to back off on.
 */
export function needsRequest(row, releases = {}) {
  if (!row) return true
  if (CLAIMED.has(row.status)) return false
  if (row.status === 'failed' || row.status === 'stale') return true
  return isStale(row, releases)
}

/**
 * The coverage queue.
 *
 * @param {object} options
 * @param {{placeCoverage: Function, requestPlaceCells: Function, pendingPlaceCells?: Function}} options.repository
 * @param {Record<string, string>} [options.releases] source → current release, for staleness
 * @param {() => Date} [options.clock]
 * @param {number} [options.rememberMs]
 * @param {number} [options.flushDelayMs]
 */
export function createPlaceCoverage({
  repository,
  releases = {},
  clock = () => new Date(),
  rememberMs = REMEMBER_MS,
  flushDelayMs = FLUSH_DELAY_MS,
} = {}) {
  /** cells noticed but not yet written. */
  const noticed = new Set()
  /** cell → the moment it was last looked up, so a burst asks once. */
  const recent = new Map()
  let timer = null
  let flushing = null

  const able = Boolean(repository?.placeCoverage && repository?.requestPlaceCells)
  /* The current releases are discovered at runtime — see places/upstream.js —
     so the caller may hand in a function rather than a map. Without this the
     map was always `{}` and `isStale` always false: a cell loaded from a
     six-month-old release stayed `ready` for ever and the monthly refresh
     never fired from the serving path at all. */
  const current = () => (typeof releases === 'function' ? releases() || {} : releases || {})

  const forget = now => {
    for (const [cell, at] of recent) if (now - at > rememberMs) recent.delete(cell)
  }

  /** Look the cells up, ask for the ones that need it. Returns what happened,
      which is what `ensure` hands back and what the flush throws away.

      The list of cells to ask for is local, deliberately: an earlier version
      accumulated into the same set `noteStops` fills, so a query could sweep
      up cells nobody had looked up yet and mark a `ready` cell `pending`. */
  async function request(cells, { dedupe = false } = {}) {
    const wanted = [...new Set(cells)].filter(Boolean)
    if (!able || !wanted.length) return { wanted, ready: [], missing: [], requested: [] }
    const coverage = await repository.placeCoverage(wanted)
    const ready = []
    const missing = []
    const asking = []
    for (const cell of wanted) {
      const row = coverage.get(cell)
      const held = current()
      if (isReady(row, held)) ready.push(cell)
      else missing.push(cell)
      /* On the read path, asked for at most once per `rememberMs`: without it
         a client panning a map issues a coverage upsert on every request, and
         a degraded request did two — one here and one from the fallback's own
         enqueue. Not on the note path, where `noteStops` has already put the
         cell in `recent` itself and skipping it would mean a trip's stops
         were never asked for at all. */
      if (needsRequest(row, held) && !(dedupe && recent.has(cell))) asking.push(cell)
    }
    const requested = asking.length ? await repository.requestPlaceCells(asking, clock()) : []
    const now = clock().getTime()
    for (const cell of wanted) recent.set(cell, now)
    forget(now)
    return { wanted, ready, missing, requested, coverage }
  }

  /* The flush a note schedules. It swallows its own failures on purpose: the
     write that triggered it has long since returned, there is nobody to tell,
     and a coverage row that did not get written costs one fallback later. It
     is recorded on the trace rather than thrown, because "places never get
     ingested and nothing says why" is precisely the silent-degrade this
     codebase has been bitten by before. */
  async function flush() {
    const cells = [...noticed]
    noticed.clear()
    if (!cells.length) return
    try {
      const result = await request(cells)
      event('places coverage requested', {
        'places.coverage.wanted': result.wanted.length,
        'places.coverage.missing': result.missing.length,
        'places.coverage.requested': result.requested.length,
      })
    } catch (error) {
      recordFailure(error)
      event('places coverage failed', {
        'places.coverage.wanted': cells.length,
        error: String(error?.message || error).slice(0, 200),
      })
    }
  }

  function schedule() {
    if (timer || !able) return
    timer = setTimeout(() => {
      timer = null
      flushing = flush().finally(() => {
        flushing = null
      })
    }, flushDelayMs)
    /* Never a reason for the process to stay alive. */
    timer.unref?.()
  }

  return {
    /**
     * A trip was created, or its stops changed. Cheap, synchronous, and it
     * cannot throw: the caller is in the middle of answering a write.
     * @param {{stops?: Array<{lng: number, lat: number}>, cells?: string[]}} input
     */
    noteStops(input = {}) {
      if (!able) return
      const now = clock().getTime()
      forget(now)
      const cells = input.cells?.length ? input.cells : cellsForStops(input.stops || [])
      for (const cell of cells) {
        if (recent.has(cell)) continue
        recent.set(cell, now)
        noticed.add(cell)
      }
      if (noticed.size) schedule()
    },

    /**
     * The read a query does before deciding whether it may be served locally.
     * Awaited, unlike `noteStops` — the answer decides whether the fallback
     * runs — but still only two statements, and the second only when
     * something is actually missing.
     * @param {string[]} cells
     */
    async ensure(cells) {
      if (!able) return { wanted: [...new Set(cells || [])], ready: [], missing: [], requested: [] }
      return request(cells, { dedupe: true })
    },

    /** Mark these cells wanted without reading first — the fallback's path,
        where the query already knows the cell was not ready. */
    async requestNow(cells) {
      const now = clock().getTime()
      forget(now)
      const wanted = [...new Set(cells || [])].filter(Boolean).filter(cell => !recent.has(cell))
      if (!able || !wanted.length) return []
      for (const cell of wanted) recent.set(cell, now)
      return repository.requestPlaceCells(wanted, clock())
    },

    /** What is waiting, oldest ask first. The drain's door. */
    async queue({ limit = 50, statuses } = {}) {
      if (!repository?.pendingPlaceCells) return []
      return repository.pendingPlaceCells({ limit, statuses })
    },

    /** Tests and shutdown: settle whatever a note scheduled. */
    async settle() {
      if (timer) {
        clearTimeout(timer)
        timer = null
        flushing = flush().finally(() => {
          flushing = null
        })
      }
      await flushing
    },

    /** Whether this deployment's repository can do any of it. */
    available: able,
  }
}
