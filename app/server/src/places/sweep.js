/* Reading the release once instead of once per cell.
 *
 * The cell-by-cell ingest asks a question per cell: "every row inside this
 * one degree square". That is the right question for a traveller's viewport
 * falling through to the fallback, and it is the wrong question for the
 * planet, because a row group is the smallest thing Parquet can read and a
 * dense square touches a lot of them. Measured against Overture 2026-08-19.0:
 * Amsterdam's square touches 14 row groups and reads about 37 MB, Toronto's
 * touches 22 and reads 61 MB, and asking all 53,333 candidate squares in turn
 * reads about 190 gigabytes to fetch a release that is 10.48 gigabytes. The
 * same bytes, eighteen times over, because neighbouring squares share groups.
 *
 * Turn the question round and it is one pass. Walk the 4,096 row groups in
 * the order they sit in the files, read each one exactly once, and post its
 * rows into the squares they fall in. A square is finished the moment the
 * last group that overlaps it has been read — which the index knows before a
 * byte is fetched, because every group carries its own bounding box — and at
 * that moment it goes to the ordinary cell load, the same transaction with
 * the same collapse guard and the same tile sweep as any other ingest. This
 * file decides what to read and when a square is complete. It does not know
 * what a database is.
 *
 * What that costs in memory, which is the only reason to hesitate: a square's
 * rows have to be held from its first group to its last. Simulated over the
 * real index, the peak is about 1.57 million rows across some 208 squares
 * still open, which is a gigabyte or so of JavaScript objects on a box with
 * 62. Banding the planet by longitude was tried and moves the peak by a tenth
 * while re-reading groups that straddle a band, so it is not done: the files'
 * own order is already sorted by geography, which is what keeps the number
 * that low. `ahead` is the one lever, and it trades the same memory for
 * keeping the link busy while a square is being written.
 *
 * Single-source by construction. Two sources have to be clustered together
 * inside one square (see ingest.js), and a sweep that read one source's
 * groups would be holding the other's rows for the length of the run. Nobody
 * asks for that today — Foursquare publishes no parquet under its release
 * prefix, so the ingest runs on Overture alone — and the day somebody does,
 * the cell path is still there and still correct. `createSweep` refuses a
 * second source rather than quietly loading half of one.
 */

import { cellsForBounds, isCellKey } from './cells.js'

/** Row groups read ahead of the one being posted into squares. Four is what
    the reader already uses against the bucket, and it is enough to keep a
    gigabit link busy while a dense square is being written. */
export const READ_AHEAD = 4

/** Squares being written at once. The box has sixteen cores and one
    database; past a handful these queue on the database and the only thing
    that grows is how many squares' rows are held waiting for their turn. */
export const LOAD_AHEAD = 4

/** How often the run says where it is, in row groups. */
export const SAY_EVERY = 25

/** Attempts at one row group before the run gives up on it.
 *
 * Learned the expensive way. A read that fails stops the sweep, deliberately:
 * a cell loaded from a partial read is a cell that has quietly lost a third
 * of a city, and the collapse guard cannot see the difference. But "stops the
 * sweep" was written as "one 503 from a public bucket ends a three-hour run",
 * and that is what happened — the first live planet run died somewhere in the
 * Atlantic and the box sat there with an exited container and nothing to say
 * about it. Four thousand range requests against a bucket that owes us
 * nothing will meet a bad one; the answer is to ask again, not to treat the
 * first blip as the truth about the release. A group that fails four times in
 * a row with the delays below is a real failure and still stops the run. */
export const READ_TRIES = 4

/** First backoff, doubled each attempt: 2s, 4s, 8s. */
export const READ_BACKOFF_MS = 2000

/** The square a record belongs to.
 *
 * Records arrive already normalised — the caller composes the reader and its
 * source's normaliser, so nothing here knows what Parquet or Overture is —
 * and normalising is what works out the square. A record without one is a
 * record with no usable point, which the normaliser already counts as
 * skipped; it is dropped rather than guessed at. */
export function cellOfRecord(record) {
  const cell = record?.cell
  return isCellKey(cell) ? cell : null
}

/**
 * What a sweep will read, and which squares each read finishes.
 *
 * Pure arithmetic over the index: no network, no clock. A group whose squares
 * are all already done is not in the plan at all, which is what makes
 * `--resume` cheap — an interrupted planet run picks up reading only the
 * groups that still owe somebody rows.
 *
 * @param {{parts: Array}} index      from parquet.js buildIndex
 * @param {{cells?: string[]|Set<string>}} [options]  squares to load; all of
 *        them when absent
 * @returns {{groups: Array<{part: object, group: object, cells: string[]}>,
 *            outstanding: Map<string, number>, barren: string[], cells: number,
 *            rows: number, skipped: number}}
 */
export function sweepPlan(index, { cells = null } = {}) {
  const want = cells ? (cells instanceof Set ? cells : new Set(cells)) : null
  const groups = []
  const outstanding = new Map()
  let rows = 0
  let skipped = 0
  for (const part of index.parts || []) {
    for (const group of part.groups || []) {
      const covered = cellsForBounds({
        west: group.xmin,
        south: group.ymin,
        east: group.xmax,
        north: group.ymax,
      })
      const mine = want ? covered.filter(cell => want.has(cell)) : covered
      if (!mine.length) {
        skipped += 1
        continue
      }
      groups.push({ part, group, cells: mine })
      rows += group.e - group.s
      for (const cell of mine) outstanding.set(cell, (outstanding.get(cell) || 0) + 1)
    }
  }
  /* Asked-for squares that no row group touches at all — open sea, mostly.
     They have to be written `empty`, not left out: a square with no coverage
     row is a square the map reports as still loading for ever, and one that
     every later resume asks for again. The cell path already writes them; a
     sweep that quietly dropped them would be a sweep whose coverage differs
     from the other path's, which is the one thing it must not be. */
  const barren = want ? [...want].filter(cell => !outstanding.has(cell)).sort() : []
  return { groups, outstanding, barren, cells: outstanding.size, rows, skipped }
}

/**
 * A sweep bound to a reader and a loader.
 *
 * @param {object} options
 * @param {ReturnType<typeof sweepPlan>} options.plan
 * @param {(part: object, group: object) => Promise<object[]>} options.read
 * @param {(cell: string, rows: object[]) => Promise<object>} options.load
 * @param {number} [options.ahead]      row groups in flight
 * @param {number} [options.loadAhead]  squares being written at once
 * @param {number} [options.tries]      attempts at one row group
 * @param {(ms: number) => Promise<void>} [options.wait]  injectable, for tests
 * @param {(line: string, detail?: object) => void} [options.log]
 * @param {(outcome: object) => void} [options.onCell]
 * @param {() => number} [options.clock]
 */
export function createSweep({
  plan,
  read,
  load,
  ahead = READ_AHEAD,
  loadAhead = LOAD_AHEAD,
  tries = READ_TRIES,
  backoffMs = READ_BACKOFF_MS,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = () => {},
  onCell = () => {},
  clock = () => Date.now(),
}) {
  let stopped = false
  const totals = {
    groups: 0,
    rows: 0,
    kept: 0,
    dropped: 0,
    cells: 0,
    places: 0,
    empty: 0,
    failed: 0,
    retried: 0,
  }

  /** One row group, asked for again when the bucket is having a moment.
   *
   * The retry is here rather than in the reader because this is the caller
   * that cannot simply return a worse answer: a short read hands a cell rows
   * it does not have. Every other caller of readGroup is a query somebody is
   * waiting on, where failing fast is right. */
  async function readGroup(part, group) {
    let last = null
    for (let attempt = 1; attempt <= Math.max(1, tries); attempt += 1) {
      try {
        return await read(part, group)
      } catch (error) {
        last = error
        if (attempt >= Math.max(1, tries) || stopped) break
        totals.retried += 1
        log(
          `sweep: rows ${group.s}-${group.e} of ${part.url} failed ` +
            `(${String(error?.message || error)}); attempt ${attempt + 1} of ${tries}`,
        )
        await wait(backoffMs * 2 ** (attempt - 1))
      }
    }
    throw last
  }

  async function run() {
    const started = clock()
    /* A square's rows, from its first group to its last, and how many of its
       groups are still to come. The second is the whole trick: it is known
       from the index before anything is fetched, so a square can be finished
       and let go of the instant it is complete rather than at the end. */
    const held = new Map()
    const left = new Map(plan.outstanding)
    const loads = new Set()

    /* A read that has failed is not allowed to sit in `pending` unhandled —
       Node kills the process for an unhandled rejection, and losing an hour
       of a planet run to a 503 from a public bucket is not a thing that
       should need saying twice. Settled into a value, thrown when its turn
       comes. */
    const pending = new Map()
    let issued = 0
    const fill = () => {
      while (pending.size < Math.max(1, ahead) && issued < plan.groups.length && !stopped) {
        const at = issued
        issued += 1
        const { part, group } = plan.groups[at]
        pending.set(
          at,
          Promise.resolve()
            .then(() => readGroup(part, group))
            .then(
              rows => ({ rows }),
              error => ({ error }),
            ),
        )
      }
    }

    async function finish(cell, rows) {
      while (loads.size >= Math.max(1, loadAhead)) await Promise.race(loads)
      if (stopped) return
      const task = (async () => {
        try {
          const outcome = await load(cell, rows)
          totals.cells += 1
          totals.places += outcome?.places || 0
          if (outcome?.status === 'empty') totals.empty += 1
          if (outcome?.status === 'failed') totals.failed += 1
          onCell(outcome || { cell })
        } catch (error) {
          totals.failed += 1
          log(`${cell} failed: ${String(error?.message || error)}`)
          onCell({ cell, status: 'failed', places: 0, error: String(error?.message || error) })
        }
      })()
      loads.add(task)
      task.then(() => loads.delete(task))
    }

    /* The empty ones first, while nothing else is in flight: they are one
       statement each and they are the cheapest thing the run will do. */
    for (const cell of plan.barren || []) {
      if (stopped) break
      await finish(cell, [])
    }

    let at = 0
    while (at < plan.groups.length && !stopped) {
      fill()
      const settled = await pending.get(at)
      pending.delete(at)
      const entry = plan.groups[at]
      at += 1
      if (settled.error) throw settled.error
      totals.groups += 1
      totals.rows += settled.rows.length
      for (const row of settled.rows) {
        const cell = cellOfRecord(row)
        /* A square nobody is waiting for. Either the caller asked for a
           region and this row is outside it, or it is already loaded and
           this is a resume — both mean no group left will close it, so
           holding the row would be holding it for ever. */
        if (cell === null || !left.has(cell)) {
          totals.dropped += 1
          continue
        }
        const bucket = held.get(cell)
        if (bucket) bucket.push(row)
        else held.set(cell, [row])
        totals.kept += 1
      }
      for (const cell of entry.cells) {
        const outstanding = left.get(cell)
        if (outstanding === undefined) continue
        if (outstanding > 1) {
          left.set(cell, outstanding - 1)
          continue
        }
        left.delete(cell)
        const rows = held.get(cell) || []
        held.delete(cell)
        await finish(cell, rows)
      }
      if (totals.groups % SAY_EVERY === 0) {
        log(
          `sweep ${totals.groups}/${plan.groups.length} groups, ${totals.cells} cells, ` +
            `${totals.places.toLocaleString()} places, ${held.size} open, ` +
            `${Math.round((clock() - started) / 1000)}s`,
          { ...totals, open: held.size },
        )
      }
    }
    await Promise.all(loads)
    return {
      ...totals,
      /* Squares whose groups were not all read. Zero on a run that finished;
         on an interrupted one these keep whatever coverage status they had,
         which is what makes `--resume` pick them up rather than trust them. */
      unfinished: left.size,
      interrupted: stopped,
      ms: clock() - started,
    }
  }

  /** Stop after the group in flight. Squares already complete finish being
      written; squares still open are abandoned, unwritten, and are exactly
      the ones a resume reads again. */
  return { run, stop: () => (stopped = true), stopped: () => stopped, totals }
}
