import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'
import { findCabin, libraryProblems, listCabins } from '../src/cabins/index.js'
import { CABINS } from '../src/cabins/library.js'

/* The airlines' cabins live on the server, keyed by airline and type, so
   the seat map draws the cabin the family is actually sitting in — which
   rows are business, where the exits are, which rows are over the wing —
   rather than a guess from the seat letters. The library has to be sound
   in every entry, the lookup has to forgive an affiliate's aircraft under
   the airline's number, and the route has to say so over HTTP. */

test('every cabin in the library is drawable', () => {
  assert.deepEqual(libraryProblems(), [])
  assert.ok(CABINS.length >= 40, `${CABINS.length} cabins on file`)
  /* The airlines this family flies are all there. */
  for (const airline of ['AC', 'QK', 'RV', 'KL', 'WA', 'TS', 'WS', 'WR', 'EI', 'PD'])
    assert.ok(
      CABINS.some(entry => entry.airline === airline),
      `${airline} has a cabin on file`,
    )
})

test('the checker catches what a typo would do', () => {
  const broken = [
    {
      airline: 'ZZ',
      family: 'B738',
      name: 'Boeing 737-800',
      seats: 186,
      cabins: [
        {
          name: 'Business',
          rows: [1, 4],
          sections: [
            ['A', 'C'],
            ['D', 'F'],
          ],
        },
        {
          name: 'Economy',
          rows: [3, 31],
          sections: [
            ['A', 'B', 'C'],
            ['D', 'E', 'I'],
          ],
        },
      ],
      exits: [1, 40],
      wing: [10, 50],
    },
  ]
  const problems = libraryProblems(broken)
  assert.ok(
    problems.some(p => /Economy rows/.test(p)),
    'overlapping rows',
  )
  assert.ok(
    problems.some(p => /books an I/.test(p)),
    'the letter nobody uses',
  )
  assert.ok(
    problems.some(p => /exit 40/.test(p)),
    'a door past the tail',
  )
  assert.ok(
    problems.some(p => /wing/.test(p)),
    'a wing past the tail',
  )
})

test('a cabin is found by the airline and the type, and under the codes that fly for it', () => {
  const kl789 = findCabin('KL', 'B789')
  assert.equal(kl789.name, 'Boeing 787-9')
  assert.deepEqual(
    kl789.cabins.map(cabin => cabin.name),
    ['World Business', 'Premium Comfort', 'Economy'],
  )
  /* Case and stray spaces are forgiven; a Jazz Dash 8 under an Air Canada
     number is Jazz's cabin. */
  assert.equal(findCabin('ac ', 'dh8d').airline, 'QK')
  assert.equal(findCabin('KL', 'E75L').airline, 'WA')
  /* A type the airline files under a sibling's code is the sibling. */
  assert.equal(findCabin('AC', 'B788').family, 'B788')
  assert.equal(findCabin('WS', 'B739').family, 'B738')
  assert.equal(findCabin('TS', 'A339').family, 'A333')
  assert.equal(findCabin('AC', 'A388'), null)
  assert.equal(findCabin('', 'B738'), null)
  assert.equal(findCabin('KL', ''), null)
  assert.ok(listCabins().find(airline => airline.code === 'KL').families.length >= 8)
})

test('the route hands the cabin over, behind a login, and says when there is none', async () => {
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com/',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const headers = { authorization: await authenticate(repository, 'owner@example.com') }
  const cold = await app.inject({ method: 'GET', url: '/api/cabins/KL/B789' })
  assert.equal(cold.statusCode, 401)
  const found = await app.inject({ method: 'GET', url: '/api/cabins/KL/B789', headers })
  assert.equal(found.statusCode, 200)
  assert.equal(found.json().cabin.family, 'B789')
  assert.match(found.headers['cache-control'], /max-age/)
  const none = await app.inject({ method: 'GET', url: '/api/cabins/KL/A388', headers })
  assert.equal(none.statusCode, 404)
  const bad = await app.inject({ method: 'GET', url: '/api/cabins/KLM/B789', headers })
  assert.equal(bad.statusCode, 400)
  const all = await app.inject({ method: 'GET', url: '/api/cabins', headers })
  assert.equal(all.statusCode, 200)
  assert.ok(all.json().airlines.some(airline => airline.code === 'AC'))
  await app.close()
})
