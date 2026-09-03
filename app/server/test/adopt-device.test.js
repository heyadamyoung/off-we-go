import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { authenticate } from './auth-helper.js'
import { createMemoryRepository } from './memory-repository.js'

/* A token is a registration: a phone posts to whichever trip minted its
   token, however faithfully its owner watches a different one — the owner's
   own phone narrated an old trip for days. What these pin: the mis-homed
   phone is visible from the trip that wants it, one call brings it over
   with its recent fixes, and nobody moves a phone between trips they
   cannot edit. */

test('a mis-homed phone is listed, adopted, and its fixes follow', async () => {
  const repository = createMemoryRepository({ allowedEmails: [] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const ownerUser = await repository.ensureUser('owner@example.com')
  const oldTrip = await repository.createTrip(ownerUser, { title: 'Last summer' })
  const newTrip = await repository.createTrip(ownerUser, { title: 'Netherlands & Scotland' })
  const phone = await repository.registerDevice(ownerUser, oldTrip.id, { name: "Adam's phone" })
  await repository.insertPosition(phone, {
    lng: -104.6,
    lat: 50.45,
    at: new Date(),
    accuracy: 10,
  })

  const listed = await app.inject({
    method: 'GET',
    url: `/api/trips/${newTrip.id}/devices/adoptable`,
    headers: { authorization: owner },
  })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json().devices.length, 1)
  assert.equal(listed.json().devices[0].tripTitle, 'Last summer')

  const adopted = await app.inject({
    method: 'POST',
    url: `/api/trips/${newTrip.id}/devices/${phone.id}/adopt`,
    headers: { authorization: owner },
  })
  assert.equal(adopted.statusCode, 200)
  assert.equal(adopted.json().movedPositions, 1, 'the recent fixes follow the phone')

  const after = await app.inject({
    method: 'GET',
    url: `/api/trips/${newTrip.id}/devices/adoptable`,
    headers: { authorization: owner },
  })
  assert.equal(after.json().devices.length, 0, 'home now; nothing left to adopt')

  const stranger = await authenticate(repository, 'stranger@example.com')
  const refused = await app.inject({
    method: 'POST',
    url: `/api/trips/${newTrip.id}/devices/${phone.id}/adopt`,
    headers: { authorization: stranger },
  })
  assert.ok([403, 404].includes(refused.statusCode), 'strangers move nothing')
  await app.close()
})
