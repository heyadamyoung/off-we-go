import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { privateDatabase } from './private-database.js'

/* Migration 038: the far board's gate, written onto a leg as its gate by
   the watch before it knew better (see flights-watch.test.js), is put back.
   Proved here against a leg damaged the way the watch damaged it, beside
   one whose gate change was real and must be left alone, and run twice,
   because a repair that repairs a repaired row is a new kind of damage. */

const moduleUnderTest = await import('../src/postgres.js').catch(() => null)
const baseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'
const repair = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '038_the_arrival_gate_is_not_the_gate.sql',
)

let databaseUrl = baseUrl
const reachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  databaseUrl = await privateDatabase(baseUrl, 'flights')
  return false
})()

async function freshRepository(t) {
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query('drop schema public cascade; create schema public')
  await admin.end()
  const repository = await moduleUnderTest.createPostgresRepository({
    databaseUrl,
    adminEmail: 'owner@example.com',
  })
  t.after(() => repository.close())
  await repository.migrate()
  return repository
}

const PEARSON = 'gtaa-fl-prod.azureedge.net'
const DUBLIN = 'api.dublinairport.com'
const WRONG_GATE = 'AC872 has moved from gate 420 to F82.'
const WRONG_TERMINAL = 'AC872 has moved from terminal 2 to terminal 1.'
const WRONG_NOTE = `${WRONG_GATE} Toronto Pearson, 19:12.`
const REAL_NOTE = 'AC873 has moved from gate C34 to D12. Toronto Pearson, 09:00.'

async function seed(client, segmentId, events) {
  for (const [type, oldValue, newValue, text, source, at] of events) {
    await client.query(
      `insert into flight_events (segment_id, type, old_value, new_value, text, source, noted_at)
      values ($1,$2,$3,$4,$5,$6,$7)`,
      [segmentId, type, oldValue, newValue, text, source, at],
    )
  }
}

async function snapshot(client, segmentId, info, note) {
  await client.query(
    `insert into flight_snapshots (segment_id, info, fetched_at, note) values ($1,$2,$3,$4)`,
    [segmentId, JSON.stringify(info), '2026-09-17T18:12:00Z', note],
  )
}

async function state(client, segmentId) {
  const leg = await client.query(
    'select gate, gate_was, terminal, status_note from segments where id=$1',
    [segmentId],
  )
  const held = await client.query('select info, note from flight_snapshots where segment_id=$1', [
    segmentId,
  ])
  const events = await client.query(
    `select type, old_value, new_value, source from flight_events
    where segment_id=$1 order by noted_at, type`,
    [segmentId],
  )
  return { leg: leg.rows[0], snapshot: held.rows[0], events: events.rows }
}

test('the far gate the watch wrote onto a landed leg is put back, and a real gate change is left alone', {
  skip: reachable,
}, async t => {
  const repository = await freshRepository(t)
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Home' })
  const flight = {
    mode: 'flight',
    carrier: 'Air Canada',
    number: 'AC 872',
    fromName: 'Dublin',
    fromCode: 'DUB',
    toName: 'Toronto',
    toCode: 'YYZ',
    departsAt: '2026-09-17T12:05:00.000Z',
    arrivesAt: '2026-09-17T14:20:00.000Z',
  }
  /* As the watch left it: the far gate as the gate, the real one struck
     through, the far terminal, and the far gate as the news. */
  const damaged = await repository.createSegment(user, trip.id, {
    ...flight,
    gate: 'F82',
    terminal: '1',
  })
  /* A leg the other way, whose gate Pearson — its near board — really moved. */
  const real = await repository.createSegment(user, trip.id, {
    ...flight,
    number: 'AC 873',
    fromName: 'Toronto',
    fromCode: 'YYZ',
    toName: 'Dublin',
    toCode: 'DUB',
    gate: 'D12',
    terminal: '1',
  })

  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  await client.query('update segments set gate_was=$2, status_note=$3 where id=$1', [
    damaged.id,
    '420',
    WRONG_NOTE,
  ])
  await seed(client, damaged.id, [
    [
      'GateChanged',
      '415',
      '420',
      'AC872 has moved from gate 415 to 420.',
      DUBLIN,
      '2026-09-17T10:40:00Z',
    ],
    [
      'FlightDeparted',
      '2026-09-17T12:05:00.000Z',
      '2026-09-17T12:11:00.000Z',
      'AC872 has departed at 13:11.',
      DUBLIN,
      '2026-09-17T12:14:00Z',
    ],
    [
      'FlightLanded',
      '2026-09-17T14:25:00.000Z',
      '2026-09-17T14:20:00.000Z',
      'AC872 has landed at 10:20.',
      PEARSON,
      '2026-09-17T14:22:00Z',
    ],
    ['GateChanged', '420', 'F82', WRONG_GATE, PEARSON, '2026-09-17T18:12:00Z'],
    ['TerminalChanged', '2', '1', WRONG_TERMINAL, PEARSON, '2026-09-17T18:12:00Z'],
  ])
  await snapshot(
    client,
    damaged.id,
    {
      flightNumber: 'AC872',
      direction: 'arrival',
      status: 'landed',
      statusText: 'Arrived',
      gate: 'F82',
      terminal: '1',
      arrivalTerminal: '1',
      baggageBelt: '7',
      scheduledDeparture: null,
      actualDeparture: null,
      scheduledArrival: '2026-09-17T14:25:00.000Z',
      actualArrival: '2026-09-17T14:20:00.000Z',
      boardingStatus: null,
      extra: { stand: '138' },
      sources: [PEARSON],
    },
    WRONG_NOTE,
  )
  await client.query('update segments set gate_was=$2, status_note=$3 where id=$1', [
    real.id,
    'C34',
    REAL_NOTE,
  ])
  await seed(client, real.id, [
    [
      'GateChanged',
      'C34',
      'D12',
      'AC873 has moved from gate C34 to D12.',
      PEARSON,
      '2026-09-17T13:00:00Z',
    ],
  ])
  await snapshot(client, real.id, { gate: 'D12', terminal: '1', status: 'scheduled' }, REAL_NOTE)
  const untouched = await state(client, real.id)

  const sql = await readFile(repair, 'utf8')
  await client.query(sql)

  const repaired = await state(client, damaged.id)
  assert.deepEqual(repaired.leg, {
    gate: '420',
    gate_was: '415',
    terminal: '2',
    status_note: 'AC872 has landed at 10:20. Toronto Pearson, 10:22.',
  })
  assert.equal(repaired.snapshot.note, repaired.leg.status_note)
  assert.deepEqual(repaired.snapshot.info, {
    flightNumber: 'AC872',
    direction: 'arrival',
    status: 'landed',
    statusText: 'Arrived',
    gate: '420',
    terminal: '2',
    arrivalGate: 'F82',
    arrivalTerminal: '1',
    baggageBelt: '7',
    scheduledDeparture: null,
    actualDeparture: '2026-09-17T12:11:00.000Z',
    scheduledArrival: '2026-09-17T14:25:00.000Z',
    actualArrival: '2026-09-17T14:20:00.000Z',
    boardingStatus: null,
    sources: [PEARSON],
  })
  assert.deepEqual(repaired.events, [
    { type: 'GateChanged', old_value: '415', new_value: '420', source: DUBLIN },
    {
      type: 'FlightDeparted',
      old_value: '2026-09-17T12:05:00.000Z',
      new_value: '2026-09-17T12:11:00.000Z',
      source: DUBLIN,
    },
    {
      type: 'FlightLanded',
      old_value: '2026-09-17T14:25:00.000Z',
      new_value: '2026-09-17T14:20:00.000Z',
      source: PEARSON,
    },
  ])
  assert.deepEqual(await state(client, real.id), untouched)

  /* Run again, nothing is left to put back. */
  await client.query(sql)
  assert.deepEqual(await state(client, damaged.id), repaired)
  assert.deepEqual(await state(client, real.id), untouched)
})

test('a gate the traveller corrected by hand is theirs, and the far gate still leaves gate_was', {
  skip: reachable,
}, async t => {
  const repository = await freshRepository(t)
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Home' })
  const leg = await repository.createSegment(user, trip.id, {
    mode: 'flight',
    carrier: 'Air Canada',
    number: 'AC 872',
    fromName: 'Dublin',
    fromCode: 'DUB',
    toName: 'Toronto',
    toCode: 'YYZ',
    departsAt: '2026-09-17T12:05:00.000Z',
    arrivesAt: '2026-09-17T14:20:00.000Z',
    gate: '420',
    terminal: '2',
  })
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  /* Corrected from F82 back to 420 in the app, which slid F82 into gate_was;
     the note was retyped too, so it is not the watch's to replace. */
  await client.query('update segments set gate_was=$2, status_note=$3 where id=$1', [
    leg.id,
    'F82',
    'Gate 420, as it always was.',
  ])
  await seed(client, leg.id, [
    ['GateChanged', '420', 'F82', WRONG_GATE, PEARSON, '2026-09-17T18:12:00Z'],
  ])
  await snapshot(client, leg.id, { gate: 'F82', terminal: '2', status: 'landed' }, WRONG_NOTE)

  await client.query(await readFile(repair, 'utf8'))

  const { leg: row, snapshot: held, events } = await state(client, leg.id)
  assert.deepEqual(row, {
    gate: '420',
    gate_was: null,
    terminal: '2',
    status_note: 'Gate 420, as it always was.',
  })
  assert.deepEqual(held.info, { gate: '420', terminal: '2', status: 'landed', arrivalGate: 'F82' })
  assert.equal(held.note, WRONG_NOTE, 'the snapshot note is only the ticket note when they agree')
  assert.deepEqual(events, [])
})
