import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { privateDatabase } from './private-database.js'

/* The filing rule is proved next door against arrays and against a running
   server on the memory repository. This proves the part only PostgreSQL can:
   that the batched write does what the loop above it decided.

   It is worth its own file because the re-link deliberately does not push the
   arithmetic into SQL — the rows come out, stop-placement.js answers, and one
   statement writes back everything that changed. That statement is the piece
   with no equivalent in the memory repository, and the piece that would fail
   quietly: an array of ids and an array of stops, some of them null, and any
   mismatch between the two would file photographs at each other's stops. */

const moduleUnderTest = await import('../src/postgres.js').catch(() => null)
const baseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'

/* Its own database, because this file resets the schema and so does the one
   next door, and the runner runs them at the same time. See private-database. */
let databaseUrl = baseUrl
const reachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  databaseUrl = await privateDatabase(baseUrl, 'filing')
  return false
})()

test('re-filing writes every change and only the changes', { skip: reachable }, async t => {
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
  const trip = await repository.createTrip(user, { title: 'Amsterdam' })

  const rijks = await repository.createStop(user, trip.id, {
    name: 'Rijksmuseum',
    icon: 'pin',
    lng: 4.8852,
    lat: 52.36,
    status: 'planned',
    seq: 0,
  })
  const centraal = await repository.createStop(user, trip.id, {
    name: 'Centraal',
    icon: 'pin',
    lng: 4.9003,
    lat: 52.379,
    status: 'planned',
    seq: 1,
  })

  /* Enough rows that the batched write is doing real work, in three groups:
     at the museum, at the station, and nowhere near either. */
  const made = { rijks: [], centraal: [], nowhere: [] }
  for (let index = 0; index < 20; index++) {
    const spot =
      index % 3 === 0
        ? { lng: 4.8852, lat: 52.36, group: 'rijks' }
        : index % 3 === 1
          ? { lng: 4.9003, lat: 52.379, group: 'centraal' }
          : { lng: 2.3522, lat: 48.8566, group: 'nowhere' }
    const photo = await repository.createPhoto(user, trip.id, {
      storagePath: `${trip.id}/${index}.jpg`,
      kind: 'photo',
      status: 'ready',
      lng: spot.lng,
      lat: spot.lat,
      locationSource: 'exif',
      /* Deliberately filed wrong on the way in, all of them at one stop, so
         a re-link that silently did nothing could not pass this. */
      stopId: centraal.id,
    })
    made[spot.group].push(photo.id)
  }

  const first = await repository.relinkTripPhotos(user, trip.id, {})
  assert.equal(first.examined, 20)
  assert.equal(
    first.changed,
    made.rijks.length + made.nowhere.length,
    'the museum group and the Paris group both move; the station group was already right',
  )

  const read = async () => (await repository.listTripPhotos(user, trip.id, { limit: 500 })).photos
  const rows = await read()
  const filedAt = id => rows.find(row => row.id === id)?.stopId
  for (const id of made.rijks) assert.equal(filedAt(id), rijks.id, 'at the museum')
  for (const id of made.centraal) assert.equal(filedAt(id), centraal.id, 'at the station')
  for (const id of made.nowhere) assert.equal(filedAt(id), null, 'Paris belongs to neither')

  // Settled: running it again is a no-op, which is what makes it safe to call
  // on every itinerary edit rather than only when somebody remembers to.
  assert.deepEqual(await repository.relinkTripPhotos(user, trip.id, {}), {
    examined: 20,
    changed: 0,
  })

  /* And a null in the middle of the batch is a real null, not the string.
     Moving the museum away should unfile exactly its own photographs. */
  await repository.updateStop(user, trip.id, rijks.id, { lng: 5.9, lat: 51.9 })
  const moved = await repository.relinkTripPhotos(user, trip.id, {})
  assert.equal(moved.changed, made.rijks.length)
  const after = await read()
  for (const id of made.rijks) {
    assert.equal(
      after.find(row => row.id === id)?.stopId,
      null,
      'unfiled, rather than left at a stop that has moved away',
    )
  }
})

test('the one-time backfill agrees with the rule that replaced it', {
  skip: reachable,
}, async t => {
  /* Migration 024 files everything that predates server-side filing, and it
     spells the rule out in SQL because it has to run before any of this code
     can. Two implementations of one rule is exactly the thing that rots, so
     this is the check that they say the same thing on the day it matters:
     scatter photographs across a real spread of distances, ask JavaScript
     where each belongs, then re-run the migration's own statements and
     require the same answer for every row. */
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
  const trip = await repository.createTrip(user, { title: 'Agreement' })

  const places = [
    { name: 'Rijksmuseum', lng: 4.8852, lat: 52.36 },
    { name: 'Anne Frank House', lng: 4.8839, lat: 52.3752 },
    { name: 'Westerkerk', lng: 4.8836, lat: 52.3747 },
    { name: 'Centraal', lng: 4.9003, lat: 52.379 },
  ]
  for (const [seq, place] of places.entries()) {
    await repository.createStop(user, trip.id, { ...place, icon: 'pin', status: 'planned', seq })
  }

  /* Spread deliberately across the boundary: some right on a stop, some at a
     few hundred metres, some just inside and just outside 400, some between
     two stops that are a courtyard apart, and some in another country. */
  const scatter = []
  for (const place of places) {
    for (const metres of [0, 120, 380, 395, 405, 900]) {
      scatter.push({ lng: place.lng, lat: place.lat + metres / 111_320 })
      scatter.push({
        lng: place.lng + metres / (111_320 * Math.cos((place.lat * Math.PI) / 180)),
        lat: place.lat,
      })
    }
  }
  scatter.push({ lng: 4.88375, lat: 52.37505 }, { lng: 2.3522, lat: 48.8566 })

  for (const [index, point] of scatter.entries()) {
    await repository.createPhoto(user, trip.id, {
      storagePath: `${trip.id}/agree-${index}.jpg`,
      kind: 'photo',
      status: 'ready',
      locationSource: 'exif',
      ...point,
    })
  }

  // What JavaScript says, written by the code that runs from now on.
  await repository.relinkTripPhotos(user, trip.id, {})
  const byJavaScript = new Map(
    (await repository.listTripPhotos(user, trip.id, { limit: 500 })).photos.map(photo => [
      photo.id,
      photo.stopId,
    ]),
  )

  /* Now scramble the filing and let the migration's SQL do it from scratch,
     so it is genuinely deciding rather than agreeing with what is there. */
  const sql = await readFile(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'migrations',
      '024_file_existing_photos_at_stops.sql',
    ),
    'utf8',
  )
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  await client.query('update photos set stop_id = null')
  await client.query(sql)

  const bySql = new Map(
    (await client.query('select id, stop_id from photos')).rows.map(row => [row.id, row.stop_id]),
  )

  assert.equal(bySql.size, scatter.length, 'every photograph was considered')
  const disagreements = []
  for (const [id, expected] of byJavaScript) {
    if (bySql.get(id) !== expected)
      disagreements.push({ id, javascript: expected, sql: bySql.get(id) })
  }
  assert.deepEqual(disagreements, [], 'the migration and the rule must file identically')

  // And it filed something, or the agreement above is two empty maps agreeing.
  assert.ok([...byJavaScript.values()].some(Boolean), 'nothing was filed at all')
  assert.ok(
    [...byJavaScript.values()].some(value => value === null),
    'nothing was left unfiled',
  )
})
