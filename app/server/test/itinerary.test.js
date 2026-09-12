import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

async function ownerHarness() {
  const sent = []
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: {
      async send(message) {
        sent.push(message)
      },
    },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const authorization = await authenticate(repository, 'owner@example.com')
  const created = await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization },
    payload: { title: 'Editable' },
  })
  return { app, authorization, trip: created.json() }
}

test('an owner can create, change and delete a stop', async () => {
  const { app, authorization, trip } = await ownerHarness()
  const created = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/stops`,
    headers: { authorization },
    payload: {
      name: 'Edinburgh Castle',
      kind: 'Castle',
      icon: 'castle',
      day: '2026-09-04',
      time: '10:00',
      lng: -3.2008,
      lat: 55.9486,
      status: 'next',
      note: 'Book ahead',
      seq: 0,
    },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().name, 'Edinburgh Castle')

  const changed = await app.inject({
    method: 'PATCH',
    url: `/api/trips/${trip.id}/stops/${created.json().id}`,
    headers: { authorization },
    payload: { note: 'Tickets booked', status: 'done' },
  })
  assert.equal(changed.statusCode, 200)
  assert.equal(changed.json().note, 'Tickets booked')

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/stops/${created.json().id}`,
    headers: { authorization },
  })
  assert.equal(removed.statusCode, 204)

  const loaded = await app.inject({
    method: 'GET',
    url: '/api/trips/current',
    headers: { authorization },
  })
  assert.deepEqual(loaded.json().stops, [])
  await app.close()
})

test('replacing a route is atomic and keeps point order', async () => {
  const { app, authorization, trip } = await ownerHarness()
  const route = [
    [-3.2, 55.94],
    [-3.1, 55.95],
    [-3.0, 55.96],
  ]
  const response = await app.inject({
    method: 'PUT',
    url: `/api/trips/${trip.id}/route`,
    headers: { authorization },
    payload: { points: route },
  })
  assert.equal(response.statusCode, 204)
  const loaded = await app.inject({
    method: 'GET',
    url: '/api/trips/current',
    headers: { authorization },
  })
  assert.deepEqual(loaded.json().route, route)
  await app.close()
})

test('a stop’s day has to be a date, on the way in and on the way through', async () => {
  /* The door. Both routes check it, because the create route used to be the
     only one that checked anything and the same values walked in through the
     PATCH side. A stop's day is a date everywhere it is read, and the only way
     to keep that true is to refuse the rest here rather than teach five
     screens to decode it. */
  const { app, authorization, trip } = await ownerHarness()
  const post = (payload, url = `/api/trips/${trip.id}/stops`) =>
    app.inject({ method: 'POST', url, headers: { authorization }, payload })

  const good = await post({ name: 'Dated', day: '2026-09-04', lng: 4.88, lat: 52.36 })
  assert.equal(good.statusCode, 201)
  assert.equal(good.json().day, '2026-09-04')

  /* Every spelling a whole migration was written to remove, plus the number an
     assistant tool declared as an integer was sending until now. */
  for (const was of ['Fri 4 Sep', '4', 10, 'Sep 4', 'tbc', 'all', '2026-02-30']) {
    const refused = await post({ name: 'Bad', day: was, lng: 4.88, lat: 52.36 })
    assert.equal(refused.statusCode, 400, `${JSON.stringify(was)} was accepted`)
  }

  // No day at all stays perfectly ordinary.
  const none = await post({ name: 'Undated', lng: 4.88, lat: 52.36 })
  assert.equal(none.statusCode, 201)
  assert.equal(none.json().day, null)
  const emptied = await post({ name: 'Cleared', day: '', lng: 4.88, lat: 52.36 })
  assert.equal(emptied.statusCode, 201)
  assert.equal(emptied.json().day, null)

  const patch = day =>
    app.inject({
      method: 'PATCH',
      url: `/api/trips/${trip.id}/stops/${good.json().id}`,
      headers: { authorization },
      payload: { day },
    })
  assert.equal((await patch('Fri 4 Sep')).statusCode, 400)
  assert.equal((await patch(10)).statusCode, 400)
  assert.equal((await patch('2026-09-06')).statusCode, 200)
  assert.equal((await patch(null)).json().day, null, 'and a day can still be taken off')
})

test('a trip’s own dates have to be dates too', async () => {
  /* The other half of the same bug. These were passed straight through to the
     repository, so 'tbc' could become a trip's startsOn — and the formatter
     that draws it went to getDate() without looking, which is where the NaN on
     the home card came from. */
  const { app, authorization, trip } = await ownerHarness()
  const patch = payload =>
    app.inject({
      method: 'PATCH',
      url: `/api/trips/${trip.id}`,
      headers: { authorization },
      payload,
    })

  assert.equal((await patch({ startsOn: '2026-09-04', endsOn: '2026-09-10' })).statusCode, 200)
  assert.equal((await patch({ startsOn: 'tbc' })).statusCode, 400)
  assert.equal((await patch({ endsOn: 10 })).statusCode, 400)
  assert.equal((await patch({ startsOn: '2026-02-30' })).statusCode, 400)
  assert.equal((await patch({ startsOn: null })).statusCode, 200, 'and a trip may have no dates')

  const made = await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization },
    payload: { title: 'Badly dated', startsOn: 'Fri 4 Sep' },
  })
  assert.equal(made.statusCode, 400)
})
