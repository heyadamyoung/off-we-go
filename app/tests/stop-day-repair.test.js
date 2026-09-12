import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { dayIsoOf } from '../src/trip-days-core.ts'

/* The migrations that made a day a date, run end to end against real SQL.
 
   025 and 026 converted what people had typed before there was a picker, and
   029 finishes it: it rescues the last shape anything could still write — a
   bare number, which is what the assistant's tool sent while its `day` was
   declared an integer — and then clears everything that is still not a date.

   What is checked here is the invariant those three exist to establish, and it
   is the only one worth checking now that there is a single implementation:
   after they have run, every stored day is either nothing or a date the client
   can read. Nothing in between, because nothing downstream knows what to do
   with a value in between.

   It lives with the client tests rather than the server ones because it needs
   both halves in one process, and only this suite can load the TypeScript. */

const here = dirname(fileURLToPath(import.meta.url))
const databaseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'

const unreachable = await (async () => {
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.end()
    return false
  } catch {
    return 'no PostgreSQL to test against'
  }
})()

/* The trip in the screenshot that started all this: the first week of
   September, with chips reading THU 3 SEP | 4 | 8 | 5 | FRI 4 SEP. */
const TRIP = { startsOn: '2026-09-03', endsOn: '2026-09-10' }

const WRITTEN = [
  // Already a date, from the picker. Untouched.
  '2026-09-04',
  '2026-09-04T09:30:00.000Z',
  // The label the app writes.
  'Thu 3 Sep',
  'Fri 4 Sep',
  'Sat 5 Sep',
  // A label whose weekday is wrong for the trip — the fiction's own calendar,
  // an imported itinerary, a trip whose dates moved after it was planned.
  'Tue 4 Sep',
  'Mon 8 Sep',
  // Bare numbers: what people typed before there was anywhere to pick.
  '3',
  '4',
  '5',
  '8',
  // Written out, the ways somebody might.
  'Sep 4',
  '4 September',
  'September 4',
  // A number the trip does not reach.
  '20',
  '99',
  // The filter's sentinel, in both spellings it was ever given.
  'all',
  'all-days',
  // Somebody's own words. Kept: losing a day is worse than showing an odd one.
  'tbc',
  'later',
  'Day one',
  '',
]

/* 026 needs the tables 025 does not: photographs are where a trip with no
   dates of its own gets its year from. */
async function schema(client) {
  await client.query('drop schema if exists day_repair cascade; create schema day_repair')
  await client.query('set search_path to day_repair')
  await client.query(`create table trips(
    id uuid primary key default gen_random_uuid(), starts_on date, ends_on date)`)
  await client.query(`create table stops(
    id uuid primary key default gen_random_uuid(),
    trip_id uuid not null references trips(id), day text)`)
  await client.query(`create table photos(
    id uuid primary key default gen_random_uuid(),
    trip_id uuid not null references trips(id), taken_at timestamptz)`)
}

const migration = name => readFile(join(here, '..', 'server', 'migrations', name), 'utf8')

async function repaired(t, rows, range = TRIP) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  await schema(client)
  const trip = await client.query(
    'insert into trips(starts_on,ends_on) values($1,$2) returning id',
    [range.startsOn ?? null, range.endsOn ?? null],
  )
  for (const day of rows) {
    await client.query('insert into stops(trip_id,day) values($1,$2)', [trip.rows[0].id, day])
  }
  for (const taken of range.photos || []) {
    await client.query('insert into photos(trip_id,taken_at) values($1,$2)', [
      trip.rows[0].id,
      taken,
    ])
  }
  await client.query(await migration('025_repair_stop_days.sql'))
  await client.query(await migration('025b_neutralise_impossible_dates.sql'))
  await client.query(await migration('026_repair_days_on_undated_trips.sql'))
  await client.query(await migration('029_days_are_dates_only.sql'))
  const after = await client.query('select day from stops order by day nulls last')
  return { client, after: after.rows.map(row => row.day) }
}

test('afterwards every day is a date the client can read, or nothing at all', {
  skip: unreachable,
}, async t => {
  /* The invariant, and the whole reason 029 exists. Before it, unreadable text
     was deliberately kept — the client still had a resolver and a heading for
     it. The resolver is gone, so a row still holding 'tbc' would be a value
     nothing can read, draw or select. */
  const { after } = await repaired(t, WRITTEN)

  for (const day of after) {
    if (day === null || day === '') continue
    assert.equal(
      dayIsoOf(day),
      day,
      `a stop was left holding ${JSON.stringify(day)}, which the client cannot read`,
    )
  }
})

test('every kind of bad day comes out as the date it meant', { skip: unreachable }, async t => {
  const { after } = await repaired(t, WRITTEN)
  const dates = after.filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day))

  // '3', 'Thu 3 Sep' -> the 3rd. '4', 'Fri 4 Sep', 'Tue 4 Sep', 'Sep 4',
  // '4 September', 'September 4', '2026-09-04' and its timestamp -> the 4th.
  assert.equal(dates.filter(day => day === '2026-09-03').length, 2)
  assert.equal(dates.filter(day => day === '2026-09-04').length, 8)
  assert.equal(dates.filter(day => day === '2026-09-05').length, 2)
  assert.equal(dates.filter(day => day === '2026-09-08').length, 2)

  /* And what nothing could date is cleared rather than kept: the words, the
     numbers the trip never reaches, both spellings of the sentinel, and the
     row that was already empty. */
  assert.equal(after.filter(day => day === null || day === '').length, 8)
})

test('a number written after the first repair is still rescued', { skip: unreachable }, async t => {
  /* The assistant's damage. Its create_stop tool declared `day` an integer, so
     asked to put a stop on today it wrote a number — the exact shape 025 had
     just finished removing, arriving after 025 had run. 029 reads it the same
     way 025 would have. */
  const { after } = await repaired(t, ['10', '3'])
  assert.deepEqual(after.sort(), ['2026-09-03', '2026-09-10'])
})

test('a number two months could answer to is cleared, not guessed', {
  skip: unreachable,
}, async t => {
  /* August the 4th or September the 4th? Two answers is no answer. It used to
     be left as '4' for the client to decline at read time; now there is no
     reader, so it becomes no day — which the picker can fix in a tap. */
  const twoMonths = { startsOn: '2026-08-01', endsOn: '2026-09-30' }
  const { after } = await repaired(t, ['4', '30'], twoMonths)
  assert.deepEqual(after, [null, null], 'both months have a 4th and a 30th')

  /* One month's worth of the same number, and it resolves. */
  const oneAnswer = { startsOn: '2026-08-28', endsOn: '2026-09-10' }
  const single = await repaired(t, ['30'], oneAnswer)
  assert.deepEqual(single.after, ['2026-08-30'])
  assert.equal(dayIsoOf('2026-08-30'), '2026-08-30', 'and the client reads what was written')
})

test('a trip with nothing at all to date it by keeps no day rather than text', {
  skip: unreachable,
}, async t => {
  /* Without a range there is nowhere to get a year from, so nothing is
     invented — and nothing unreadable is left behind either. */
  const { after } = await repaired(t, ['Fri 4 Sep', '4', 'tbc'], {})
  assert.deepEqual(after, [null, null, null])
})
