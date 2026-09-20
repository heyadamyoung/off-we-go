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
 *   failure backs off     a cell that fails for a reason that will not
 *                         change — a part that 404s, a row nothing can parse
 *                         — sorts to the front of the queue forever on its
 *                         old requested_at and starves everything behind it.
 *                         So it waits: a minute, four, a quarter of an hour,
 *                         an hour, six, and six from then on. It is never
 *                         given up on. This was a cap of five tries once,
 *                         and Paris was found in production `failed` with a
 *                         whole capital behind it and nothing that would
 *                         ever try it again. Waiting solves the starving;
 *                         stopping solves nothing and loses a city.
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

import { cellBounds } from './cells.js'
import { createIngest } from './ingest.js'
import { createParquetReader } from './parquet.js'
import {
  CONFIDENCE_FLOOR,
  EARLIEST_ZOOM,
  LABEL_PER_TILE,
  LABEL_ZOOMS,
  VIEW_WEIGHT,
  ZOOM_POLICY,
} from './rank.js'
import { assignLabelZoom, placeTile, readPlaceTile, writePlaceTile } from './store.js'
import { tilesToBuild } from './tiles.js'
import { event } from '../tracing.js'

/** How often the queue is looked at. */
export const TICK_MS = 60_000
/** How many cells one tick may ingest. */
export const CELLS_PER_TICK = 4

/** An `ingesting` row older than this belonged to a process that is gone. */
export const STUCK_AFTER_MS = 30 * 60_000
/** How many ready cells a tick may mark stale when the release moves on. */
export const REFRESH_PER_TICK = 8
/** How long a tick may spend building tiles ahead of being asked for them.
 *
 * A budget rather than a count, because a tile of open sea and a tile of
 * central Amsterdam are two very different pieces of work and a count of
 * either tells you nothing about the minute. Well under the tick, so the
 * building never becomes the thing that stops the queue draining. */
export const TILE_BUDGET_MS = 20_000

/* `started_at` is a heartbeat, not a start time: the ingest moves it every
   couple of seconds while it reads (see ingest.js writeCursor). So an old one
   means the process holding that cell is gone, not that the cell is slow —
   which matters, because reclaiming a cell a live run is still inside makes
   two processes insert the same gers_id and one of them dies on the unique
   key. */
const STUCK_SQL = `
  update place_coverage set status = 'pending'
  where status = 'ingesting' and started_at < $1
  returning cell`

/* The claim, and it is a claim rather than a read.
 *
 * `for update skip locked` over the rows this tick wants, and the status move
 * in the same statement, so two drains — two boxes, or a box and somebody's
 * terminal — cannot both take the same cell. A read followed by a separate
 * write, with a whole cell read in between, is not a claim at all.
 *
 * Waiting work first, retries only with the room left. Failures are old by
 * definition, and ordering by requested_at puts them in front of a traveller
 * who asked a minute ago — a handful of permanently broken cells would fill
 * every window for ever.
 *
 * And within the waiting, priority before age. "Oldest ask first" was the
 * only ordering this table could express, and it was right while the queue
 * held the cells travellers had asked about. The planet put 53,333 cells in
 * it; at four a minute a cell somebody is looking at right now joins a line
 * forty-two thousand long. So a viewport or a trip asks at priority 0 and
 * the backfill at 1, age decides between equals, and a person never waits
 * behind a batch. */
const CLAIM_SQL = `
  with waiting as (
    (select cell, priority as queue, requested_at from place_coverage
      where status in ('pending', 'stale')
      order by priority asc, requested_at asc nulls last, cell asc limit $1)
    union all
    -- Retries after everything waiting, whatever their priority: a failure
    -- is old by definition and a first look beats a second.
    (select cell, 9 as queue, requested_at from place_coverage
      where status = 'failed' and coalesce(next_attempt_at, requested_at) <= now()
      order by next_attempt_at asc nulls first, requested_at asc nulls last, cell asc
      limit $1)
  ),
  picked as (
    select c.cell from place_coverage c
    join waiting w on w.cell = c.cell
    order by w.queue, w.requested_at asc nulls last, c.cell asc
    limit $1
    for update of c skip locked
  )
  update place_coverage set status = 'ingesting', started_at = now()
  where cell in (select cell from picked)
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
  stuckAfterMs = STUCK_AFTER_MS,
  refreshPerTick = REFRESH_PER_TICK,
  tileBudgetMs = TILE_BUDGET_MS,
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
  /* Cells whose tiles are all built. See warmTiles. */
  const warmed = new Set()

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

  /** The cells this tick has taken, already moved to `ingesting`. */
  async function claim() {
    if (cellsPerTick <= 0) return []
    const result = await pool.query(CLAIM_SQL, [cellsPerTick])
    return result.rows.map(row => row.cell)
  }

  /* Tiles built before anybody asks.
   *
   * The read-through cache in the route makes the second look at a square
   * free; this is what makes the first one free too. Reported as "slow as
   * fuck when scrolling across large parts of the map", which is exactly the
   * case where every square is somebody's first: a fast pan at zoom twelve
   * crosses dozens of squares nobody has ever asked for, and each one was a
   * scan, a sort and an encode before it was bytes.
   *
   * Only the zooms a pan actually uses — see EAGER_ZOOMS. Deeper than
   * fourteen a screen is a handful of squares and there are sixteen times as
   * many per level, so building them all would be hundreds of thousands of
   * tiles to save a few lookups nobody would feel.
   *
   * Bounded by a clock rather than a count, skipping what already exists, and
   * it never throws: a tile that could not be built is a slow square later,
   * not a drain that stops.
   */
  async function warmTiles(cells = []) {
    const wanted = cells.length ? cells : await coldCells()
    if (!wanted.length) return 0
    const deadline = now().getTime() + tileBudgetMs
    let built = 0
    for (const cell of wanted) {
      /* Finished cells are remembered, or the idle pass picks the same oldest
         cell for ever: four and a half thousand lookups a minute to discover
         that every one of them already exists, and the cell after it never
         reached at all. Held in memory rather than written down because it is
         a fact about this process's work queue, not about the data — a
         restart re-checks, which is a couple of seconds once. */
      if (!cells.length && warmed.has(cell)) continue
      let bounds
      try {
        bounds = cellBounds(cell)
      } catch {
        continue
      }
      for (const tile of tilesToBuild(bounds)) {
        if (now().getTime() >= deadline) {
          log(`places: tile warming stopped on the clock after ${built}`)
          event('places tiles warmed', { 'places.tiles.built': built, 'places.tiles.done': false })
          return built
        }
        try {
          if (await readPlaceTile(pool, tile)) continue
          /* Read before built, so a cell ingested while this square was being
             encoded makes these bytes a past and writePlaceTile declines them.
             The warming pass runs over ground that has just been loaded and
             the drain is loading the next cell beside it, so this is not a
             rare window — it is the normal one. */
          const from = now()
          const body = await placeTile(pool, tile, {
            floor: CONFIDENCE_FLOOR,
            weights: VIEW_WEIGHT,
          })
          if (await writePlaceTile(pool, tile, body, 0, from)) built += 1
        } catch (error) {
          log(`places: tile ${tile.z}/${tile.x}/${tile.y} not built — ${error.message}`)
          /* One unbuildable tile is one slow square; a table that is not there
             at all is every tile, and carrying on would be a minute of the
             same error per tick. */
          if (/place_tiles/.test(String(error?.message))) return built
        }
      }
      /* Every tile of this cell exists. It never needs walking again. */
      warmed.add(cell)
    }
    if (built) {
      log(`places: ${built} tile(s) built ahead of being asked for`)
      event('places tiles warmed', { 'places.tiles.built': built, 'places.tiles.done': true })
    }
    return built
  }

  /** Ready cells whose tiles may be missing — the ground somebody ingested
      before this release existed, or before the warming reached it. One at a
      time, oldest first, skipping what this process has already finished. */
  /** Which cell to build tiles for next, when there is a tick to spare.
   *
   * Where somebody is actually going, first. Reported from the road: the pins
   * do not show straight away — zoom in, wait, pan away and back and they are
   * there — which is a first look paying for the build and every look after
   * getting it free. Building every square of the planet ahead of time is not
   * the answer to that (fifty-three thousand cells at about seventeen hundred
   * squares each is ninety million tiles), but building the squares over the
   * places on somebody's itinerary is a few dozen cells and it is exactly the
   * ground they will be looking at.
   *
   * So a cell a trip has a stop in outranks one nobody has asked about, and
   * the oldest-first walk is what happens once those are done. */
  async function coldCells() {
    const result = await pool.query(
      `select c.cell from place_coverage c
       where c.status = 'ready' and c.place_count > 0 and not (c.cell = any($1::text[]))
       order by
         exists (
           select 1 from stops s
           where s.lng is not null and s.lat is not null
             and s.lng >= c.west and s.lng < c.east
             and s.lat >= c.south and s.lat < c.north
         ) desc,
         c.last_refresh asc nulls first
       limit 1`,
      [[...warmed]],
    )
    return result.rows.map(row => row.cell)
  }

  /* Places written before marks earned their zoom, put on the map.
   *
   * The column arrived with rows already in the table, and a row with no zoom
   * is drawn from zoom 11 — visible, deliberately, because invisible would
   * have been an outage. But visible-from-11 is every place at once, which is
   * the carpet of dots the whole thing exists to end. Re-ingesting fixes it
   * and takes hours; this takes one statement.
   *
   * Once, and then never again: the ingest gives every cell its zooms inside
   * its own transaction, so the only rows that can be unplaced are the ones
   * that predate the column. When there are none the query costs a look at an
   * index and the pass does not run.
   *
   * Not awaited by the tick that starts it. It is minutes on a planet and the
   * queue has better things to do. The promise is kept rather than dropped:
   * `placing` is what stops a second tick starting a second pass, and it is
   * what stop() waits on, so a shutdown does not pull the pool out from under
   * a statement that is rewriting every row in the table. */
  /** The rule these zooms were computed under, written down beside them. */
  async function recordZoomPolicy() {
    await pool.query('delete from place_zoom_policy')
    await pool.query('insert into place_zoom_policy (version) values ($1)', [ZOOM_POLICY])
  }

  let placing = null
  async function placeTheUnplaced() {
    if (placing || stopped) return
    /* Two reasons to run: a row with no zoom at all, or zooms computed under
       a policy that is no longer the one the code holds. The second is the
       general case and the first is the special one — a stored number gives
       no hint of the rule that produced it, so the rule's version is kept
       beside it. */
    const policy = await pool.query(
      'select version from place_zoom_policy order by applied_at desc limit 1',
    )
    const stale = Number(policy.rows[0]?.version ?? 0) !== ZOOM_POLICY
    /* A stale policy means every row needs placing again, whatever it holds;
       a current one means only the rows holding nothing do. One question
       either way, and it stops at the first row it finds. */
    const { rows } = await pool.query(
      stale
        ? 'select 1 from places limit 1'
        : 'select 1 from places where label_zoom is null limit 1',
    )
    if (!rows.length) {
      /* Nothing to place. On an empty table — a fresh box, a test — the
         policy is still brought up to date, or every tick for ever would ask
         the same question and answer it the same way. */
      if (stale) await recordZoomPolicy()
      return
    }
    const started = Date.now()
    log('places: giving every place that has none the zoom it earns')
    placing = assignLabelZoom(pool, null, {
      weights: VIEW_WEIGHT,
      perTile: LABEL_PER_TILE,
      zooms: LABEL_ZOOMS,
      earliest: EARLIEST_ZOOM,
    })
      .then(async placed => {
        const seconds = Math.round((Date.now() - started) / 100) / 10
        log(`places: ${placed} place(s) given a zoom in ${seconds}s`)
        event('places zooms placed', {
          'places.zooms.placed': placed,
          'places.zooms.ms': Date.now() - started,
        })
        /* Every tile was encoded from the zooms these rows used to have. */
        await pool.query('delete from place_tiles')
        /* And the policy these were computed under, so the next boot does
           not do it all again. Written after the pass, not before: a crash
           halfway through must leave the work looking undone. */
        await recordZoomPolicy()
        warmed.clear()
      })
      .catch(error => log(`places: the zoom pass did not finish — ${error.message}`))
      .finally(() => {
        placing = null
      })
  }

  /** Resolves when nothing a tick set going is still going. */
  async function settled() {
    while (placing) await placing
  }

  async function tick() {
    if (stopped) return

    /* Before the release index, not after it.
     *
     * This was below the `if (!pipe) return` below, which meant the zoom pass
     * — which needs nothing but the database — could not run unless sixteen
     * downloads off S3 had succeeded first. On the box that shipped it they
     * had not yet, so every place in the world kept the null zoom that draws
     * from zoom 11, and Regina and Toronto were a carpet of dots for an hour
     * while the worker sat waiting on an index it did not need.
     *
     * The rule this is an instance of: work that can be done from the
     * database alone must not be behind a network call. */
    await placeTheUnplaced()

    const pipe = await pipeline()
    if (!pipe) return
    await recoverStuck()
    await markRefreshable(pipe.versions?.overture)
    const cells = await claim()
    if (!cells.length) {
      /* Nothing to ingest is the best time to build tiles: the box is idle
         and a traveller panning tomorrow is the one who benefits. */
      await warmTiles()
      return
    }
    const started = Date.now()
    const { results } = await pipe.ingestCells(cells)
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
    /* And the tiles over what was just loaded, before anybody asks for them.
       The cells that were ingested first, because those are the ones whose
       tiles were swept a moment ago and are therefore missing right now. */
    /* A cell that was just ingested had its tiles swept inside that same
       transaction, so whatever this process believed about it is wrong. */
    const reloaded = results.filter(result => result.status !== 'failed').map(r => r.cell)
    for (const cell of reloaded) warmed.delete(cell)
    await warmTiles(reloaded)
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

  function schedule(delay = tickMs) {
    if (stopped || timer) return
    timer = setTimeout(() => {
      timer = null
      running = safeTick().finally(() => {
        running = null
        schedule()
      })
    }, delay)
    /* Never a reason for the process to stay alive. */
    timer.unref?.()
  }

  return {
    /* The first pass is now, not in a minute.
     *
     * Every restart — a deploy, a crash, an OOM — used to begin with a minute
     * in which the queue was not read by anybody, and the first thing that
     * happens on a cold box is the release index being built, which is itself
     * sixteen downloads. So a traveller opening the map straight after a
     * deploy waited out a minute of nothing before the fetching even started.
     * Still a timer rather than a call, so start() returns immediately and
     * stop() can take the run away before it begins. */
    start() {
      stopped = false
      schedule(0)
    },
    /** Stop after the cell in flight; the ingest leaves it resumable. */
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      ingest?.stop?.()
      await running
      await settled()
    },
    /** Tests and the first boot: run one pass now rather than in a minute. */
    async once() {
      await safeTick()
    },
    /** Wait for the work a tick started and did not wait for itself. */
    settled,
  }
}
