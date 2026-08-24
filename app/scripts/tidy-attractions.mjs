#!/usr/bin/env node
/* ===========================================================================
   Re-judge everything already in the attractions table.

   The seeder decides what is worth a pin as it goes, using classify() in
   places.js. When that judgement improves — and it has: the first run filled
   Scotland with railway stations, generic municipal buildings and rowing clubs
   — the rows already written keep the old verdict, because an upsert refreshes
   what it is given and knows nothing about what should no longer be there.

   This re-runs the same classify() over every stored description, deletes what
   no longer qualifies, and corrects the category and headline flag on the rest.
   It reuses the app's own function rather than reimplementing the rules in SQL,
   so the two cannot drift.

     SUPABASE_URL=https://xxxx.supabase.co \
     SUPABASE_SECRET_KEY=sb_secret_... \
     node scripts/tidy-attractions.mjs [--dry-run]
   =========================================================================== */
import { createClient } from '@supabase/supabase-js'
import { classify, isHeadline } from '../src/places.js'

const dryRun = process.argv.includes('--dry-run')
const URL_ = process.env.SUPABASE_URL
const KEY_ = process.env.SUPABASE_SECRET_KEY ||
             process.env.SUPABASE_SERVICE_ROLE ||
             process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_ || !KEY_) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY.')
  process.exit(1)
}

const db = createClient(URL_, KEY_, { auth: { persistSession: false } })

const PAGE = 1000
let seen = 0, doomed = [], moved = [], from = 0

for (;;) {
  const { data: rows, error } = await db.from('attractions')
    .select('id,descr,category,headline')
    .order('id').range(from, from + PAGE - 1)
  if (error) throw new Error(error.message)
  if (!rows.length) break

  for (const row of rows) {
    const verdict = classify(row.descr)
    if (verdict.skip) { doomed.push(row.id); continue }
    if (verdict.kind !== row.category || isHeadline(verdict.kind) !== row.headline) {
      moved.push({ id: row.id, category: verdict.kind, headline: isHeadline(verdict.kind) })
    }
  }
  seen += rows.length
  from += PAGE
  if (rows.length < PAGE) break
}

console.log(`${seen} rows judged: ${doomed.length} no longer qualify, ${moved.length} change category`)

if (dryRun) {
  console.log('Dry run. Nothing was changed.')
  process.exit(0)
}

// Deleting in chunks: a delete with fifteen thousand ids in the url is not a
// request anybody wants to debug.
for (let i = 0; i < doomed.length; i += 400) {
  const { error } = await db.from('attractions').delete().in('id', doomed.slice(i, i + 400))
  if (error) throw new Error(`delete failed: ${error.message}`)
}

for (let i = 0; i < moved.length; i += 400) {
  const chunk = moved.slice(i, i + 400)
  // Fetch and re-upsert, because the not-null columns have to come along.
  const { data: full, error } = await db.from('attractions')
    .select('id,name,descr,category,image_file,lng,lat,headline,extract')
    .in('id', chunk.map(c => c.id))
  if (error) throw new Error(`select failed: ${error.message}`)
  const byId = new Map(chunk.map(c => [c.id, c]))
  const patched = full.map(r => ({ ...r, ...byId.get(r.id) }))
  const { error: wrote } = await db.from('attractions').upsert(patched, { onConflict: 'id' })
  if (wrote) throw new Error(`upsert failed: ${wrote.message}`)
}

const { count } = await db.from('attractions').select('id', { count: 'exact', head: true })
console.log(`Done. ${count} attractions remain.`)
