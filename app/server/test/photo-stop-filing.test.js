import assert from 'node:assert/strict'
import test from 'node:test'
import { buildServer } from '../src/app.js'
import { authenticate } from './auth-helper.js'
import { createMemoryRepository } from './memory-repository.js'

/* The rule is unit-tested next door, against points and arrays. This is the
   part that only a running server can answer: that an upload arriving over
   HTTP comes back filed, whatever the thing that sent it believed. */

const jsonPost = (url, body, token) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

const jsonPatch = async (url, body, token) => {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  assert.equal(response.status, 200, text)
  return JSON.parse(text)
}

async function world(t, options = {}) {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: {
      async storePhoto({ tripId }) {
        return { storagePath: `${tripId}/${Math.random().toString(36).slice(2)}.jpg` }
      },
      async remove() {},
      async read() {
        return Buffer.from('image')
      },
    },
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    ...options,
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await (
    await jsonPost(`${origin}/api/trips`, { title: 'Amsterdam' }, accessToken)
  ).json()

  const stopAt = async (name, lng, lat) =>
    (await jsonPost(`${origin}/api/trips/${trip.id}/stops`, { name, lng, lat }, accessToken)).json()

  const upload = async ({ lng, lat, stopId }) => {
    const form = new FormData()
    form.set('photo', new Blob([Buffer.from('image')], { type: 'image/jpeg' }), 'IMG.jpg')
    if (lng != null) form.set('lng', String(lng))
    if (lat != null) form.set('lat', String(lat))
    if (lng != null) form.set('locationSource', 'exif')
    if (stopId !== undefined) form.set('stopId', stopId ?? '')
    const response = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: form,
    })
    // Read once: the failure message and the value are the same body.
    const body = await response.text()
    assert.equal(response.status, 201, body)
    return JSON.parse(body)
  }

  /* Read back the way the app does, so a filing that only exists in the
     database and never reaches a client would still fail these. */
  const photos = async () => {
    const response = await fetch(`${origin}/api/trips/current?t=${trip.slug}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    return (await response.json()).photos || []
  }

  const user = await repository.ensureUser('owner@example.com')
  return { origin, accessToken, trip, stopAt, upload, photos, repository, user }
}

test('a photograph taken at a stop is filed there without being told', async t => {
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  await place.stopAt('Centraal', 4.9003, 52.379)

  /* No stopId in the request at all: this is the native picker, a queued
     upload replayed later, anything talking to the API on its own terms. */
  const photo = await place.upload({ lng: 4.8852, lat: 52.36 })
  assert.equal(photo.stopId, rijks.id)
})

test('within range of two, it is filed at the nearer', async t => {
  const place = await world(t)
  const anne = await place.stopAt('Anne Frank House', 4.8839, 52.3752)
  const wester = await place.stopAt('Westerkerk', 4.8836, 52.3747)

  assert.equal((await place.upload({ lng: 4.8839, lat: 52.3752 })).stopId, anne.id)
  assert.equal((await place.upload({ lng: 4.8836, lat: 52.3747 })).stopId, wester.id)
})

test('a photograph taken nowhere near the itinerary is filed at nothing', async t => {
  const place = await world(t)
  await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  assert.equal((await place.upload({ lng: 2.3522, lat: 48.8566 })).stopId, null)
})

test('a client that says otherwise is overruled', async t => {
  /* The reason this moved off the client. An old build with a stale itinerary,
     or two clients on different radii, must not file one photograph two ways. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const centraal = await place.stopAt('Centraal', 4.9003, 52.379)

  const wrong = await place.upload({ lng: 4.8852, lat: 52.36, stopId: centraal.id })
  assert.equal(wrong.stopId, rijks.id, 'the coordinates win')

  const claimed = await place.upload({ lng: 2.3522, lat: 48.8566, stopId: rijks.id })
  assert.equal(claimed.stopId, null, 'and they win when the answer is nothing')
})

test('a photograph with no coordinates keeps what it arrived with', async t => {
  /* Nothing to decide from, so a link somebody else established stands. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  assert.equal((await place.upload({ stopId: rijks.id })).stopId, rijks.id)
  assert.equal((await place.upload({})).stopId, null)
})

test('a trip with no itinerary yet still takes photographs', async t => {
  const place = await world(t)
  assert.equal((await place.upload({ lng: 4.8852, lat: 52.36 })).stopId, null)
})

test('the radius a deployment chose is the one that is used', async t => {
  const place = await world(t, { stopRadiusMetres: 50 })
  await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  // 300m north: inside the default 400, outside the 50 this server was given.
  const photo = await place.upload({ lng: 4.8852, lat: 52.36 + 300 / 111_320 })
  assert.equal(photo.stopId, null)
})

/* Re-filing: the half that upload-time placement can never do. */

const patchStop = (origin, tripId, stopId, body, token) =>
  fetch(`${origin}/api/trips/${tripId}/stops/${stopId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

test('a stop added after the photographs collects them', async t => {
  /* The ordinary way a trip is written up: shoot first, name the places
     later. Before this, every one of these stayed filed under nothing. */
  const place = await world(t)
  const early = await place.upload({ lng: 4.8852, lat: 52.36 })
  const elsewhere = await place.upload({ lng: 2.3522, lat: 48.8566 })
  assert.equal(early.stopId, null, 'nothing to file against yet')

  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)

  const photos = await place.photos()
  assert.equal(photos.find(photo => photo.id === early.id).stopId, rijks.id)
  assert.equal(photos.find(photo => photo.id === elsewhere.id).stopId, null, 'Paris is still Paris')
})

test('a stop moved takes the right photographs with it', async t => {
  const place = await world(t)
  const stop = await place.stopAt('Somewhere', 4.8852, 52.36)
  const atTheRijks = await place.upload({ lng: 4.8852, lat: 52.36 })
  assert.equal(atTheRijks.stopId, stop.id)

  // Moved to Centraal: the photograph by the museum is no longer near it.
  const moved = await patchStop(
    place.origin,
    place.trip.id,
    stop.id,
    { lng: 4.9003, lat: 52.379 },
    place.accessToken,
  )
  assert.equal(moved.status, 200)

  const after = await place.photos()
  assert.equal(after.find(photo => photo.id === atTheRijks.id).stopId, null)
})

test('a stop deleted hands its photographs to the next nearest, not to nothing', async t => {
  /* Two stops a courtyard apart. Deleting one should not orphan pictures that
     are plainly still at the other. */
  const place = await world(t)
  const anne = await place.stopAt('Anne Frank House', 4.8839, 52.3752)
  const wester = await place.stopAt('Westerkerk', 4.8836, 52.3747)
  const photo = await place.upload({ lng: 4.8839, lat: 52.3752 })
  assert.equal(photo.stopId, anne.id)

  const gone = await fetch(`${place.origin}/api/trips/${place.trip.id}/stops/${anne.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${place.accessToken}` },
  })
  assert.equal(gone.status, 204)

  const after = await place.photos()
  assert.equal(after.find(item => item.id === photo.id).stopId, wester.id)
})

test('re-filing only touches what actually moved', async t => {
  /* It reports what it did, and a second run has nothing left to do. That is
     what makes it safe to call on every itinerary edit. */
  const place = await world(t)
  await place.upload({ lng: 4.8852, lat: 52.36 })
  await place.upload({ lng: 4.8852, lat: 52.36 })
  await place.upload({ lng: 2.3522, lat: 48.8566 })
  await place.stopAt('Rijksmuseum', 4.8852, 52.36)

  const again = await place.repository.relinkTripPhotos(place.user, place.trip.id, {})
  assert.deepEqual(again, { examined: 3, changed: 0 }, 'already settled')
})

test('a photograph with no coordinates is left alone by re-filing', async t => {
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const filed = await place.upload({ stopId: rijks.id })
  await place.stopAt('Centraal', 4.9003, 52.379)

  const after = await place.photos()
  assert.equal(after.find(photo => photo.id === filed.id).stopId, rijks.id)
})

test('a stop chosen by hand survives the itinerary changing under it', async t => {
  /* The whole reason the pin exists. A picture taken across the square from
     one thing and plainly of another gets corrected, and then somebody edits
     the itinerary — which re-files every photograph on the trip. Before the
     pin the correction lasted until that moment and then vanished, with
     nothing said. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const photo = await place.upload({ lng: 4.8852, lat: 52.36 })
  assert.equal(photo.stopId, rijks.id, 'filed by distance to begin with')

  const vanGogh = await place.stopAt('Van Gogh Museum', 4.8811, 52.3584)
  const corrected = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos/${photo.id}`,
    { stopId: vanGogh.id },
    place.accessToken,
  )
  assert.equal(corrected.stopId, vanGogh.id)
  assert.equal(corrected.stopPinned, true, 'saying where it goes is what pins it')

  // Any itinerary edit re-files the trip. This one must leave the pin alone.
  await place.stopAt('Centraal', 4.9003, 52.379)
  const after = await place.photos()
  assert.equal(after.find(item => item.id === photo.id).stopId, vanGogh.id)

  // And re-filing directly, which is the same rule with nothing in the way.
  const report = await place.repository.relinkTripPhotos(place.user, place.trip.id, {})
  assert.deepEqual(report, { examined: 1, changed: 0 })
})

test('a photograph with no coordinates can be filed by hand and stays filed', async t => {
  /* The other case people hit: anything sent over WhatsApp, a scan, a phone
     with location off. There is nothing to compute from, so a person says. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const photo = await place.upload({})
  assert.equal(photo.stopId, null)

  const filed = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos/${photo.id}`,
    { stopId: rijks.id },
    place.accessToken,
  )
  assert.equal(filed.stopId, rijks.id)

  await place.stopAt('Centraal', 4.9003, 52.379)
  assert.equal((await place.photos()).find(item => item.id === photo.id).stopId, rijks.id)
})

test('a pin can be handed back to the rule, and the rule answers straight away', async t => {
  /* An undo for a mis-tap. It has to show the rule's answer now: waiting for
     the next itinerary edit is indistinguishable from having done nothing. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const vanGogh = await place.stopAt('Van Gogh Museum', 4.8811, 52.3584)
  const photo = await place.upload({ lng: 4.8852, lat: 52.36 })

  const moved = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos/${photo.id}`,
    { stopId: vanGogh.id },
    place.accessToken,
  )
  assert.equal(moved.stopId, vanGogh.id)

  const released = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos/${photo.id}`,
    { stopPinned: false },
    place.accessToken,
  )
  assert.equal(released.stopPinned, false)
  assert.equal(released.stopId, rijks.id, 'the rule has already had its say')
})

test('a person saying a photograph belongs nowhere is also a decision', async t => {
  /* Filing it at nothing is not the same as never having been filed, and the
     distance rule must not treat it as an invitation to have another go. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const photo = await place.upload({ lng: 4.8852, lat: 52.36 })
  assert.equal(photo.stopId, rijks.id)

  const loosed = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos/${photo.id}`,
    { stopId: null },
    place.accessToken,
  )
  assert.equal(loosed.stopId, null)
  assert.equal(loosed.stopPinned, true)

  await place.stopAt('Centraal', 4.9003, 52.379)
  assert.equal((await place.photos()).find(item => item.id === photo.id).stopId, null)
})

test('a caption does not disturb where a photograph is filed', async t => {
  /* An edit that says nothing about the filing must leave it exactly as it
     was — neither pinning an automatic filing nor releasing a chosen one. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const photo = await place.upload({ lng: 4.8852, lat: 52.36 })

  const captioned = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos/${photo.id}`,
    { caption: 'the night watch' },
    place.accessToken,
  )
  assert.equal(captioned.caption, 'the night watch')
  assert.equal(captioned.stopPinned, false, 'the rule still decides this one')
  assert.equal(captioned.stopId, rijks.id)
})

test('many photographs move to a stop in one request, and stay there', async t => {
  /* The reason this is not a loop of single moves: a person correcting a
     day's pictures wants one answer, not forty, and forty requests that fail
     halfway leave a trip half-corrected with nothing to say so. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const vanGogh = await place.stopAt('Van Gogh Museum', 4.8811, 52.3584)

  const wrong = []
  for (let index = 0; index < 6; index++)
    wrong.push(await place.upload({ lng: 4.8852, lat: 52.36 }))
  const untouched = await place.upload({ lng: 4.8852, lat: 52.36 })
  assert.deepEqual(
    wrong.map(photo => photo.stopId),
    wrong.map(() => rijks.id),
  )

  const answer = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos`,
    { photoIds: wrong.map(photo => photo.id), stopId: vanGogh.id },
    place.accessToken,
  )
  assert.equal(answer.moved, 6)
  assert.ok(
    answer.photos.every(photo => photo.stopId === vanGogh.id && photo.stopPinned === true),
    'the answer says where they went',
  )
  // The pictures come back drawable, so the app need not fetch them again.
  assert.ok(answer.photos.every(photo => photo.src))

  // An itinerary edit re-files the trip, and must leave all six alone.
  await place.stopAt('Centraal', 4.9003, 52.379)
  const after = new Map((await place.photos()).map(photo => [photo.id, photo]))
  for (const photo of wrong) assert.equal(after.get(photo.id).stopId, vanGogh.id)
  assert.equal(after.get(untouched.id).stopId, rijks.id, 'nothing else moved')
})

test('photographs with nothing to go on can be filed together', async t => {
  /* The case this feature exists for: a batch that arrived without
     coordinates — sent over WhatsApp, scanned, or taken with location off —
     and so was filed nowhere by a rule with nothing to work with. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const orphans = []
  for (let index = 0; index < 4; index++) orphans.push(await place.upload({}))
  assert.ok(orphans.every(photo => photo.stopId === null))

  const answer = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos`,
    { photoIds: orphans.map(photo => photo.id), stopId: rijks.id },
    place.accessToken,
  )
  assert.equal(answer.moved, 4)

  await place.stopAt('Centraal', 4.9003, 52.379)
  const after = new Map((await place.photos()).map(photo => [photo.id, photo]))
  for (const photo of orphans) assert.equal(after.get(photo.id).stopId, rijks.id)
})

test('many pins can be handed back to the rule at once', async t => {
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const vanGogh = await place.stopAt('Van Gogh Museum', 4.8811, 52.3584)
  const photos = []
  for (let index = 0; index < 3; index++)
    photos.push(await place.upload({ lng: 4.8852, lat: 52.36 }))
  const ids = photos.map(photo => photo.id)

  await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos`,
    { photoIds: ids, stopId: vanGogh.id },
    place.accessToken,
  )
  const released = await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos`,
    { photoIds: ids, stopPinned: false },
    place.accessToken,
  )
  assert.equal(released.moved, 3)
  assert.ok(
    released.photos.every(photo => photo.stopId === rijks.id && photo.stopPinned === false),
    'the rule has already had its say, and the answer shows it',
  )
})

test('a bulk move refuses what it cannot honestly do', async t => {
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const photo = await place.upload({ lng: 4.8852, lat: 52.36 })
  const url = `${place.origin}/api/trips/${place.trip.id}/photos`
  const send = body =>
    fetch(url, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${place.accessToken}`,
      },
      body: JSON.stringify(body),
    })

  assert.equal((await send({ stopId: rijks.id })).status, 400, 'no photos named')
  assert.equal((await send({ photoIds: [], stopId: rijks.id })).status, 400, 'none named')
  assert.equal((await send({ photoIds: [photo.id] })).status, 400, 'nothing to change')
  assert.equal(
    (await send({ photoIds: ['not-an-id'], stopId: rijks.id })).status,
    400,
    "a malformed id is the caller's mistake, not a server error",
  )
  assert.equal(
    (await send({ photoIds: Array.from({ length: 501 }, () => photo.id), stopId: rijks.id }))
      .status,
    400,
    'more than a person could have selected',
  )
  assert.equal(
    (await send({ photoIds: [photo.id], stopId: '00000000-0000-4000-8000-000000009999' })).status,
    404,
    "a stop on somebody else's trip",
  )

  // And after all that, the photograph is exactly where it started.
  assert.equal((await place.photos()).find(item => item.id === photo.id).stopId, rijks.id)
})

test('a bulk move cannot reach photographs on another trip', async t => {
  /* The ids come from a client, so the trip in the path is the boundary,
     not a hint. A move that spanned trips would be a way to read one. */
  const place = await world(t)
  const rijks = await place.stopAt('Rijksmuseum', 4.8852, 52.36)
  const mine = await place.upload({})
  const other = await (
    await jsonPost(`${place.origin}/api/trips`, { title: 'Elsewhere' }, place.accessToken)
  ).json()

  const answer = await jsonPatch(
    `${place.origin}/api/trips/${other.id}/photos`,
    { photoIds: [mine.id], stopId: null },
    place.accessToken,
  )
  assert.equal(answer.moved, 0, "named, but not this trip's to move")
  assert.equal((await place.photos()).find(item => item.id === mine.id).stopId, null)
  await jsonPatch(
    `${place.origin}/api/trips/${place.trip.id}/photos`,
    { photoIds: [mine.id], stopId: rijks.id },
    place.accessToken,
  )
  assert.equal((await place.photos()).find(item => item.id === mine.id).stopId, rijks.id)
})
