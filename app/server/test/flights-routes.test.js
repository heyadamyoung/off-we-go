import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildServer } from '../src/app.js'
import { createFlightSources } from '../src/flights/registry.js'
import { authenticate } from './auth-helper.js'
import { createMemoryRepository } from './memory-repository.js'

/* The boards over HTTP. What these pin: every route is behind a login; an
   airport without a board is a 404 and a board that cannot be read is a 503
   that says why; a flight is found on its board; and a leg's snapshot and
   trail are the trip's members' to read and nobody else's. */

const fixture = name => readFileSync(new URL(`./fixtures/flights/${name}`, import.meta.url), 'utf8')

const boards = ({ dublin = true } = {}) => ({
  async fetch(url) {
    if (url.includes('simpleway')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          fixture(url.includes('departure') ? 'regina-departures.xml' : 'regina-arrivals.xml'),
      }
    }
    if (!dublin) return { ok: false, status: 502, json: async () => ({}) }
    return {
      ok: true,
      status: 200,
      json: async () =>
        JSON.parse(
          fixture(
            url.includes('arrivals')
              ? 'dublin-arrivals-evening.json'
              : 'dublin-departures-evening.json',
          ),
        ),
    }
  },
})

async function serve(sources) {
  const repository = createMemoryRepository()
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    flights: sources,
  })
  return { app, repository }
}

test('the airports with a board, and their health, behind a login', async () => {
  const sources = createFlightSources({
    fetch: boards().fetch,
    http: boards().fetch,
    now: () => Date.parse('2026-09-17T22:33:00.000Z'),
  })
  const { app, repository } = await serve(sources)
  const anonymous = await app.inject({ method: 'GET', url: '/api/flights/airports' })
  assert.equal(anonymous.statusCode, 401)

  const token = await authenticate(repository, 'maya@example.com')
  const response = await app.inject({
    method: 'GET',
    url: '/api/flights/airports',
    headers: { authorization: token },
  })
  assert.equal(response.statusCode, 200)
  const codes = response.json().airports.map(one => one.code)
  assert.deepEqual(codes, ['DUB', 'YQR', 'YYZ'])
  const yyz = response.json().airports.find(one => one.code === 'YYZ')
  assert.equal(yyz.configured, true)
  assert.equal(yyz.source, 'www.torontopearson.com')
  await app.close()
})

test('a board is served normalized, an unknown airport is a 404, a dead board a 503 that says why', async () => {
  const sources = createFlightSources({
    fetch: boards({ dublin: false }).fetch,
    http: boards().fetch,
    now: () => Date.parse('2026-09-17T22:33:00.000Z'),
  })
  const { app, repository } = await serve(sources)
  const token = await authenticate(repository, 'maya@example.com')
  const regina = await app.inject({
    method: 'GET',
    url: '/api/flights/yqr/arrivals',
    headers: { authorization: token },
  })
  assert.equal(regina.statusCode, 200)
  assert.equal(regina.json().airport, 'YQR')
  assert.equal(regina.json().flights.length, 39)
  assert.equal(regina.json().flights[0].source, 'yqr.simpleway.cloud')
  assert.equal(regina.json().stale, false)

  const nowhere = await app.inject({
    method: 'GET',
    url: '/api/flights/lhr/arrivals',
    headers: { authorization: token },
  })
  assert.equal(nowhere.statusCode, 404)
  const wrong = await app.inject({
    method: 'GET',
    url: '/api/flights/yqr/cargo',
    headers: { authorization: token },
  })
  assert.equal(wrong.statusCode, 404)
  const badDate = await app.inject({
    method: 'GET',
    url: '/api/flights/dub/departures?date=tomorrow',
    headers: { authorization: token },
  })
  assert.equal(badDate.statusCode, 400)

  const dead = await app.inject({
    method: 'GET',
    url: '/api/flights/dub/departures?date=2026-09-17',
    headers: { authorization: token },
  })
  assert.equal(dead.statusCode, 503)
  assert.match(dead.json().error, /answered 502/)
  await app.close()
})

test('a flight is looked up on its board, either side, or said not to be there', async () => {
  const sources = createFlightSources({
    fetch: boards().fetch,
    http: boards().fetch,
    now: () => Date.parse('2026-09-17T22:33:00.000Z'),
  })
  const { app, repository } = await serve(sources)
  const token = await authenticate(repository, 'maya@example.com')
  const headers = { authorization: token }

  const found = await app.inject({
    method: 'GET',
    url: '/api/flights/status?flight=fr%20557&airport=DUB&date=2026-09-17',
    headers,
  })
  assert.equal(found.statusCode, 200)
  assert.equal(found.json().flight.flightNumber, 'FR557')
  assert.equal(found.json().flight.direction, 'arrival', 'not on departures, found on arrivals')
  assert.equal(found.json().flight.status, 'landed')

  const departing = await app.inject({
    method: 'GET',
    url: '/api/flights/status?flight=FR457&airport=DUB&date=2026-09-17&direction=departure',
    headers,
  })
  assert.equal(departing.statusCode, 200)
  assert.equal(departing.json().flight.gate, '106')

  const missing = await app.inject({
    method: 'GET',
    url: '/api/flights/status?flight=AC872&airport=DUB&date=2026-09-17',
    headers,
  })
  assert.equal(missing.statusCode, 404)
  const nonsense = await app.inject({
    method: 'GET',
    url: '/api/flights/status?flight=872&airport=DUB',
    headers,
  })
  assert.equal(nonsense.statusCode, 400)
  const elsewhere = await app.inject({
    method: 'GET',
    url: '/api/flights/status?flight=AC872&airport=LHR',
    headers,
  })
  assert.equal(elsewhere.statusCode, 404)
  const sideways = await app.inject({
    method: 'GET',
    url: '/api/flights/status?flight=AC872&airport=DUB&direction=upwards',
    headers,
  })
  assert.equal(sideways.statusCode, 400)
  await app.close()
})

test('a leg’s snapshot and trail are the trip’s members’ to read', async () => {
  const sources = createFlightSources({ fetch: boards().fetch, http: boards().fetch })
  const { app, repository } = await serve(sources)
  const owner = await authenticate(repository, 'owner@example.com')
  const stranger = await authenticate(repository, 'stranger@example.com')
  const ownerUser = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(ownerUser, { title: 'Home for the wedding' })
  const created = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
    body: {
      mode: 'flight',
      carrier: 'Ryanair',
      number: 'FR 557',
      fromName: 'Manchester',
      fromCode: 'MAN',
      toName: 'Dublin',
      toCode: 'DUB',
      departsAt: '2026-09-17T21:55:00.000Z',
      arrivesAt: '2026-09-17T22:55:00.000Z',
    },
  })
  assert.equal(created.statusCode, 200)
  const segment = created.json()

  const empty = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments/${segment.id}/flight`,
    headers: { authorization: owner },
  })
  assert.equal(empty.statusCode, 200)
  assert.deepEqual(empty.json(), { snapshot: null, events: [] })

  await repository.saveFlightSnapshot(segment.id, {
    info: { flightNumber: 'FR557', status: 'landed' },
    fetchedAt: '2026-09-17T22:40:00.000Z',
  })
  await repository.recordFlightEvents(segment.id, [
    {
      type: 'FlightLanded',
      oldValue: null,
      newValue: '2026-09-17T22:28:00.000Z',
      text: 'FR557 has landed at 23:28.',
      source: 'api.dublinairport.com',
      at: '2026-09-17T22:40:00.000Z',
    },
  ])
  const filled = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments/${segment.id}/flight`,
    headers: { authorization: owner },
  })
  assert.equal(filled.json().snapshot.info.status, 'landed')
  assert.equal(filled.json().events.length, 1)
  assert.equal(filled.json().events[0].text, 'FR557 has landed at 23:28.')

  const refused = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments/${segment.id}/flight`,
    headers: { authorization: stranger },
  })
  assert.equal(refused.statusCode, 404)
  const nobody = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments/${segment.id}/flight`,
  })
  assert.equal(nobody.statusCode, 401)
  await app.close()
})
