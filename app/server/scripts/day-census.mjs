#!/usr/bin/env node
/* What shape the itinerary's days are in, counted rather than assumed.
 *
 * Migrations 025 and 026 resolve every stop's day to a date where the trip
 * gives them enough to go on, and leave the rest exactly as they were. Both
 * are one-time and neither says a word about what it changed, so this is how
 * anybody finds out whether the repair actually reached the trips that needed
 * it: the same discipline as the media cutover, which reported its files, its
 * bytes and its failures rather than claiming success.
 *
 * Read-only. It counts and prints; it never writes.
 *
 * The text it prints is a census, not a dump: how many days are dates, how
 * many are still words, and the handful of spellings that are left, so that a
 * pattern nobody anticipated is visible rather than silent. No stop names, no
 * trip titles — this ends up in a deploy log.
 */
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is not set; nothing to count.')
  process.exit(64)
}

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  const { rows } = await client.query(`
    select
      count(*) filter (where day is null or btrim(day) = '') as undated,
      count(*) filter (where day ~ '^\\d{4}-\\d{2}-\\d{2}$') as dated,
      count(*) filter (where day is not null and btrim(day) <> ''
                         and day !~ '^\\d{4}-\\d{2}-\\d{2}$') as as_written,
      count(*) as total
    from stops`)
  const [shape] = rows

  /* Trips that cannot be repaired at all, so the number is not mistaken for a
     failure: no dates of their own and nothing dated to infer them from. Their
     days stay as written, and the client still places what it can at read
     time. */
  const { rows: stranded } = await client.query(`
    select count(*) as trips from trips t
    where (t.starts_on is null or t.ends_on is null)
      and not exists (select 1 from photos p where p.trip_id = t.id and p.taken_at is not null)
      and not exists (select 1 from stops s where s.trip_id = t.id and s.day ~ '^\\d{4}-\\d{2}-\\d{2}$')
      and exists (select 1 from stops s where s.trip_id = t.id
                    and s.day is not null and btrim(s.day) <> '')`)

  const { rows: leftovers } = await client.query(`
    select btrim(day) as day, count(*) as stops
    from stops
    where day is not null and btrim(day) <> '' and day !~ '^\\d{4}-\\d{2}-\\d{2}$'
    group by 1 order by 2 desc, 1 limit 12`)

  console.log(
    `Days: ${shape.dated} dated, ${shape.as_written} as written, ` +
      `${shape.undated} with no day, of ${shape.total} stops.`,
  )
  if (Number(stranded[0].trips)) {
    console.log(
      `${stranded[0].trips} trip(s) have no dates and nothing to infer them from; ` +
        'their days stay as written until somebody fills the trip dates in.',
    )
  }
  if (leftovers.length) {
    console.log('Still as written:')
    for (const row of leftovers) console.log(`  ${row.stops} × ${JSON.stringify(row.day)}`)
  }
} finally {
  await client.end()
}
