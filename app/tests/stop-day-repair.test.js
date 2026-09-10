import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { dayIsoOf, tripDays } from '../src/trip-days-core.ts'

/* Migration 025 repairs the days that were typed before there was a date
   picker, and it has to say the same thing in SQL that trip-days-core.ts says
   in JavaScript. Two implementations of one rule is the thing that rots, so
   this is the check that they agree on the day it matters.

   The contract is deliberately one-sided. Where the migration decides, it must
   decide what JavaScript would have decided — a stop moved to a day nobody put
   it on is the failure that matters, and it is silent. Where the migration
   declines, it must leave the text exactly as it found it: the client's
   resolver is still there at read time and will place what it can. So the
   migration is allowed to be more cautious than the client, and never bolder.

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
  await client.query(await migration('026_repair_days_on_undated_trips.sql'))
  const after = await client.query('select day from stops order by day nulls last')
  return { client, after: after.rows.map(row => row.day) }
}

test('the repair never moves a stop to a day JavaScript would not', {
  skip: unreachable,
}, async t => {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  await schema(client)
  const trip = await client.query(
    'insert into trips(starts_on,ends_on) values($1,$2) returning id',
    [TRIP.startsOn, TRIP.endsOn],
  )
  const before = new Map()
  for (const day of WRITTEN) {
    const row = await client.query('insert into stops(trip_id,day) values($1,$2) returning id', [
      trip.rows[0].id,
      day,
    ])
    before.set(row.rows[0].id, day)
  }

  await client.query(await migration('025_repair_stop_days.sql'))

  const after = await client.query('select id, day from stops')
  for (const row of after.rows) {
    const was = before.get(row.id)
    if (row.day === was) continue
    if (was === 'all' || was === 'all-days') {
      assert.equal(row.day, null, `the sentinel is not a day: ${was}`)
      continue
    }
    /* It changed, so it must have changed to what the client reads that text
       as. This is the assertion that matters: a wrong answer here silently
       moves somebody's stop to a day they never put it on. */
    assert.equal(
      row.day,
      dayIsoOf(was, TRIP),
      `SQL and JavaScript disagree about ${JSON.stringify(was)}`,
    )
  }
})

test('every kind of bad day comes out as the date it meant', { skip: unreachable }, async t => {
  const { after } = await repaired(t, WRITTEN)
  const dates = after.filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day))
  const kept = after.filter(day => day && !/^\d{4}-\d{2}-\d{2}$/.test(day))

  // '3', 'Thu 3 Sep' -> the 3rd. '4', 'Fri 4 Sep', 'Tue 4 Sep', 'Sep 4',
  // '4 September', 'September 4', '2026-09-04' and its timestamp -> the 4th.
  assert.equal(dates.filter(day => day === '2026-09-03').length, 2)
  assert.equal(dates.filter(day => day === '2026-09-04').length, 8)
  assert.equal(dates.filter(day => day === '2026-09-05').length, 2)
  assert.equal(dates.filter(day => day === '2026-09-08').length, 2)

  // Words stay words; numbers outside the trip stay numbers.
  assert.deepEqual(kept.sort(), ['20', '99', 'Day one', 'later', 'tbc'].sort())
  // Both spellings of the sentinel, and the row that was already empty.
  assert.equal(after.filter(day => day === null || day === '').length, 3)
})

test('a number two months could answer to is left alone', { skip: unreachable }, async t => {
  /* August the 4th or September the 4th? Two answers is no answer, and a stop
     put on the wrong day is worse than one still showing '4'. */
  const twoMonths = { startsOn: '2026-08-01', endsOn: '2026-09-30' }
  const { after } = await repaired(t, ['4', '30'], twoMonths)
  assert.deepEqual(after.sort(), ['30', '4'], 'both months have a 4th and a 30th')
  assert.equal(dayIsoOf('4', twoMonths), null, 'and the client declines for the same reason')
  assert.equal(dayIsoOf('30', twoMonths), null)

  /* One month's worth of the same number, and it resolves. */
  const oneAnswer = { startsOn: '2026-08-28', endsOn: '2026-09-10' }
  const single = await repaired(t, ['30'], oneAnswer)
  assert.deepEqual(single.after, ['2026-08-30'])
  assert.equal(dayIsoOf('30', oneAnswer), '2026-08-30')
})

test('a trip with nothing at all to date it by keeps every day as written', {
  skip: unreachable,
}, async t => {
  /* Without a range a label carries no year and a number carries nothing, and
     with no photographs and no picked date there is nowhere to get one.
     Nothing is invented. */
  const { after } = await repaired(t, ['Fri 4 Sep', '4', 'tbc'], {})
  assert.deepEqual(after.sort(), ['4', 'Fri 4 Sep', 'tbc'])
})

test('a trip with no dates takes its year from its photographs', {
  skip: unreachable,
}, async t => {
  /* Only a title is needed to start a trip, so plenty have no dates at all —
     and those are exactly the ones with hand-typed days on them. The camera
     knows what year it was, which is all a label was ever missing. */
  const { after } = await repaired(t, ['Fri 4 Sep', '4', 'Sat 5 Sep'], {
    photos: ['2026-09-05T10:00:00.000Z'],
  })
  assert.deepEqual(after.sort(), ['2026-09-04', '2026-09-04', '2026-09-05'])
})

test('a stop somebody dated gives the rest of an undated trip its year', {
  skip: unreachable,
}, async t => {
  /* One stop picked from the calendar is as good as a photograph. */
  const { after } = await repaired(t, ['2026-09-04', 'Sat 5 Sep', '6'], {})
  assert.deepEqual(after.sort(), ['2026-09-04', '2026-09-05', '2026-09-06'])
})

test('the inferred range is the one the client would have guessed', {
  skip: unreachable,
}, async t => {
  /* The client has been placing these days at read time all along, from a
     range it guesses the same way. The migration writing down a different
     answer would be worse than writing down none. */
  const rows = ['Fri 4 Sep', '4', 'Sat 5 Sep', 'Thu 10 Sep', 'tbc']
  const { after } = await repaired(t, rows, { photos: ['2026-09-05T10:00:00.000Z'] })
  const asClientSees = tripDays(
    rows.map(day => ({ day })),
    {},
    ['2026-09-05'],
  )
  const dates = [...new Set(after.filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort()
  assert.deepEqual(
    dates,
    asClientSees.map(day => day.iso).filter(iso => /^\d{4}-/.test(iso)),
  )
})
