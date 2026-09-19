import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { privateDatabase } from './private-database.js'

/* A trip's leaving and coming-home dates through the real repository: written
   as ISO dates, read back as the same ISO dates, and changed the same way.
   pg parses a `date` column into a JavaScript Date at local midnight by
   default, whose String() starts "Fri Sep 04" — and the ten characters
   sliced from that were what the settings screen was handed. */

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
  databaseUrl = await privateDatabase(baseUrl, 'tripdates')
  return false
})()

test('a trip keeps its dates as ISO dates, in and out', { skip: reachable }, async t => {
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
  const made = await repository.createTrip(user, {
    title: 'Prairie run',
    startsOn: '2026-09-04',
    endsOn: '2026-09-06',
  })
  const listed = (await repository.listTrips(user)).find(trip => trip.id === made.id)
  assert.equal(listed.startsOn, '2026-09-04')
  assert.equal(listed.endsOn, '2026-09-06')
  const changed = await repository.updateTrip(user, made.id, { endsOn: '2026-09-07' })
  assert.equal(changed.startsOn, '2026-09-04')
  assert.equal(changed.endsOn, '2026-09-07')
  const cleared = await repository.updateTrip(user, made.id, { startsOn: null })
  assert.equal(cleared.startsOn, null)
  assert.equal(cleared.endsOn, '2026-09-07')
})
