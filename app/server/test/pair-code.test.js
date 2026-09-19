import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'
import {
  isPairCode,
  makePairCode,
  normalizePairCode,
  PAIR_CODE_ALPHABET,
} from '../src/pair-code.js'

/* A phone is paired by typing six characters on it. The organiser's screen
   asks for a code; the phone types it and is handed the device's token,
   once; the code dies on use, on the quarter hour, and when a new one is
   asked for. Nobody guesses one. */

const NOW = new Date('2027-06-04T13:21:00.000Z')

async function world(clock = () => NOW) {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com/',
    sessionSecret: 'test-secret-that-is-long-enough',
    clock,
  })
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers,
      payload: { title: 'Prairie run' },
    })
  ).json()
  const device = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/devices`,
      headers,
      payload: { name: "Catherine's phone" },
    })
  ).json()
  const issue = () =>
    app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/devices/${device.id}/pair-code`,
      headers,
    })
  const claim = (code, extra = {}) =>
    app.inject({ method: 'POST', url: '/api/pair/claim', payload: { code }, ...extra })
  return { app, repository, headers, trip, device, issue, claim }
}

test('a code is six characters nobody misreads, and forgives how it was typed', () => {
  const code = makePairCode()
  assert.equal(code.length, 6)
  for (const character of code) assert.ok(PAIR_CODE_ALPHABET.includes(character), character)
  for (const banned of 'O0IL1') assert.ok(!PAIR_CODE_ALPHABET.includes(banned), banned)
  assert.equal(normalizePairCode(' k7m-4pq '), 'K7M4PQ')
  assert.equal(normalizePairCode('K7M 4PQ'), 'K7M4PQ')
  assert.equal(isPairCode('K7M4PQ'), true)
  assert.equal(isPairCode('K7M4P'), false)
  assert.equal(isPairCode(''), false)
})

test('the code hands the phone its token once, and the old token is dead', async () => {
  const { app, device, issue, claim } = await world()
  const issued = await issue()
  assert.equal(issued.statusCode, 201)
  const { code, token, expiresAt } = issued.json()
  assert.equal(code.length, 6)
  assert.equal(new Date(expiresAt).getTime(), NOW.getTime() + 15 * 60_000)
  assert.notEqual(token, device.token, 'issuing rotates the token, as New code always did')

  const claimed = await claim(` ${code.toLowerCase()} `)
  assert.equal(claimed.statusCode, 200)
  assert.deepEqual(claimed.json(), {
    endpoint: 'https://offwego.example.com/api/ingest/track',
    token,
    deviceId: device.id,
    name: "Catherine's phone",
  })

  const fix = { _type: 'location', lat: 50.45, lon: -104.6, tst: 1812115000 }
  const withNew = await app.inject({
    method: 'POST',
    url: '/api/ingest/track',
    headers: { authorization: `Bearer ${token}` },
    payload: fix,
  })
  assert.equal(withNew.statusCode, 200)
  const withOld = await app.inject({
    method: 'POST',
    url: '/api/ingest/track',
    headers: { authorization: `Bearer ${device.token}` },
    payload: fix,
  })
  assert.equal(withOld.statusCode, 401)

  const again = await claim(code)
  assert.equal(again.statusCode, 404, 'a code is spent on first use')
  await app.close()
})

test('an expired code, a wrong code and a new code all refuse', async () => {
  let now = NOW
  const { app, issue, claim } = await world(() => now)
  const first = (await issue()).json()
  const second = (await issue()).json()
  assert.equal((await claim(first.code)).statusCode, 404, 'a newer code retires the older one')

  now = new Date(NOW.getTime() + 16 * 60_000)
  assert.equal((await claim(second.code)).statusCode, 404, 'a quarter of an hour is all it lives')

  now = NOW
  const third = (await issue()).json()
  assert.equal((await claim('ABC')).statusCode, 400)
  assert.equal((await claim('ZZZZZZ')).statusCode, 404)
  assert.equal((await claim(third.code)).statusCode, 200)
  await app.close()
})

test('only somebody who can edit the trip asks for a code, and guessing is rate limited', async () => {
  const { app, repository, trip, device, claim } = await world()
  const stranger = { authorization: await authenticate(repository, 'stranger@example.com') }
  const refused = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/devices/${device.id}/pair-code`,
    headers: stranger,
  })
  assert.equal(refused.statusCode, 404)

  let last = null
  for (let attempt = 0; attempt < 11; attempt += 1) {
    last = await claim('ABCDEF', { headers: { 'cf-connecting-ip': '203.0.113.9' } })
  }
  assert.equal(last.statusCode, 429)
  assert.ok(Number(last.headers['retry-after']) >= 1)
  await app.close()
})
