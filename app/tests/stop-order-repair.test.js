import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { tripItems } from '../src/features/trip/model/trip-items.ts'
import { ALL_DAYS } from '../src/trip-search-core.ts'

/* Migration 033, run end to end against real SQL.

   It renumbers every trip's stops so the stored sequence reads the way the day
   does. What is checked here is the invariant it exists to establish, and the
   one it would be easy to miss: that the order it writes into the database and
   the order the app draws are the same order.

   They can disagree in a way that looks fine in SQL. The app carries an hour
   forward across the stops that name none, so a lunch nobody timed happens
   after the museum it was placed after; a migration that instead sorted the
   untimed ones to the front of the day would produce Breakfast, Lunch, Museum
   — a tidy result, a different morning, and a stored order the screen then
   contradicts. So the two are compared directly, on a trip built to contain
   every shape that has ever been in the column. */

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

/* The reported Sunday, a half-planned Monday, a day nobody timed at all, and
   one stop with no date. Every `seq: 0` here is a stop added through the API or
   the assistant, which is what put a castle from half past three in front of
   everything from that morning. */
const STOPS = [
  { name: 'Urquhart Castle', day: '2026-09-13', startsAt: '15:30', seq: 0 },
  { name: 'Eilean Donan', day: '2026-09-13', startsAt: '09:45', seq: 4 },
  { name: 'Clachan Duich', day: '2026-09-13', startsAt: '11:20', endsAt: '11:50', seq: 5 },

  { name: 'Breakfast', day: '2026-09-14', startsAt: null, seq: 0 },
  { name: 'Museum', day: '2026-09-14', startsAt: '09:30', endsAt: '12:30', seq: 1 },
  { name: 'Lunch', day: '2026-09-14', startsAt: null, seq: 2 },
  { name: 'Castle', day: '2026-09-14', startsAt: '15:30', seq: 3 },

  { name: 'Wander', day: '2026-09-15', startsAt: null, seq: 2 },
  { name: 'Wander more', day: '2026-09-15', startsAt: null, seq: 0 },

  { name: 'Someday', day: null, startsAt: null, seq: 0 },
]

async function renumbered(t) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  await client.query('drop schema if exists stop_order cascade; create schema stop_order')
  await client.query('set search_path to stop_order')
  await client.query(`create table stops(
    id uuid primary key default gen_random_uuid(),
    trip_id uuid not null,
    name text,
    day text,
    starts_at time,
    ends_at time,
    seq integer not null default 0,
    created_at timestamptz not null default now())`)

  const trip = '22222222-2222-2222-2222-222222222222'
  for (const stop of STOPS) {
    await client.query(
      'insert into stops(trip_id,name,day,starts_at,ends_at,seq) values($1,$2,$3,$4,$5,$6)',
      [trip, stop.name, stop.day, stop.startsAt, stop.endsAt ?? null, stop.seq],
    )
  }
  await client.query(
    await readFile(
      join(here, '..', 'server', 'migrations', '033_stop_order_follows_the_day.sql'),
      'utf8',
    ),
  )
  const after = await client.query(
    `select name, day, to_char(starts_at,'HH24:MI') starts_at,
            to_char(ends_at,'HH24:MI') ends_at, seq
     from stops order by seq`,
  )
  return after.rows
}

test('the stored order is the order the screen draws', { skip: unreachable }, async t => {
  const rows = await renumbered(t)
  const stops = rows.map((row, index) => ({
    id: String(index),
    name: row.name,
    day: row.day,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    seq: row.seq,
    lng: 0,
    lat: 0,
  }))
  const drawn = tripItems({ stops, photos: [], day: ALL_DAYS }).map(item => item.stop.name)

  assert.deepEqual(
    drawn,
    rows.map(row => row.name),
    'the migration and the strip must agree exactly',
  )
})

test('the reported Sunday comes out in the order it happened', { skip: unreachable }, async t => {
  const rows = await renumbered(t)
  const sunday = rows.filter(row => row.day === '2026-09-13').map(row => row.name)
  assert.deepEqual(sunday, ['Eilean Donan', 'Clachan Duich', 'Urquhart Castle'])
})

test('an hour is carried across the stops that name none', { skip: unreachable }, async t => {
  /* The one a tidier sort gets wrong. Lunch was put after the museum and stays
     there; sorting the untimed stops to the front of the day would read
     Breakfast, Lunch, Museum, Castle — nobody's morning. */
  const rows = await renumbered(t)
  const monday = rows.filter(row => row.day === '2026-09-14').map(row => row.name)
  assert.deepEqual(monday, ['Breakfast', 'Museum', 'Lunch', 'Castle'])
})

test('a day nobody timed keeps the order somebody arranged', { skip: unreachable }, async t => {
  const rows = await renumbered(t)
  const tuesday = rows.filter(row => row.day === '2026-09-15').map(row => row.name)
  assert.deepEqual(tuesday, ['Wander more', 'Wander'], 'by the sequence that was already there')
})

test('the numbers come out dense, from zero, with room to swap', { skip: unreachable }, async t => {
  /* The move arrows swap two neighbours' numbers, and `max(seq) + 1` is what a
     new stop gets — both want a run with no gaps and no duplicates. */
  const rows = await renumbered(t)
  assert.deepEqual(
    rows.map(row => row.seq),
    rows.map((_, index) => index),
  )
  assert.equal(rows.at(-1).name, 'Someday', 'and the undated stop is last')
})
