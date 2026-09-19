import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { privateDatabase } from './private-database.js'

/* The aircraft on a leg, through the real repository: written on creation,
   read back with the leg, changed and cleared through the same write every
   edit goes through. The in-memory repository proves the route; this proves
   the column and the two statements that carry it (migration 039). */

const moduleUnderTest = await import('../src/postgres.js').catch(() => null)
const baseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'

let databaseUrl = baseUrl
const reachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  databaseUrl = await privateDatabase(baseUrl, 'aircraft')
  return false
})()

test('a leg keeps the aircraft the booking named, and lets it go', { skip: reachable }, async t => {
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
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Home' })
  const leg = await repository.createSegment(user, trip.id, {
    mode: 'flight',
    carrier: 'Air Canada',
    number: 'AC 1115',
    fromName: 'Toronto',
    fromCode: 'YYZ',
    toName: 'Regina',
    toCode: 'YQR',
    departsAt: '2026-09-19T16:10:00.000Z',
    aircraft: 'Airbus A220-300',
    passengers: [{ name: 'Maya', seat: '3F' }],
  })
  assert.equal(leg.aircraft, 'Airbus A220-300')
  const [listed] = await repository.listSegments(user, trip.id)
  assert.equal(listed.aircraft, 'Airbus A220-300')
  /* An edit that says nothing about the aircraft leaves it; one that names
     another changes it; an emptied field clears it. */
  const moved = await repository.updateSegment(user, trip.id, leg.id, { gate: 'D43' })
  assert.equal(moved.aircraft, 'Airbus A220-300')
  assert.equal(moved.gate, 'D43')
  const other = await repository.updateSegment(user, trip.id, leg.id, { aircraft: 'DH8D' })
  assert.equal(other.aircraft, 'DH8D')
  const cleared = await repository.updateSegment(user, trip.id, leg.id, { aircraft: '' })
  assert.equal(cleared.aircraft, null)
})
