import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

async function signedInApp() {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  return { app, repository, authorization: await authenticate(repository, 'owner@example.com') }
}

test('your own profile answers with the settings page needs, not just a name', async () => {
  const { app, authorization } = await signedInApp()
  const response = await app.inject({ method: 'GET', url: '/api/profile', headers: { authorization } })

  assert.equal(response.statusCode, 200)
  const profile = response.json()
  assert.equal(profile.email, 'owner@example.com')
  assert.equal(profile.homePlace, null)
  assert.equal(profile.homeLat, null)
  assert.equal(profile.timeZone, null)
  assert.deepEqual(profile.preferences, {})
  await app.close()
})

test('a home base is saved as a name and a coordinate together', async () => {
  const { app, authorization } = await signedInApp()
  const saved = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { homePlace: 'Regina, Saskatchewan', homeLat: 50.45, homeLng: -104.6 },
  })

  assert.equal(saved.statusCode, 200)
  assert.deepEqual(
    { place: saved.json().homePlace, lat: saved.json().homeLat, lng: saved.json().homeLng },
    { place: 'Regina, Saskatchewan', lat: 50.45, lng: -104.6 },
  )
  await app.close()
})

test('half a coordinate is refused rather than stored as a place nobody can plot', async () => {
  const { app, authorization } = await signedInApp()
  const half = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { homePlace: 'Somewhere', homeLat: 50.45 },
  })
  assert.equal(half.statusCode, 400)

  const offWorld = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { homeLat: 950, homeLng: 12 },
  })
  assert.equal(offWorld.statusCode, 400)
  await app.close()
})

test('a home base can be cleared once it has been set', async () => {
  const { app, authorization } = await signedInApp()
  await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { homePlace: 'Regina', homeLat: 50.45, homeLng: -104.6 },
  })
  const cleared = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { homePlace: '', homeLat: null, homeLng: null },
  })
  assert.equal(cleared.statusCode, 200)
  assert.equal(cleared.json().homePlace, null)
  assert.equal(cleared.json().homeLat, null)
  await app.close()
})

test('preferences are merged, so saving one card does not blank another', async () => {
  const { app, authorization } = await signedInApp()
  await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { preferences: { notify: { photos: { on: false, channels: ['email'] } } } },
  })
  const second = await app.inject({
    method: 'PATCH', url: '/api/profile', headers: { authorization },
    payload: { preferences: { privacy: { discoverable: 'nobody' } } },
  })

  assert.equal(second.statusCode, 200)
  assert.deepEqual(second.json().preferences, {
    notify: { photos: { on: false, channels: ['email'] } },
    privacy: { discoverable: 'nobody' },
  })
  await app.close()
})

test('preferences must be an object, not whatever a caller feels like sending', async () => {
  const { app, authorization } = await signedInApp()
  for (const preferences of ['everything', 42, ['push']]) {
    const response = await app.inject({
      method: 'PATCH', url: '/api/profile', headers: { authorization }, payload: { preferences },
    })
    assert.equal(response.statusCode, 400, JSON.stringify(preferences))
  }
  await app.close()
})

test('a signed-out caller gets nothing from the profile routes', async () => {
  const { app } = await signedInApp()
  assert.equal((await app.inject({ method: 'GET', url: '/api/profile' })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/api/account/archive' })).statusCode, 401)
  await app.close()
})

test('the archive carries the trips, their stops and a GPX trail, and links the photos', async () => {
  const { app, authorization } = await signedInApp()
  const trip = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization },
    payload: { title: 'Scotland 2027', crew: 'The family' },
  })
  await app.inject({
    method: 'POST', url: `/api/trips/${trip.json().id}/stops`, headers: { authorization },
    payload: { name: 'Edinburgh Castle', lng: -3.2, lat: 55.95, day: 'Mon', status: 'done' },
  })
  await app.inject({
    method: 'PUT', url: `/api/trips/${trip.json().id}/route`, headers: { authorization },
    payload: { points: [[-3.2, 55.95], [-3.19, 55.96]] },
  })

  const archive = await app.inject({
    method: 'GET', url: '/api/account/archive', headers: { authorization },
  })

  assert.equal(archive.statusCode, 200)
  assert.match(archive.headers['content-disposition'], /attachment; filename="off-we-go-\d{4}-\d\d-\d\d\.json"/)
  const body = archive.json()
  assert.equal(body.profile.email, 'owner@example.com')
  assert.equal(body.trips.length, 1)
  assert.equal(body.trips[0].stops[0].name, 'Edinburgh Castle')
  // No phone has reported, so the trail falls back to the route drawn by hand.
  assert.match(body.trips[0].gpx, /<trkpt lat="55.95" lon="-3.2">/)
  assert.match(body.trips[0].gpx, /<name>Scotland 2027<\/name>/)
  await app.close()
})

test('a trip with nothing to plot has no GPX rather than an empty track', async () => {
  const { app, authorization } = await signedInApp()
  await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization },
    payload: { title: 'Nothing yet' },
  })
  const archive = await app.inject({
    method: 'GET', url: '/api/account/archive', headers: { authorization },
  })
  assert.equal(archive.json().trips[0].gpx, null)
  await app.close()
})

test('the trip list carries the places and tallies the home globe draws from', async () => {
  const { app, authorization } = await signedInApp()
  const trip = await app.inject({
    method: 'POST', url: '/api/trips', headers: { authorization },
    payload: { title: 'Netherlands' },
  })
  await app.inject({
    method: 'POST', url: `/api/trips/${trip.json().id}/stops`, headers: { authorization },
    payload: { name: 'Utrecht', lng: 5.11, lat: 52.09, status: 'done' },
  })

  const listed = await app.inject({ method: 'GET', url: '/api/trips', headers: { authorization } })
  const row = listed.json().trips[0]
  assert.deepEqual(row.places, [{ name: 'Utrecht', lng: 5.11, lat: 52.09, status: 'done' }])
  assert.equal(row.stopCount, 1)
  assert.equal(row.photoCount, 0)
  assert.equal(row.memberCount, 1)
  await app.close()
})
