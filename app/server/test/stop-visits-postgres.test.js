import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { privateDatabase } from './private-database.js'

/* The plan and what happened, in the same row.
 *
 * The rule itself is proved against fixtures in tests/stop-visits.test.js.
 * This proves the part only a database can: that a trail arriving over hours
 * ends up as two columns on a stop, that a stop already answered is not asked
 * again, and that the answer survives the deletion of the fixes it was drawn
 * from — which is the whole reason it is written down rather than worked out
 * whenever somebody opens the timeline.
 */

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
  databaseUrl = await privateDatabase(baseUrl, 'visits')
  return false
})()

const MUSEUM = { lng: 4.8852, lat: 52.36 }
const away = metres => ({ lng: MUSEUM.lng, lat: MUSEUM.lat + metres / 111_320 })

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

async function trail(repository, device, fixes) {
  for (const fix of fixes) await repository.insertPosition(device, fix)
}

test('a trail becomes an arrival and a departure on the stop', { skip: reachable }, async t => {
  const repository = await freshRepository(t)
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Amsterdam' })
  const stop = await repository.createStop(user, trip.id, {
    name: 'Rijksmuseum',
    icon: 'pin',
    status: 'planned',
    day: '2026-09-16',
    startsAt: '09:45',
    ...MUSEUM,
  })
  const device = await repository.registerDevice(user, trip.id, {
    name: 'A phone',
    slug: 'a-phone',
    timezone: 'Europe/Amsterdam',
    tokenHash: 'hash-one',
  })

  await trail(repository, device, [
    { ...away(6000), at: '2026-09-16T09:30:00Z', accuracy: 12, speed: 8 },
    { ...away(0), at: '2026-09-16T10:20:00Z', accuracy: 20, speed: 0.3 },
    { ...away(0), at: '2026-09-16T11:40:00Z', accuracy: 18, speed: 0.1 },
    { ...away(7000), at: '2026-09-16T12:10:00Z', accuracy: 15, speed: 6 },
  ])

  assert.equal(await repository.stampVisits({ tripId: trip.id }), 1)
  const [stamped] = await repository.listStops(user, trip.id)
  assert.equal(stamped.id, stop.id)
  assert.equal(new Date(stamped.arrivedAt).toISOString(), '2026-09-16T10:20:00.000Z')
  assert.equal(new Date(stamped.leftAt).toISOString(), '2026-09-16T11:40:00.000Z')
  /* The plan is untouched. The entire worth of the pair is that they are a
     different kind of fact from the clocks beside them. */
  assert.equal(stamped.startsAt, '09:45')
  /* And which clock it happened on, taken from the phone that was there. */
  assert.equal(stamped.visitZone, 'Europe/Amsterdam')
})

test('the finding outlives the evidence', { skip: reachable }, async t => {
  /* The fixes are deleted at thirty days to keep a privacy promise. A trip
     that starts forgetting the day it happened on a month after somebody gets
     home is not a trip anybody opens again. */
  const repository = await freshRepository(t)
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Amsterdam' })
  await repository.createStop(user, trip.id, {
    name: 'Rijksmuseum',
    icon: 'pin',
    status: 'planned',
    ...MUSEUM,
  })
  const device = await repository.registerDevice(user, trip.id, {
    name: 'A phone',
    slug: 'a-phone',
    timezone: 'Europe/Amsterdam',
    tokenHash: 'hash-two',
  })

  const longAgo = Date.now() - 200 * 24 * 60 * 60 * 1000
  await trail(repository, device, [
    { ...away(0), at: new Date(longAgo).toISOString(), accuracy: 20, speed: 0.2 },
    { ...away(0), at: new Date(longAgo + 60 * 60_000).toISOString(), accuracy: 20, speed: 0.2 },
    { ...away(8000), at: new Date(longAgo + 120 * 60_000).toISOString(), accuracy: 20, speed: 9 },
  ])

  await repository.stampVisits({ tripId: trip.id })
  const removed = await repository.prunePositions()
  assert.ok(removed >= 3, 'the trail should have been pruned')

  const [remembered] = await repository.listStops(user, trip.id)
  assert.ok(remembered.arrivedAt, 'the arrival went with the fixes it was drawn from')
  assert.equal(
    new Date(remembered.leftAt) - new Date(remembered.arrivedAt),
    60 * 60_000,
    'an hour at the museum, still an hour once the trail is gone',
  )
})

test('a stop already answered is not answered again', { skip: reachable }, async t => {
  /* An arrival is the first time somebody was there, and a second run of the
     job must not be able to move it. */
  const repository = await freshRepository(t)
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Amsterdam' })
  await repository.createStop(user, trip.id, {
    name: 'Rijksmuseum',
    icon: 'pin',
    status: 'planned',
    day: '2026-09-16',
    ...MUSEUM,
  })
  const device = await repository.registerDevice(user, trip.id, {
    name: 'A phone',
    slug: 'a-phone',
    timezone: 'Europe/Amsterdam',
    tokenHash: 'hash-three',
  })

  await trail(repository, device, [
    { ...away(0), at: '2026-09-16T10:20:00Z', accuracy: 20, speed: 0.2 },
    { ...away(0), at: '2026-09-16T11:40:00Z', accuracy: 20, speed: 0.2 },
    { ...away(9000), at: '2026-09-16T12:10:00Z', accuracy: 20, speed: 8 },
  ])
  assert.equal(await repository.stampVisits({ tripId: trip.id }), 1)
  /* Nothing left to find out, so nothing written — and the second call is the
     cheap one every ten minutes for the rest of the trip's life. */
  assert.equal(await repository.stampVisits({ tripId: trip.id }), 0)

  await trail(repository, device, [
    { ...away(0), at: '2026-09-16T19:00:00Z', accuracy: 20, speed: 0.2 },
    { ...away(9000), at: '2026-09-16T20:30:00Z', accuracy: 20, speed: 8 },
  ])
  assert.equal(await repository.stampVisits({ tripId: trip.id }), 0)
  const [stamped] = await repository.listStops(user, trip.id)
  assert.equal(new Date(stamped.arrivedAt).toISOString(), '2026-09-16T10:20:00.000Z')
  assert.equal(new Date(stamped.leftAt).toISOString(), '2026-09-16T11:40:00.000Z')
})

test('a stop nobody went near is left saying nothing', { skip: reachable }, async t => {
  const repository = await freshRepository(t)
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Amsterdam' })
  await repository.createStop(user, trip.id, {
    name: 'Somewhere else entirely',
    icon: 'pin',
    status: 'planned',
    day: '2026-09-16',
    lng: 2.2945,
    lat: 48.8584,
  })
  const device = await repository.registerDevice(user, trip.id, {
    name: 'A phone',
    slug: 'a-phone',
    timezone: 'Europe/Amsterdam',
    tokenHash: 'hash-four',
  })
  await trail(repository, device, [
    { ...away(0), at: '2026-09-16T10:20:00Z', accuracy: 20, speed: 0.2 },
  ])

  assert.equal(await repository.stampVisits({ tripId: trip.id }), 0)
  const [untouched] = await repository.listStops(user, trip.id)
  assert.equal(untouched.arrivedAt, null)
  assert.equal(untouched.leftAt, null)
})

test('a departure is filled in later without disturbing the arrival', {
  skip: reachable,
}, async t => {
  /* A phone that goes quiet has not left anywhere, so the arrival lands alone
     and the departure waits for a fix that proves it. */
  const repository = await freshRepository(t)
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Amsterdam' })
  await repository.createStop(user, trip.id, {
    name: 'Rijksmuseum',
    icon: 'pin',
    status: 'planned',
    day: '2026-09-16',
    ...MUSEUM,
  })
  const device = await repository.registerDevice(user, trip.id, {
    name: 'A phone',
    slug: 'a-phone',
    timezone: 'Europe/Amsterdam',
    tokenHash: 'hash-five',
  })

  await trail(repository, device, [
    { ...away(0), at: '2026-09-16T10:20:00Z', accuracy: 20, speed: 0.2 },
    { ...away(0), at: '2026-09-16T11:00:00Z', accuracy: 20, speed: 0.2 },
  ])
  await repository.stampVisits({ tripId: trip.id })
  const [halfway] = await repository.listStops(user, trip.id)
  assert.equal(new Date(halfway.arrivedAt).toISOString(), '2026-09-16T10:20:00.000Z')
  assert.equal(halfway.leftAt, null, 'nothing yet proves they went anywhere')

  await trail(repository, device, [
    { ...away(0), at: '2026-09-16T11:40:00Z', accuracy: 20, speed: 0.2 },
    { ...away(9000), at: '2026-09-16T12:10:00Z', accuracy: 20, speed: 8 },
  ])
  assert.equal(await repository.stampVisits({ tripId: trip.id }), 1)
  const [whole] = await repository.listStops(user, trip.id)
  assert.equal(new Date(whole.arrivedAt).toISOString(), '2026-09-16T10:20:00.000Z')
  assert.equal(new Date(whole.leftAt).toISOString(), '2026-09-16T11:40:00.000Z')
})
