import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { consecutiveDayLegs, createValhallaRouting } from '../src/routing.js'
import { assistantPrompt } from '../src/assistant.js'
import { signAgentToken } from '../src/agent-token.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const SECRET = 'test-secret-that-is-long-enough'

test('legs pair consecutive stops of one day, in order, and skip the unroutable', () => {
  const stops = [
    { id: 'c', day: 'Day 1', lng: 3, lat: 3, seq: 2 },
    { id: 'a', day: 'Day 1', lng: 1, lat: 1, seq: 0 },
    { id: 'b', day: 'Day 1', lng: 2, lat: 2, seq: 1 },
    { id: 'd', day: 'Day 2', lng: 4, lat: 4, seq: 3 },
    { id: 'e', day: 'Day 2', lng: null, lat: 5, seq: 4 },
    { id: 'f', day: 'Day 2', lng: 6, lat: 6, seq: 5 },
  ]
  const pairs = consecutiveDayLegs(stops).map(({ from, to }) => `${from.id}>${to.id}`)
  // a>b>c within day 1; d>e and e>f dropped for the coordinate-less e; no c>d across days.
  assert.deepEqual(pairs, ['a>b', 'b>c'])
})

const answer = (time, length) => ({
  ok: true,
  json: async () => ({ trip: { summary: { time, length } } }),
})

test('a route between two points carries its decoded shape for the map', async () => {
  // Valhalla's polyline6: encode a known pair the way the engine does, and
  // the decoder must hand back the coordinates a map can draw.
  const encode = points => {
    let out = ''
    let lat = 0
    let lng = 0
    for (const [x, y] of points) {
      for (const [next, prev] of [
        [Math.round(y * 1e6), lat],
        [Math.round(x * 1e6), lng],
      ]) {
        let delta = (next - prev) << 1
        if (delta < 0) delta = ~delta
        while (delta >= 0x20) {
          out += String.fromCharCode((0x20 | (delta & 0x1f)) + 63)
          delta >>= 5
        }
        out += String.fromCharCode(delta + 63)
      }
      lat = Math.round(y * 1e6)
      lng = Math.round(x * 1e6)
    }
    return out
  }
  const way = [
    [4.8852, 52.36],
    [4.8836, 52.3607],
    [4.8811, 52.3618],
  ]
  const routing = createValhallaRouting({
    url: 'http://127.0.0.1:8002',
    fetch: async () => ({
      ok: true,
      json: async () => ({
        trip: { summary: { time: 312.4, length: 1.42 }, legs: [{ shape: encode(way) }] },
      }),
    }),
  })
  const found = await routing.routeBetween(
    { lng: 4.8852, lat: 52.36 },
    { lng: 4.8811, lat: 52.3618 },
    'pedestrian',
  )
  assert.equal(found.seconds, 312)
  assert.equal(found.meters, 1420)
  assert.equal(found.shape.length, 3)
  for (const [index, [x, y]] of way.entries()) {
    assert.ok(Math.abs(found.shape[index][0] - x) < 1e-5)
    assert.ok(Math.abs(found.shape[index][1] - y) < 1e-5)
  }
})

test('the valhalla client answers, caches answers, and never caches refusals', async () => {
  const calls = []
  let reply = answer(840.4, 5.2)
  const routing = createValhallaRouting({
    url: 'http://127.0.0.1:8002/',
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) })
      return reply
    },
  })
  const stops = [
    { id: 'a', day: 'Day 1', lng: 6.1319, lat: 49.6116, seq: 0 },
    { id: 'b', day: 'Day 1', lng: 6.1052, lat: 49.5764, seq: 1 },
  ]
  const legs = await routing.legsFor(stops, 'auto')
  assert.deepEqual(legs, [{ fromId: 'a', toId: 'b', day: 'Day 1', seconds: 840, meters: 5200 }])
  assert.equal(calls[0].url, 'http://127.0.0.1:8002/route')
  assert.equal(calls[0].body.costing, 'auto')
  assert.deepEqual(calls[0].body.locations[0], { lat: 49.6116, lon: 6.1319 })

  // Same pair again: answered from the cache, not the engine.
  await routing.legsFor(stops, 'auto')
  assert.equal(calls.length, 1)
  // A different mode is a different question.
  await routing.legsFor(stops, 'pedestrian')
  assert.equal(calls.length, 2)

  // A refusal is absent from the result and asked again next time —
  // the engine may still be building its tiles.
  reply = { ok: false, status: 400, text: async () => 'No suitable edges' }
  const refused = await routing.legsFor(
    [
      { id: 'x', day: 'D', lng: 1, lat: 1, seq: 0 },
      { id: 'y', day: 'D', lng: 2, lat: 2, seq: 1 },
    ],
    'auto',
  )
  assert.deepEqual(refused, [])
  const callsAfterRefusal = calls.length
  await routing.legsFor(
    [
      { id: 'x', day: 'D', lng: 1, lat: 1, seq: 0 },
      { id: 'y', day: 'D', lng: 2, lat: 2, seq: 1 },
    ],
    'auto',
  )
  assert.equal(calls.length, callsAfterRefusal + 1)
})

test('an unreachable engine degrades to no legs, not to an error', async () => {
  const routing = createValhallaRouting({
    url: 'http://127.0.0.1:9',
    fetch: async () => {
      throw new Error('connect ECONNREFUSED')
    },
  })
  const legs = await routing.legsFor(
    [
      { id: 'a', day: 'D', lng: 1, lat: 1, seq: 0 },
      { id: 'b', day: 'D', lng: 2, lat: 2, seq: 1 },
    ],
    'auto',
  )
  assert.deepEqual(legs, [])
})

async function routedServer({ valhallaUrl = 'http://valhalla:8002', routingFetch } = {}) {
  const repository = createMemoryRepository({
    allowedEmails: ['owner@example.com', 'stranger@example.com'],
  })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: SECRET,
    valhallaUrl,
    routingFetch,
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Legs trip' },
    })
  ).json()
  for (const [name, lng, lat, seq] of [
    ['Skógafoss', -19.51, 63.53, 0],
    ['Vík', -19.01, 63.42, 1],
  ]) {
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/stops`,
      headers: { authorization: owner },
      payload: { name, day: 'Day 1', lng, lat, seq },
    })
  }
  return { app, repository, owner, trip }
}

test('the legs endpoint knows road truth, membership, and its own absence', async () => {
  const { app, repository, owner, trip } = await routedServer({
    routingFetch: async () => answer(1380, 42.7),
  })
  const legs = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/legs`,
    headers: { authorization: owner },
  })
  assert.equal(legs.statusCode, 200)
  assert.deepEqual(
    legs.json().legs.map(leg => leg.seconds),
    [1380],
  )
  assert.equal(legs.json().mode, 'auto')

  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/trips/${trip.id}/legs` })).statusCode,
    401,
  )
  const stranger = await authenticate(repository, 'stranger@example.com')
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/trips/${trip.id}/legs`,
        headers: { authorization: stranger },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/trips/${trip.id}/legs?mode=hovercraft`,
        headers: { authorization: owner },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/health' })).json().connectors.routing,
    true,
  )
  await app.close()

  const { app: bare, owner: bareOwner, trip: bareTrip } = await routedServer({ valhallaUrl: null })
  assert.equal(
    (
      await bare.inject({
        method: 'GET',
        url: `/api/trips/${bareTrip.id}/legs`,
        headers: { authorization: bareOwner },
      })
    ).statusCode,
    503,
  )
  assert.equal(
    (await bare.inject({ method: 'GET', url: '/api/health' })).json().connectors.routing,
    false,
  )
  await bare.close()
})

test('the agent gets get_travel_times exactly when an engine exists', async () => {
  const { app, trip } = await routedServer({ routingFetch: async () => answer(600, 10) })
  const bearer = token => ({
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
  })
  const token = signAgentToken({ id: trip.ownerId, email: 'owner@example.com' }, SECRET)

  const listed = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: bearer(token),
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  assert.match(listed.body, /get_travel_times/)

  const times = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: bearer(token),
    payload: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_travel_times', arguments: { tripId: trip.id, mode: 'pedestrian' } },
    },
  })
  assert.equal(times.statusCode, 200)
  assert.match(times.body, /Skógafoss/)
  assert.match(times.body, /600/)
  await app.close()

  const { app: bare, trip: bareTrip } = await routedServer({ valhallaUrl: null })
  const bareToken = signAgentToken({ id: bareTrip.ownerId, email: 'owner@example.com' }, SECRET)
  const bareList = await bare.inject({
    method: 'POST',
    url: '/mcp',
    headers: bearer(bareToken),
    payload: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
  })
  assert.doesNotMatch(bareList.body, /get_travel_times/)
  await bare.close()
})

test('the assistant hears about travel times only when it can fetch them', () => {
  const base = {
    user: { email: 'owner@example.com' },
    trip: { title: 'T', slug: 't' },
    messages: [{ role: 'user', text: 'Can we make it?' }],
  }
  assert.match(assistantPrompt({ ...base, travelTimes: true }), /get_travel_times/)
  assert.doesNotMatch(assistantPrompt({ ...base, travelTimes: false }), /get_travel_times/)
})
