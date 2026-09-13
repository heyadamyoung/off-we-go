import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { privateDatabase } from './private-database.js'

/* The filing rule is proved next door against rows and against a running
   server on the memory repository. This proves the part only PostgreSQL can:
   that the batched write does what the loop above it decided, and that the
   migration which repairs the rows already in the database agrees with it.

   It is worth its own file because the re-link deliberately does not push the
   rule into SQL — the rows come out, stop-placement.js answers, and one
   statement writes back everything that changed. That statement is the piece
   with no equivalent in the memory repository, and the piece that would fail
   quietly: an array of ids and an array of stops, and any mismatch between the
   two would file photographs at each other's stops. */

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

test('the repair migration agrees with the rule that follows it', { skip: reachable }, async t => {
  /* Migration 032 files the photographs that migration 030 handed back, and it
     spells the rule out in SQL because it has to run before any of this code
     can — including the four-hundred-metre radius and the great-circle
     distance, done without PostGIS. Two implementations of one rule is exactly
     the thing that rots, so this is the check that they say the same thing on
     the day it matters:
     scatter photographs across a real spread of distances and filings, ask
     JavaScript where each belongs, then re-run the migration's own statement
     and require the same answer for every row. */
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
  const stops = []
  for (const [seq, place] of places.entries()) {
    stops.push(
      await repository.createStop(user, trip.id, { ...place, icon: 'pin', status: 'planned', seq }),
    )
  }

  /* Spread across every case the two have to agree about: on a stop, a few
     hundred metres off, either side of the old four-hundred-metre line,
     between two stops a courtyard apart, in another country — and, crucially,
     photographs with no coordinates at all, which neither may touch. */
  const scatter = []
  for (const place of places) {
    for (const metres of [0, 120, 380, 395, 405, 900]) {
      scatter.push({ lng: place.lng, lat: place.lat + metres / 111_320 })
    }
  }
  scatter.push({ lng: 4.88375, lat: 52.37505 }, { lng: 2.3522, lat: 48.8566 })
  const unplacedCount = 4
  for (let index = 0; index < unplacedCount; index++) scatter.push({})

  const made = []
  for (const [index, point] of scatter.entries()) {
    made.push(
      await repository.createPhoto(user, trip.id, {
        storagePath: `${trip.id}/agree-${index}.jpg`,
        kind: 'photo',
        status: 'ready',
        locationSource: point.lng == null ? null : 'exif',
        ...point,
        /* Filed on the way in, the way the old rule would have left them. Some
           pinned, so both halves of "leave these alone" are covered. */
        stopId: stops[index % stops.length].id,
      }),
    )
  }
  const pinned = made.filter((_, index) => index % 5 === 0)
  for (const photo of pinned) {
    await repository.updatePhoto(user, trip.id, photo.id, { stopId: photo.stopId })
  }

  // What JavaScript says, written by the code that runs from now on.
  await repository.relinkTripPhotos(user, trip.id)
  const byJavaScript = new Map(
    (await repository.listTripPhotos(user, trip.id, { limit: 500 })).photos.map(photo => [
      photo.id,
      photo.stopId,
    ]),
  )

  /* Now put the filing back the way it was and let the migration's SQL do it
     from scratch, so it is genuinely deciding rather than agreeing with what
     is already there. */
  const sql = await readFile(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'migrations',
      '032_refile_located_photos.sql',
    ),
    'utf8',
  )
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  t.after(() => client.end())
  for (const [index, photo] of made.entries()) {
    await client.query('update photos set stop_id=$1 where id=$2', [
      stops[index % stops.length].id,
      photo.id,
    ])
  }
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
  assert.deepEqual(disagreements, [], 'the migration and the rule must agree exactly')

  // And it did something in both directions, or the agreement is two empty
  // maps agreeing with each other.
  assert.ok(
    [...byJavaScript.values()].some(value => value === null),
    'nothing was handed back at all',
  )
  assert.ok([...byJavaScript.values()].some(Boolean), 'nothing was left filed')

  /* And not one coordinate moved. This is the requirement the whole thing hangs
     on: filing a photograph at an itinerary item says which item it belongs to,
     never where on earth it was. The column was never written to even when the
     bug was at its worst — the map was overruling it on the way to the screen —
     so a migration that started writing to it would be the first time anybody
     actually lost a position. */
  const points = new Map(
    (await client.query('select id, lng, lat from photos')).rows.map(row => [
      row.id,
      `${row.lng},${row.lat}`,
    ]),
  )
  const moved = []
  for (const [index, photo] of made.entries()) {
    const was = scatter[index]
    const expected = was.lng == null ? 'null,null' : `${was.lng},${was.lat}`
    if (points.get(photo.id) !== expected)
      moved.push({ id: photo.id, from: expected, to: points.get(photo.id) })
  }
  assert.deepEqual(moved, [], 'filing a photograph must never move it')
})

test('a pinned photograph is untouched by the batched re-link', { skip: reachable }, async t => {
  /* The pin is proved against the rule and against a running server next
     door. This is the part only PostgreSQL can answer: the re-link reads its
     rows straight out of the table, and a column named `stop_id` reaching a
     rule that reads `stopId` would leave every pinned row looking like it
     belonged nowhere — and rewrite it to nowhere. Aliasing is what stops
     that, and aliasing is invisible to every test that does not run SQL. */
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
  const stop = async (name, lng, lat, seq) =>
    repository.createStop(user, trip.id, { name, icon: 'pin', lng, lat, status: 'planned', seq })
  const rijks = await stop('Rijksmuseum', 4.8852, 52.36, 0)
  const centraal = await stop('Centraal', 4.9003, 52.379, 1)

  /* Three rows the rule would move if it were allowed to: one pinned at the
     wrong stop, one pinned at nothing, and one left alone as the control. */
  const atRijks = { lng: 4.8852, lat: 52.36, locationSource: 'exif' }
  const made = []
  for (let index = 0; index < 3; index++)
    made.push(
      await repository.createPhoto(user, trip.id, {
        ...atRijks,
        storagePath: `${trip.id}/pinned-${index}.jpg`,
        kind: 'photo',
        status: 'ready',
        stopId: null,
      }),
    )

  const [wrong, nowhere, control] = made
  assert.equal(
    (await repository.updatePhoto(user, trip.id, wrong.id, { stopId: centraal.id })).stopPinned,
    true,
  )
  assert.equal(
    (await repository.updatePhoto(user, trip.id, nowhere.id, { stopId: null })).stopPinned,
    true,
  )

  const report = await repository.relinkTripPhotos(user, trip.id, {})
  assert.equal(report.examined, 3)
  assert.equal(report.changed, 1, 'only the unpinned one had anywhere to go')

  const after = new Map(
    (
      await (async () => {
        const client = new pg.Client({ connectionString: databaseUrl })
        await client.connect()
        const rows = await client.query('select id, stop_id, stop_pinned from photos')
        await client.end()
        return rows
      })()
    ).rows.map(row => [row.id, row]),
  )
  assert.equal(after.get(wrong.id).stop_id, centraal.id, 'the correction held')
  assert.equal(after.get(nowhere.id).stop_id, null, 'filed at nothing on purpose')
  assert.equal(after.get(control.id).stop_id, rijks.id, 'the rule still ran on the rest')
  assert.equal(after.get(control.id).stop_pinned, false)

  // Handed back, the rule takes it again.
  await repository.updatePhoto(user, trip.id, wrong.id, { stopPinned: false })
  assert.deepEqual(await repository.relinkTripPhotos(user, trip.id, {}), {
    examined: 3,
    changed: 1,
  })
  assert.equal((await repository.findPhoto(user, trip.id, wrong.id)).stopId, rijks.id)

  /* And the same move made in bulk, which is one statement over an array of
     ids — the piece with no equivalent in the memory repository, and the one
     that would fail quietly by moving the wrong rows or none. */
  const ids = made.map(photo => photo.id)
  const bulk = await repository.movePhotosToStop(user, trip.id, ids, { stopId: centraal.id })
  assert.equal(bulk.moved, 3)
  assert.ok(bulk.photos.every(photo => photo.stopId === centraal.id && photo.stopPinned))

  // Ids from elsewhere are named but not this trip's, so nothing happens.
  const elsewhere = await repository.createTrip(user, { title: 'Elsewhere' })
  assert.deepEqual(await repository.movePhotosToStop(user, elsewhere.id, ids, { stopId: null }), {
    moved: 0,
    photos: [],
  })
  assert.ok(
    (await repository.findPhotos(user, trip.id, ids)).every(photo => photo.stopId === centraal.id),
    'a trip in the path is a boundary, not a hint',
  )

  // A stop that is not this trip's is refused outright rather than written.
  assert.equal(
    await repository.movePhotosToStop(user, trip.id, ids, { stopId: elsewhere.id }),
    null,
  )
  assert.equal((await repository.relinkTripPhotos(user, trip.id, {})).changed, 0, 'all pinned')
})
