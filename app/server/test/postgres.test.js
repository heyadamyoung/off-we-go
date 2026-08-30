import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const moduleUnderTest = await import('../src/postgres.js').catch(() => null)
const databaseUrl = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'

test('PostgreSQL migrations create a repository that persists auth, trips and GPS', async t => {
  assert.ok(moduleUnderTest?.createPostgresRepository, 'the PostgreSQL repository has not been implemented')

  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query('drop schema public cascade; create schema public')
  await admin.end()

  const repository = await moduleUnderTest.createPostgresRepository({
    databaseUrl, adminEmail: 'owner@example.com',
  })
  t.after(() => repository.close())
  await repository.migrate()

  assert.equal(await repository.emailAllowed('owner@example.com'), true)
  const expiresAt = new Date('2027-01-01T00:15:00.000Z')
  await repository.createMagicToken({ hash: 'magic-hash', email: 'owner@example.com', expiresAt })
  assert.equal(
    await repository.consumeMagicToken('magic-hash', new Date('2027-01-01T00:01:00.000Z')),
    'owner@example.com',
  )
  assert.equal(await repository.consumeMagicToken('magic-hash', new Date('2027-01-01T00:02:00.000Z')), null)

  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Persistent trip', dayCount: 3 })
  const loaded = await repository.loadCurrentTrip(user, trip.slug)
  assert.equal(loaded.title, 'Persistent trip')
  assert.equal(loaded.members[0].role, 'owner')

  const device = await repository.registerDevice(user, trip.id, {
    name: 'Phone', slug: 'phone-ab12', timezone: 'America/Regina', tokenHash: 'phone-hash',
  })
  await repository.insertPosition(device, {
    lng: -104.618, lat: 50.445, at: new Date('2027-01-01T00:03:00.000Z'),
    accuracy: 5, altitude: null, speed: 1.2, heading: null, battery: 90,
  })
  const live = await repository.loadLive(user, trip.id, new Date('2027-01-01T00:00:00.000Z'))
  assert.equal(live.devices.length, 1)
  assert.equal(live.fixes.length, 1)
  assert.equal(live.fixes[0].lng, -104.618)

  const bulk = new pg.Client({ connectionString: databaseUrl })
  await bulk.connect()
  const secondDevice = await repository.registerDevice(user, trip.id, {
    name: 'Tablet', slug: 'tablet-ab12', timezone: 'America/Regina', tokenHash: 'tablet-hash',
  })
  const thirdDevice = await repository.registerDevice(user, trip.id, {
    name: 'Spare', slug: 'spare-ab12', timezone: 'America/Regina', tokenHash: 'spare-hash',
  })
  await bulk.query(`insert into positions(trip_id,device_id,lng,lat,recorded_at)
    select $1,$2,-104.6,50.4,'2027-01-02T00:00:00Z'::timestamptz + n * interval '1 second'
    from generate_series(1,20010) n`, [trip.id, device.id])
  await bulk.query(`insert into positions(trip_id,device_id,lng,lat,recorded_at)
    select $1,device_id,-104.6,50.4,'2027-01-02T00:00:00Z'::timestamptz + n * interval '1 second'
    from unnest($2::uuid[]) device_id cross join generate_series(1,2500) n`,
  [trip.id, [secondDevice.id, thirdDevice.id]])
  await bulk.end()
  const large = await repository.loadLive(user, trip.id, new Date('2027-01-01T00:00:00.000Z'))
  const perDevice = Object.groupBy(large.fixes, value => value.deviceId)
  assert.equal(perDevice[device.id].length, 6000, 'one noisy phone is bounded independently')
  assert.equal(perDevice[secondDevice.id].length, 2500)
  assert.equal(perDevice[thirdDevice.id].length, 2500)
  assert.equal(large.fixes.length, 11000, 'three phones are not truncated by one aggregate limit')

  await repository.insertPosition(secondDevice, {
    lng: -104.5, lat: 50.5, at: new Date('2027-01-03T00:00:00.000Z'),
    accuracy: 4, altitude: null, speed: 0, heading: null, battery: 80,
  })
  const delta = await repository.loadLive(user, trip.id, new Date('2027-01-01T00:00:00.000Z'), { afterId: large.cursor })
  assert.equal(delta.fixes.length, 1)
  assert.equal(delta.fixes[0].lat, 50.5)

  await repository.createPhoto(user, trip.id, {
    stopId: null, lng: -104.6, lat: 50.4, caption: 'Mine', takenAt: new Date('2027-01-02T01:00:00Z'),
    locationSource: 'trail', storagePath: `${trip.id}/mine.jpg`, thumbPath: `${trip.id}/mine.thumb.jpg`,
  })
  await repository.createSession({ hash: 'delete-session', userId: user.id, expiresAt })
  assert.deepEqual((await repository.deleteAccount(user)).sort(),
    [`${trip.id}/mine.jpg`, `${trip.id}/mine.thumb.jpg`].sort())
  assert.equal(await repository.findSession('delete-session', new Date('2027-01-01T00:01:00Z')), null)
})
