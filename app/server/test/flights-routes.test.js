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

test('the board’s word rides on the segments list, so the day face needs no second fetch', async () => {
  const sources = createFlightSources({ fetch: boards().fetch, http: boards().fetch })
  const { app, repository } = await serve(sources)
  const owner = await authenticate(repository, 'owner@example.com')
  const ownerUser = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(ownerUser, { title: 'Home for the wedding' })
  const created = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
    body: {
      mode: 'flight',
      carrier: 'Aer Lingus',
      number: 'EI 123',
      fromName: 'Dublin',
      fromCode: 'DUB',
      toName: 'Toronto',
      toCode: 'YYZ',
      departsAt: '2026-09-17T21:55:00.000Z',
      arrivesAt: '2026-09-18T05:55:00.000Z',
    },
  })
  const segment = created.json()
  const before = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
  })
  assert.equal(before.json().segments[0].flight, null)

  await repository.saveFlightSnapshot(segment.id, {
    info: {
      flightNumber: 'EI123',
      status: 'scheduled',
      statusText: 'ON SCHEDULE',
      gate: '406',
      terminal: '2',
      sources: ['api.dublinairport.com'],
      extra: {
        checkinZone: '15',
        checkinDeskRange: '1501-1520',
        walkMinutes: 12,
        securityWaitMinutes: 9,
      },
    },
    fetchedAt: '2026-09-17T18:40:00.000Z',
  })
  const after = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
  })
  const flight = after.json().segments[0].flight
  assert.equal(flight.gate, '406')
  assert.equal(flight.checkinZone, '15')
  assert.equal(flight.checkinDesks, '1501-1520')
  assert.equal(flight.walkMinutes, 12)
  assert.equal(flight.securityWaitMinutes, 9)
  assert.equal(flight.fetchedAt, '2026-09-17T18:40:00.000Z')
  await app.close()
})

test('where the aircraft is, for the map, only while the leg is plausibly flying', async () => {
  const NOW = Date.parse('2026-09-14T12:00:00.000Z')
  const skyAsked = []
  const sky = async url => {
    skyAsked.push(url)
    /* The network answers for the callsign it was asked, whichever leg's. */
    const callsign = decodeURIComponent(url.split('/').pop())
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ac: [
          {
            hex: '484a9b',
            flight: `${callsign}  `,
            t: 'B789',
            alt_baro: 36000,
            gs: 471,
            track: 289,
            lat: 55.1,
            lon: -20.2,
            seen: 2,
          },
        ],
      }),
    }
  }
  const sources = createFlightSources({
    fetch: async (url, options) =>
      url.includes('adsb.lol') ? sky(url) : boards().fetch(url, options),
    http: boards().fetch,
    now: () => NOW,
  })
  const { app, repository } = await serve(sources)
  const owner = await authenticate(repository, 'owner@example.com')
  const stranger = await authenticate(repository, 'stranger@example.com')
  const ownerUser = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(ownerUser, { title: 'Calgary' })
  const make = body =>
    app
      .inject({
        method: 'POST',
        url: `/api/trips/${trip.id}/segments`,
        headers: { authorization: owner },
        body: {
          mode: 'flight',
          fromName: 'Amsterdam',
          fromCode: 'AMS',
          toName: 'Calgary',
          toCode: 'YYC',
          ...body,
        },
      })
      .then(response => response.json())
  const flying = await make({
    carrier: 'KLM',
    number: 'KL 677',
    departsAt: '2026-09-14T11:10:00.000Z',
    arrivesAt: '2026-09-14T20:00:00.000Z',
  })
  const tomorrow = await make({
    carrier: 'KLM',
    number: 'KL 681',
    departsAt: '2026-09-15T11:10:00.000Z',
    arrivesAt: '2026-09-15T20:00:00.000Z',
  })
  const nameless = await make({
    carrier: 'Someone',
    number: 'ZZ 9',
    departsAt: '2026-09-14T11:10:00.000Z',
    arrivesAt: '2026-09-14T20:00:00.000Z',
  })
  const ask = (leg, token = owner) =>
    app.inject({
      method: 'GET',
      url: `/api/trips/${trip.id}/segments/${leg.id}/position`,
      headers: { authorization: token },
    })

  const heard = await ask(flying)
  assert.equal(heard.statusCode, 200)
  assert.equal(heard.json().callsign, 'KLM677')
  assert.equal(heard.json().aircraft.lat, 55.1)
  assert.equal(heard.json().aircraft.trackDegrees, 289)
  assert.equal(heard.json().aircraft.airborne, true)
  assert.equal(heard.json().reason, null)
  assert.equal(heard.json().fetchedAt, '2026-09-14T12:00:00.000Z')
  await ask(flying)
  assert.equal(skyAsked.length, 1, 'a second phone asking within the minute shares the answer')

  /* Tomorrow's leg is not flying, so no position — but the number answered
     the sky just now, and that is what it usually flies. */
  const later = await ask(tomorrow)
  assert.equal(later.json().reason, 'not-flying')
  assert.equal(later.json().aircraft, null)
  assert.equal(later.json().usual, 'B789')
  assert.equal(skyAsked.length, 2, 'tomorrow asks the sky for the earlier rotation')
  const unknown = await ask(nameless)
  assert.equal(unknown.json().reason, 'no-callsign')
  assert.equal(skyAsked.length, 2, 'a number with no callsign never asks')

  assert.equal((await ask(flying, stranger)).statusCode, 404)
  await app.close()
})
