#!/usr/bin/env node
/* Filling the places layer, from a terminal.
 *
 * The same pipeline serves three jobs that look different and are not: one
 * cell because a traveller's query fell through to the fallback, the handful
 * a trip touches so they are warm before anybody lands, and the planet. All
 * three are a list of cells handed to places/ingest.js; the only thing this
 * file decides is which list, how many at once, and what to print.
 *
 * What it prints matters as much as what it loads. A planet run is hours
 * long and unattended, so every cell says its own line the moment it lands —
 * a count, the split between sources, how many records merged, and seconds —
 * and the run ends with a table of cells, places, seconds and megabytes off
 * the network. A run whose output is a spinner and then "done" is a run
 * nobody can tell was half wrong.
 *
 * Ctrl-C is a supported way to stop. The cell in flight is abandoned rather
 * than half-committed (the load is one transaction; see ingest.js), its
 * coverage row keeps `ingesting` and its cursor, and `--resume` picks the run
 * up from there rather than starting the planet again.
 *
 * Usage:
 *   node server/scripts/places-ingest.mjs --cells N52E004,N51E004
 *   node server/scripts/places-ingest.mjs --bbox 4,52,5,53
 *   node server/scripts/places-ingest.mjs --trip <uuid>
 *   node server/scripts/places-ingest.mjs --planet --sweep --resume
 * Options:
 *   --release <version>   pin Overture's release; re-checked, and replaced
 *                         with the newest if it has expired
 *   --dry-run             read, normalise, merge, report; write nothing
 *   --sweep               read each row group once and post its rows into the
 *                         cells they fall in, instead of asking cell by cell.
 *                         The planet is 10.5 GB read this way and about 190 GB
 *                         the other way, so anything bigger than a country
 *                         wants this. One source only; see places/sweep.js.
 *   --concurrency N       cells at a time (default 1); --sweep uses its own
 *   --resume              skip cells already ready or empty
 *   --rezoom              give every place its zoom again, ranked over the
 *                         whole region rather than one cell at a time. The
 *                         ingest does this per cell as it goes, which is a
 *                         little generous where a square straddles two; this
 *                         is the authority. Loads nothing.
 *   --drop-indexes        take the name-search indexes off for the duration
 *                         and rebuild them after; faster, and search is
 *                         genuinely worse in between
 *   --index-dir <path>    where built release indexes and footers are cached
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import {
  cellsForRegion,
  cellsForTrip,
  createIngest,
  pauseIndexes,
  resumeIndexes,
} from '../src/places/ingest.js'
import { createParquetReader } from '../src/places/parquet.js'
import { createIndexStore, discoverRelease, releaseIndex } from '../src/places/release.js'
import { EARLIEST_ZOOM, LABEL_ZOOMS } from '../src/places/rank.js'
import { assignLabelZoom } from '../src/places/store.js'
import { STANDOFF_MS, createSweep, sweepPlan } from '../src/places/sweep.js'

const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`)
const value = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback
}

const options = {
  cells: (value('cells') || '')
    .split(',')
    .map(cell => cell.trim())
    .filter(Boolean),
  bbox: value('bbox'),
  planet: flag('planet'),
  trip: value('trip'),
  release: value('release'),
  dryRun: flag('dry-run'),
  sweep: flag('sweep'),
  rezoom: flag('rezoom'),
  dropIndexes: flag('drop-indexes'),
  resume: flag('resume'),
  concurrency: Math.max(1, Number(value('concurrency', '1')) || 1),
  indexDirectory:
    value('index-dir') || process.env.PLACES_INDEX_DIR || join(tmpdir(), 'places-index'),
}

const asked = [
  options.rezoom && 'rezoom',
  options.cells.length && 'cells',
  options.bbox && 'bbox',
  options.planet && 'planet',
  options.trip && 'trip',
].filter(Boolean)
if (asked.length !== 1) {
  console.error('Give exactly one of --cells, --bbox, --planet, --trip, --rezoom. See the header.')
  process.exit(64)
}

const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || null
if (!databaseUrl && !options.dryRun) {
  console.error('DATABASE_URL is not set; nothing to load into. (--dry-run needs no database.)')
  process.exit(64)
}

/* Bytes off the network, counted by wrapping fetch rather than by asking the
   reader, so range requests, footers and listings are all in the number. The
   megabytes in the summary are what a planet run will cost in egress. */
let bytes = 0
const countingFetch = async (url, init) => {
  const response = await globalThis.fetch(url, init)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length)) bytes += length
  return response
}

/* Footers on disk. 1.6 MB per part, parsed once, and the difference between a
   1.7-second cold bbox query and a 300-millisecond warm one. */
const footerPath = url =>
  join(options.indexDirectory, `footer-${Buffer.from(url).toString('base64url')}.bin`)
const loadFooter = async url => {
  try {
    return new Uint8Array(await readFile(footerPath(url)))
  } catch {
    return null
  }
}
const saveFooter = async (url, footer) => {
  await mkdir(options.indexDirectory, { recursive: true }).catch(() => {})
  await writeFile(footerPath(url), footer).catch(() => {})
}

const store = createIndexStore({
  directory: options.indexDirectory,
  fs: { mkdir, readFile, writeFile },
})
const say = line => console.log(line)

async function releaseFor(source, pinned) {
  const found = await discoverRelease({ source, pinned, fetch: countingFetch })
  if (found.notice) say(`! ${found.notice}`)
  if (found.problem) {
    say(`! ${found.problem}`)
    return null
  }
  say(
    `${source}: release ${found.version}, ${found.parts.length} parts, ${(found.parts.reduce((total, part) => total + part.size, 0) / 1e9).toFixed(1)} GB`,
  )
  const index = await releaseIndex(found, { fetch: countingFetch, store, log: say })
  return { version: found.version, index, parts: found.parts }
}

const started = Date.now()

/* The zoom pass on its own, over everything, and then nothing else.
 *
 * No release is discovered and no bytes are read: every place is already
 * here and the only question is the zoom its kind is drawn from. It is the
 * same function the ingest calls per cell, over the whole world at once
 * rather than a cell at a time — the answer is identical either way, because
 * no row's zoom depends on any other row's. Minutes, not hours, and it holds
 * no transaction open. */
if (options.rezoom) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
  say('Giving every place the zoom its kind is drawn from.')
  /* Null rather than a world-sized box: see assignLabelZoom. */
  const placed = await assignLabelZoom(pool, null, {
    earliest: EARLIEST_ZOOM,
    floor: LABEL_ZOOMS.floor,
  })
  const { rows } = await pool.query(
    'select label_zoom, count(*)::int as places from places group by label_zoom order by label_zoom',
  )
  say(
    `\n  ${placed.toLocaleString('en-GB')} places, in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  )
  for (const row of rows) {
    say(`  z${String(row.label_zoom).padStart(2)}  ${row.places.toLocaleString('en-GB')}`)
  }
  /* Every tile was encoded from the zooms these rows used to have. */
  const cleared = await pool.query('delete from place_tiles')
  say(
    `\n  ${(cleared.rowCount || 0).toLocaleString('en-GB')} built tiles dropped; they rebuild on being asked`,
  )
  await pool.end()
  process.exit(0)
}

const overture = await releaseFor('overture', options.release)
if (!overture) {
  console.error('No Overture release to read. Nothing can be ingested.')
  process.exit(65)
}
/* Foursquare is a second opinion, not a dependency: a run without it is a
   thinner run, not a failed one, and saying so beats failing an overnight
   planet load because one publisher moved a bucket. */
const fsq = await releaseFor('fsq', null)
if (!fsq) say('! continuing with Overture alone')

const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: options.concurrency + 2 })
  : /* dry runs touch no database; anything that tries is a bug worth a stack. */
    {
      query: () => {
        throw new Error('a dry run must not touch the database')
      },
      connect: () => {
        throw new Error('a dry run must not touch the database')
      },
      end: async () => {},
    }
pool.on?.('error', error => say(`! postgres idle client: ${error.message}`))

const cells = options.trip
  ? await cellsForTrip(pool, options.trip)
  : cellsForRegion({
      cells: options.cells,
      bbox: options.bbox
        ? (([west, south, east, north]) => ({ west, south, east, north }))(
            options.bbox.split(',').map(Number),
          )
        : null,
      planet: options.planet,
      index: overture.index,
    })

if (!cells.length) {
  say('Nothing to do: that region is no cells.')
  await pool.end()
  process.exit(0)
}
say(
  `${cells.length} cell${cells.length === 1 ? '' : 's'}${options.dryRun ? ', dry run' : ''}, ` +
    (options.sweep ? 'read in one sweep of the release' : `${options.concurrency} at a time`),
)

const reader = createParquetReader({ fetch: countingFetch, loadFooter, saveFooter })
const ingest = createIngest({
  pool,
  reader,
  releases: { overture, ...(fsq ? { fsq } : {}) },
  dryRun: options.dryRun,
  concurrency: options.concurrency,
  log: line => say(`  ${line}`),
})

/* A planet load with the trigram index live rewrites a GIN index for every
   one of seventy-three million rows, so this used to come off for any
   --planet run. It is now asked for rather than assumed, because it was
   measured and it is not worth what it costs: nine dense cells swept with
   every index live loaded 971,789 places in 134 seconds — 7,250 a second,
   which puts the whole planet at under three hours without touching them.
   Dropping them buys a fraction of that and makes place search on a live
   deployment a sequential scan of a growing table for the whole run, which
   on a box people are using while travelling is the worse trade. */
const bulk = options.dropIndexes && !options.dryRun
if (bulk) {
  say('! dropping the name-search and category indexes for the duration of the planet load')
  await pauseIndexes(pool)
}

/* The rebuild is in a `finally`, and the signals are handled, because the one
   thing worse than a slow planet load is a fast one that throws: without this,
   a pool error, an OOM kill or a second Ctrl-C leaves production with its
   search indexes dropped and nothing anywhere that would put them back. A
   seventy-three-million-row sequential scan per keystroke is not a failure
   mode anybody notices until somebody types. */
const rebuild = async () => {
  if (!bulk) return
  say('! rebuilding the name-search and category indexes')
  await resumeIndexes(pool)
}
const rebuildOnSignal = signal => {
  process.once(signal, () => {
    rebuild()
      .catch(error => say(`! the indexes could not be rebuilt: ${error.message}`))
      .finally(() => process.exit(130))
  })
}
if (bulk) for (const signal of ['SIGTERM', 'SIGHUP']) rebuildOnSignal(signal)

/* A sweep reads the release rather than the cells, so it is built here and
   the two paths share only their stop signal and their summary. */
let stopSweep = null
async function runSweep() {
  const { done: already } = options.resume ? await ingest.progressFor(cells) : { done: new Set() }
  const wanted = cells.filter(cell => !already.has(cell))
  const plan = sweepPlan(overture.index, { cells: wanted })
  say(
    `sweep: ${plan.groups.length} of ${plan.groups.length + plan.skipped} row groups hold ` +
      `${plan.cells.toLocaleString('en-GB')} of those cells, ` +
      `${plan.rows.toLocaleString('en-GB')} rows to read`,
  )
  const results = []
  const swept = createSweep({
    plan,
    read: ingest.readSwept,
    load: ingest.loadSwept,
    log: line => say(`  ${line}`),
    onCell: outcome => results.push(outcome),
  })
  stopSweep = () => swept.stop()
  const totals = await swept.run()
  if (totals.retried) say(`  ${totals.retried} read(s) were asked for again`)
  if (totals.setAside) {
    say(
      `  ! ${totals.setAside} row group(s) would not read at all, leaving ` +
        `${totals.unread} cell(s) unwritten — the next run reads them`,
    )
  }
  if (totals.unfinished) {
    say(`  ! ${totals.unfinished} cells were left unread; re-run with --resume`)
  }
  if (totals.dropped) {
    say(`  ${totals.dropped.toLocaleString('en-GB')} rows fell outside the cells asked for`)
  }
  /* What the exit code has to mean, because a supervisor reads it and not
     this log. Non-zero is "there is more to do", which is what `restart:
     on-failure` on the compose service turns into the retry of last resort.
     Zero means the planet is loaded and there is nothing to come back for.

     A run that owes cells and loaded none of them used to exit zero as well,
     to keep a restart that would also get nowhere from becoming a hot loop.
     That bought a hot loop's absence at the price of a planet that stops
     loading permanently, with the supervisor told not to try and nobody told
     anything. It waits instead — see STANDOFF_MS — and exits owing, so the
     restart is paced rather than cancelled. Not when the stop came from
     outside: the deploy stops the sweep for the swap with `-t 20` and
     restarts it on the other side, and a minute of standing off would be a
     minute of a deploy waiting for a container that is already leaving. */
  const owing = totals.setAside + totals.unfinished
  if (owing && !totals.cells && !totals.interrupted) {
    say(
      `  ! this run loaded nothing and still owes ${owing.toLocaleString('en-GB')} cell(s); ` +
        `waiting ${Math.round(STANDOFF_MS / 1000)}s so the restart is a retry and not a hot loop`,
    )
    await new Promise(resolve => setTimeout(resolve, STANDOFF_MS))
  }
  return {
    results,
    skipped: cells.length - wanted.length,
    interrupted: totals.interrupted,
    again: owing > 0,
    expired: totals.expired,
  }
}

let stopping = false
process.on('SIGINT', () => {
  if (stopping) {
    rebuild()
      .catch(error => say(`! the indexes could not be rebuilt: ${error.message}`))
      .finally(() => process.exit(130))
    return
  }
  stopping = true
  say('\n! interrupted; finishing what is in flight, then stopping. Re-run with --resume.')
  if (stopSweep) stopSweep()
  else ingest.stop()
})

let done = 0
let results, skipped, interrupted, again, expired
try {
  ;({ results, skipped, interrupted, again, expired } = options.sweep
    ? await runSweep()
    : await ingest.ingestCells(cells, {
        resume: options.resume,
        onCell: () => {
          done += 1
          if (done % 25 === 0) say(`  … ${done}/${cells.length - skipped} cells`)
        },
      }))
} finally {
  await rebuild().catch(error => say(`! the indexes could not be rebuilt: ${error.message}`))
}

const seconds = (Date.now() - started) / 1000
const places = results.reduce((total, result) => total + (result.places || 0), 0)
const failed = results.filter(result => result.status === 'failed')
const empty = results.filter(result => result.status === 'empty').length

const table = [
  ['cells asked', String(cells.length)],
  ['cells skipped (already done)', String(skipped)],
  ['cells loaded', String(results.filter(result => result.status === 'ready').length)],
  ['cells empty', String(empty)],
  ['cells failed', String(failed.length)],
  ['places in those cells', places.toLocaleString('en-GB')],
  ['seconds', seconds.toFixed(1)],
  ['MB off the network', (bytes / 1e6).toFixed(1)],
  [
    'releases',
    Object.entries(ingest.versions)
      .map(([source, version]) => `${source} ${version}`)
      .join(', '),
  ],
]
const width = Math.max(...table.map(([label]) => label.length))
say('')
for (const [label, number] of table) say(`  ${label.padEnd(width)}  ${number}`)
for (const failure of failed.slice(0, 10)) say(`  ! ${failure.cell}: ${failure.error}`)
if (interrupted) say('  ! interrupted; re-run with --resume to continue')
if (expired) {
  say(`  ! the release was deleted while this run was reading it (${expired});`)
  say('    starting again discovers the newest one and carries on from here')
}

await pool.end()
/* `again` asks to be run again — see runSweep. An interrupt is a person
   saying stop and is not a failure; a failed cell is. */
process.exit(failed.length || again || expired ? 1 : 0)
