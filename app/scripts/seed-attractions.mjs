#!/usr/bin/env node
/* ===========================================================================
   Seed the attractions table.

   Walks a region in ten-kilometre cells — the largest circle Wikipedia's
   geosearch will answer — and upserts everything worth a pin into PostgreSQL.

   Run it once per region, from a machine, never from the browser: it needs the
   service_role key, which bypasses row level security and must never be shipped
   to a client.

     DATABASE_URL=postgresql://wayfare:password@localhost:5432/wayfare \
     node scripts/seed-attractions.mjs

   By default it seeds the Netherlands and Scotland, this trip's two halves.
   Name regions to pick some of them, or give a bounding box of your own:

     node scripts/seed-attractions.mjs scotland
     node scripts/seed-attractions.mjs --box=-1.5,50.9,1.9,52.5 --name="South East"

   Add --dry-run to see how many cells and attractions a region comes to
   without needing credentials or writing anything.

   It is safe to re-run. Rows are upserted by Wikipedia page id, so a second
   pass refreshes rather than duplicates, and a run that dies halfway can simply
   be started again.
   =========================================================================== */
/* Run through tsx (the deploy does): the classifier lives with the map code
   in TypeScript now — one classifier, whether a browser walks a view live or
   this script walks a country into the table. The old '../src/places.js'
   import outlived that move, which is why no database ever got seeded. */
import pg from 'pg'
import {
  attractionsInCell,
  cellsCovering,
  extractsFor,
  isHeadline,
} from '../src/features/map/api/attractions.ts'
import { setApiHeaders, setApiThrottle } from '../src/shared/api/wikipedia-client.ts'

// Wikimedia asks scripts to identify themselves, and refuses them otherwise.
setApiHeaders({ 'User-Agent': 'Off We Go/1.0 (family trip viewer; support@threadway.ai)' })
// Two a second. Measured: ten requests in four seconds already earns a 429.
setApiThrottle(500)

const dryRun = process.argv.includes('--dry-run')

const DATABASE_URL = process.env.DATABASE_URL
if (!dryRun && !DATABASE_URL) {
  console.error(`
Missing credentials.

  DATABASE_URL  PostgreSQL connection string for the Off We Go database
`)
  process.exit(1)
}

const REGIONS = {
  netherlands: { name: 'Netherlands', west: 3.3, south: 50.7, east: 7.3, north: 53.6 },
  scotland: { name: 'Scotland', west: -7.7, south: 54.6, east: -0.7, north: 58.7 },
}

const args = process.argv.slice(2)
const boxArg = args.find(a => a.startsWith('--box='))
const nameArg = args.find(a => a.startsWith('--name='))
const named = args.filter(a => !a.startsWith('--')).map(a => a.toLowerCase())

let regions
if (boxArg) {
  const [west, south, east, north] = boxArg.slice(6).split(',').map(Number)
  if ([west, south, east, north].some(Number.isNaN)) {
    console.error('--box wants west,south,east,north — e.g. --box=-1.5,50.9,1.9,52.5')
    process.exit(1)
  }
  regions = [{ name: nameArg ? nameArg.slice(7) : 'custom', west, south, east, north }]
} else if (named.length) {
  regions = named.map(key => {
    if (!REGIONS[key]) {
      console.error(`Unknown region "${key}". Known: ${Object.keys(REGIONS).join(', ')}`)
      process.exit(1)
    }
    return REGIONS[key]
  })
} else {
  regions = Object.values(REGIONS)
}

const db = dryRun ? null : new pg.Client({ connectionString: DATABASE_URL })
if (db) await db.connect()

const pause = ms => new Promise(r => setTimeout(r, ms))
const rows = new Map() // page id -> row, deduplicated across overlapping cells

async function flush() {
  if (!rows.size) return 0
  const all = [...rows.values()]
  rows.clear()
  if (dryRun) return all.length
  let written = 0
  await db.query('begin')
  try {
    for (const row of all) {
      await db.query(
        `insert into attractions(id,name,descr,category,image_file,lng,lat,headline)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set
        name=excluded.name,descr=excluded.descr,category=excluded.category,
        image_file=excluded.image_file,lng=excluded.lng,lat=excluded.lat,
        headline=excluded.headline,updated_at=now()`,
        [row.id, row.name, row.descr, row.category, row.image_file, row.lng, row.lat, row.headline],
      )
    }
    await db.query('commit')
    written = all.length
  } catch (error) {
    await db.query('rollback')
    throw error
  }
  return written
}

let total = 0

for (const region of regions) {
  // A limit high enough to mean "all of them": a region is bounded, unlike a view.
  const cells = cellsCovering(region, { limit: 100000 })
  console.log(`\n${region.name}: ${cells.length} cells of ten kilometres`)

  let done = 0,
    found = 0
  // Two at a time. Wikipedia is lending us this for nothing and starts refusing
  // at around ten concurrent, which costs more time than the patience saves.
  for (let i = 0; i < cells.length; i += 2) {
    const batch = cells.slice(i, i + 2)
    const got = await Promise.all(
      batch.map(async cell => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await attractionsInCell(cell)
          } catch {
            await pause(1200 * (attempt + 1))
          }
        }
        console.warn(`  cell ${cell.key} gave up after three tries`)
        return []
      }),
    )

    for (const poi of got.flat()) {
      rows.set(poi.id, {
        id: poi.id,
        name: poi.n,
        descr: poi.d,
        category: poi.k,
        image_file: poi.f,
        lng: poi.x,
        lat: poi.y,
        headline: isHeadline(poi.k),
      })
    }
    found += got.flat().length
    done += batch.length

    if (rows.size >= 2000) total += await flush()
    if (done % 40 === 0) {
      process.stdout.write(`\r  ${done}/${cells.length} cells · ${found} found · ${total} written`)
    }
    await pause(90)
  }
  total += await flush()
  process.stdout.write(`\r  ${done}/${cells.length} cells · ${found} found · ${total} written\n`)
}

/* Second pass: the opening lines of each article.

   Kept separate from the cell walk because it is resumable on its own — it asks
   the table what is still missing rather than starting from the top, so an
   interrupted run costs only the batch it was in the middle of. Anything with
   no extract to be had is stored as an empty string, which is what stops it
   being asked for again for ever.  */
async function fillExtracts() {
  const COLUMNS = 'id,name,descr,category,image_file,lng,lat,headline'
  let filled = 0
  for (;;) {
    const rows = (
      await db.query(
        `select ${COLUMNS} from attractions where extract is null order by id limit 200`,
      )
    ).rows
    if (!rows.length) break

    // A whole batch failing is a rate limit, not a dead end: wait longer and
    // try again. Giving up here would strand every row behind it.
    let text = null
    for (let attempt = 0; attempt < 4 && !text; attempt++) {
      try {
        text = await extractsFor(rows.map(r => r.id))
      } catch {
        await pause(5000 * (attempt + 1))
      }
    }
    if (!text) {
      console.log('  Wikipedia is refusing; stopping here, run again to carry on')
      break
    }
    for (const row of rows)
      await db.query('update attractions set extract=$2,updated_at=now() where id=$1', [
        row.id,
        text.get(row.id) ?? '',
      ])

    filled += rows.length
    if (filled % 2000 === 0) console.log(`  ${filled} paragraphs so far`)
    await pause(120)
  }
  console.log(`  ${filled} paragraphs`)
}

if (!dryRun) {
  console.log('')
  console.log('Fetching the opening lines, twenty articles at a time.')
  await fillExtracts()
}

if (dryRun) {
  console.log(`

Dry run: ${total} attractions found. Nothing was written anywhere.`)
} else {
  const count = (await db.query('select count(*)::int count from attractions')).rows[0].count
  console.log(`\nDone. ${total} rows written this run; ${count} attractions in the table.`)
  await db.end()
}
