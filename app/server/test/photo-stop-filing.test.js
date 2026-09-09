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
