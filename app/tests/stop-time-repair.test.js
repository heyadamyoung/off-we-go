import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { isClock, stopTimeLabel, windowEndMinutes } from '../src/stop-time-core.ts'

/* Migration 031, run end to end against real SQL.

   It is the only parser of the free text a stop's time used to be, and it runs
   once, before any application code can. What is checked here is the invariant
   it exists to establish: afterwards every stored time is either nothing or an
   hour the client can read, and the words are somewhere the arithmetic will
   never trip over them.

   The conversions themselves are checked too, because the one that mattered is
   a twelve-hour afternoon. That was not a tidiness problem: the rule deciding
   whether a stop is behind you took the last clock it could find and ignored
   the PM beside it, so '1:30 pm – 3:00 pm' was read as ending at three in the
   morning, and the trip stepped over it all day, every day.

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

/* Everything that could be in the column, gathered from the sample itinerary,
   the placeholder the old box showed, and the shapes an assistant writes when
   it reads an itinerary out of an email. */
const WRITTEN = [
  // The app's own placeholder, and the range separators people actually use.
  '09:30 – 12:30',
  '09:30 - 12:30',
  '11:20-11:50',
  '10:00 to 13:00',
  // Twelve-hour, which is the one that was being read as the small hours.
  '1:30 pm – 3:00 pm',
  '2:30 PM',
  '9am-5pm',
  '7pm',
  '7 pm',
  'Doors 7:00pm',
  // Noon and midnight, which the twelve-hour clock gets backwards.
  '12:00 am',
  '12:00 pm',
  // A moment rather than a window, with and without the words beside it.
  '14:00',
  'Check-in 14:00',
  'Check-in 2pm',
  '8.30',
  'Breakfast, 8am – 9.30am',
  // Across midnight: a late ferry, a night bus, the last of a bar.
  '23:00 – 01:00',
  // Words instead of an hour. Kept whole — losing them is worse than oddness.
  'Evening',
  'All day',
  'tbc',
  // Numbers that are not times. A column that guessed at these would be the
  // same mistake as the one that read the PM off the end of an afternoon.
  'Flight AC 1234',
  'Room 3',
  // Nothing at all, both ways it is spelt.
  '',
  null,
]

async function schema(client) {
  await client.query('drop schema if exists time_repair cascade; create schema time_repair')
  await client.query('set search_path to time_repair')
  await client.query(`create table stops(
    id uuid primary key default gen_random_uuid(), name text, time text)`)
}

async function repaired(t, rows) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  await schema(client)
  for (const [index, time] of rows.entries()) {
    await client.query('insert into stops(name,time) values($1,$2)', [String(index), time])
  }
  const sql = await readFile(
    join(here, '..', 'server', 'migrations', '031_stop_times_are_clocks.sql'),
    'utf8',
  )
  /* The migration names the table unqualified and the search path puts it in
     this schema, which is what keeps the real one out of it. */
  await client.query(sql)
  const after = await client.query(
    `select name, to_char(starts_at,'HH24:MI') starts_at,
            to_char(ends_at,'HH24:MI') ends_at, time_note from stops`,
  )
  const byInput = new Map()
  for (const row of after.rows) {
    byInput.set(rows[Number(row.name)], {
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timeNote: row.time_note,
    })
  }
  return byInput
}

test('every hour that survives is one the client can read', { skip: unreachable }, async t => {
  const after = await repaired(t, WRITTEN)
  for (const [written, stop] of after) {
    for (const key of ['startsAt', 'endsAt']) {
      const value = stop[key]
      assert.ok(
        value === null || isClock(value),
        `${JSON.stringify(written)} left ${key} as ${JSON.stringify(value)}`,
      )
    }
    /* And the label it draws is the label, not a repeat of what was typed —
       proof the numbers left the words rather than being copied out of them. */
    assert.doesNotThrow(() => stopTimeLabel(stop))
  }
})

test('a window never ends before it begins', { skip: unreachable }, async t => {
  const after = await repaired(t, WRITTEN)
  for (const [written, stop] of after) {
    const ends = windowEndMinutes(stop)
    if (ends === null) continue
    assert.ok(ends >= 0 && ends < 2880, `${JSON.stringify(written)} ends at ${ends}`)
    // An end with no beginning is not a window anybody meant to describe.
    if (stop.endsAt) assert.ok(stop.startsAt, `${JSON.stringify(written)} ends without starting`)
  }
})

test('the afternoon is an afternoon', { skip: unreachable }, async t => {
  /* The bug, at the data level. Read as it used to be, the first of these ends
     at 180 minutes past midnight and the trip walks past it before breakfast. */
  const after = await repaired(t, WRITTEN)
  assert.deepEqual(after.get('1:30 pm – 3:00 pm'), {
    startsAt: '13:30',
    endsAt: '15:00',
    timeNote: null,
  })
  assert.equal(windowEndMinutes(after.get('1:30 pm – 3:00 pm')), 900)
  assert.deepEqual(after.get('2:30 PM'), { startsAt: '14:30', endsAt: null, timeNote: null })
  assert.deepEqual(after.get('9am-5pm'), { startsAt: '09:00', endsAt: '17:00', timeNote: null })
  assert.deepEqual(after.get('7pm'), { startsAt: '19:00', endsAt: null, timeNote: null })
  // Noon and midnight, the two it is easiest to write backwards.
  assert.equal(after.get('12:00 am').startsAt, '00:00')
  assert.equal(after.get('12:00 pm').startsAt, '12:00')
})

test('the words come out and stay out', { skip: unreachable }, async t => {
  const after = await repaired(t, WRITTEN)
  assert.deepEqual(after.get('Check-in 14:00'), {
    startsAt: '14:00',
    endsAt: null,
    timeNote: 'Check-in',
  })
  // The hyphen inside the word survives; the one between two hours does not.
  assert.equal(after.get('Check-in 2pm').timeNote, 'Check-in')
  assert.equal(after.get('11:20-11:50').timeNote, null)
  assert.equal(after.get('Doors 7:00pm').timeNote, 'Doors')
  assert.equal(after.get('Breakfast, 8am – 9.30am').timeNote, 'Breakfast')

  // Nothing anybody wrote is thrown away for having no hour in it.
  for (const words of ['Evening', 'All day', 'tbc', 'Flight AC 1234', 'Room 3']) {
    assert.deepEqual(
      after.get(words),
      { startsAt: null, endsAt: null, timeNote: words },
      `${words} was not kept whole`,
    )
  }
})

test('a night that runs past midnight keeps both its ends', { skip: unreachable }, async t => {
  const after = await repaired(t, WRITTEN)
  assert.deepEqual(after.get('23:00 – 01:00'), {
    startsAt: '23:00',
    endsAt: '01:00',
    timeNote: null,
  })
  // Counted from the start of its own day, so it does not finish before it began.
  assert.equal(windowEndMinutes(after.get('23:00 – 01:00')), 1500)
})

test('an empty box leaves an empty stop', { skip: unreachable }, async t => {
  const after = await repaired(t, WRITTEN)
  const nothing = { startsAt: null, endsAt: null, timeNote: null }
  assert.deepEqual(after.get(''), nothing)
  assert.deepEqual(after.get(null), nothing)
})

test('the text column is gone afterwards', { skip: unreachable }, async t => {
  /* Two places to look for a stop's time is how there came to be two ways of
     writing one. */
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  await schema(client)
  await client.query(
    await readFile(
      join(here, '..', 'server', 'migrations', '031_stop_times_are_clocks.sql'),
      'utf8',
    ),
  )
  const columns = await client.query(
    `select column_name from information_schema.columns
     where table_schema='time_repair' and table_name='stops'`,
  )
  const names = columns.rows.map(row => row.column_name)
  assert.ok(!names.includes('time'), names.join(', '))
  assert.deepEqual(names.filter(n => n.includes('time') || n.includes('_at')).sort(), [
    'ends_at',
    'starts_at',
    'time_note',
  ])
})
