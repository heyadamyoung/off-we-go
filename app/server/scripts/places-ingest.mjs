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
 *   node server/scripts/places-ingest.mjs --planet --concurrency 4 --resume
 * Options:
 *   --release <version>   pin Overture's release; re-checked, and replaced
 *                         with the newest if it has expired
 *   --dry-run             read, normalise, merge, report; write nothing
 *   --concurrency N       cells at a time (default 1)
 *   --resume              skip cells already ready or empty
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
  resume: flag('resume'),
  concurrency: Math.max(1, Number(value('concurrency', '1')) || 1),
  indexDirectory:
    value('index-dir') || process.env.PLACES_INDEX_DIR || join(tmpdir(), 'places-index'),
}

const asked = [
  options.cells.length && 'cells',
  options.bbox && 'bbox',
  options.planet && 'planet',
  options.trip && 'trip',
].filter(Boolean)
if (asked.length !== 1) {
  console.error(
    'Give exactly one of --cells, --bbox, --planet, --trip. See the header of this file.',
  )
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
  `${cells.length} cell${cells.length === 1 ? '' : 's'}${options.dryRun ? ', dry run' : ''}, ${options.concurrency} at a time`,
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
   one of seventy-three million rows. It comes off for the duration and goes
   back afterwards, and search is genuinely worse in between — which is why
   this happens only for --planet and only after saying so. */
const bulk = options.planet && !options.dryRun
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

let stopping = false
process.on('SIGINT', () => {
  if (stopping) {
    rebuild()
      .catch(error => say(`! the indexes could not be rebuilt: ${error.message}`))
      .finally(() => process.exit(130))
    return
  }
  stopping = true
  say('\n! interrupted; finishing the cell in flight, then stopping. Re-run with --resume.')
  ingest.stop()
})

let done = 0
let results, skipped, interrupted
try {
  ;({ results, skipped, interrupted } = await ingest.ingestCells(cells, {
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

await pool.end()
process.exit(failed.length ? 1 : 0)
