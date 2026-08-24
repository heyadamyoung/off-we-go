#!/usr/bin/env node
/* ===========================================================================
   Seed the attractions table.

   Walks a region in ten-kilometre cells — the largest circle Wikipedia's
   geosearch will answer — and upserts everything worth a pin into Supabase.

   Run it once per region, from a machine, never from the browser: it needs the
   service_role key, which bypasses row level security and must never be shipped
   to a client.

     SUPABASE_URL=https://xxxx.supabase.co \
     SUPABASE_SERVICE_ROLE=eyJhbGci... \
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
import { createClient } from '@supabase/supabase-js'
import { cellsCovering, attractionsInCell, isHeadline, setApiHeaders } from '../src/places.js'

// Wikimedia asks scripts to identify themselves, and refuses them otherwise.
setApiHeaders({ 'User-Agent': 'Wayfare/1.0 (family trip viewer)' })

const dryRun = process.argv.includes('--dry-run')

const URL_ = process.env.SUPABASE_URL
const KEY_ = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!dryRun && (!URL_ || !KEY_)) {
  console.error(`
Missing credentials.

  SUPABASE_URL            your project url, from Settings -> API
  SUPABASE_SERVICE_ROLE   the service_role key on that same page

The service_role key bypasses row level security. Keep it out of .env.local,
out of the repository, and out of anything the browser can read.
`)
  process.exit(1)
}

const REGIONS = {
  netherlands: { name: 'Netherlands', west: 3.3, south: 50.7, east: 7.3, north: 53.6 },
  scotland:    { name: 'Scotland',    west: -7.7, south: 54.6, east: -0.7, north: 58.7 },
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

const db = dryRun ? null : createClient(URL_, KEY_, { auth: { persistSession: false } })

const pause = ms => new Promise(r => setTimeout(r, ms))
const rows = new Map()          // page id -> row, deduplicated across overlapping cells

async function flush() {
  if (!rows.size) return 0
  const all = [...rows.values()]
  rows.clear()
  if (dryRun) return all.length
  let written = 0
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500)
    const { error } = await db.from('attractions').upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`upsert failed: ${error.message}`)
    written += chunk.length
  }
  return written
}

let total = 0

for (const region of regions) {
  // A limit high enough to mean "all of them": a region is bounded, unlike a view.
  const cells = cellsCovering(region, { limit: 100000 })
  console.log(`\n${region.name}: ${cells.length} cells of ten kilometres`)

  let done = 0, found = 0
  // Two at a time. Wikipedia is lending us this for nothing and starts refusing
  // at around ten concurrent, which costs more time than the patience saves.
  for (let i = 0; i < cells.length; i += 2) {
    const batch = cells.slice(i, i + 2)
    const got = await Promise.all(batch.map(async cell => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { return await attractionsInCell(cell) } catch { await pause(1200 * (attempt + 1)) }
      }
      console.warn(`  cell ${cell.key} gave up after three tries`)
      return []
    }))

    for (const poi of got.flat()) {
      rows.set(poi.id, {
        id: poi.id, name: poi.n, descr: poi.d, category: poi.k,
        image_file: poi.f, lng: poi.x, lat: poi.y, headline: isHeadline(poi.k),
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

if (dryRun) {
  console.log(`

Dry run: ${total} attractions found. Nothing was written anywhere.`)
} else {
  const { count } = await db.from('attractions').select('id', { count: 'exact', head: true })
  console.log(`\nDone. ${total} rows written this run; ${count} attractions in the table.`)
}
