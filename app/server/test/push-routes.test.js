import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildServer } from '../src/app.js'
import { signSend } from '../src/push/tick.js'
import { authenticate } from './auth-helper.js'
import { createMemoryRepository } from './memory-repository.js'

/* Subscribing is a session's business; muting a leg and saying what became
   of a card are the card's own, with the token it carried. */

const SECRET = 'test-secret-that-is-long-enough'
const subscription = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(22) },
  userAgent: 'a phone',
}

test('a browser subscribes with its session, and the key is public', async () => {
  const repository = createMemoryRepository()
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: SECRET,
    push: { publicKey: 'BPUBLICKEY' },
  })
  const owner = await authenticate(repository, 'owner@example.com')

  const key = await app.inject({ method: 'GET', url: '/api/push/key' })
  assert.deepEqual(key.json(), { key: 'BPUBLICKEY' })

  const anonymous = await app.inject({
    method: 'PUT',
    url: '/api/push/subscriptions',
    body: subscription,
  })
  assert.equal(anonymous.statusCode, 401)
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/push/subscriptions',
    headers: { authorization: owner },
    body: subscription,
  })
  assert.equal(saved.statusCode, 204)
  const again = await app.inject({
    method: 'PUT',
    url: '/api/push/subscriptions',
    headers: { authorization: owner },
    body: subscription,
  })
  assert.equal(again.statusCode, 204, 'the same address again is the same subscription')
  const junk = await app.inject({
    method: 'PUT',
    url: '/api/push/subscriptions',
    headers: { authorization: owner },
    body: { endpoint: 'http://not-https', keys: { p256dh: 'x', auth: 'y' } },
  })
  assert.equal(junk.statusCode, 400)

  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Home' })
  const leg = await repository.createSegment(user, trip.id, {
    mode: 'flight',
    number: 'AC 1115',
    departsAt: '2026-09-19T17:00:00.000Z',
  })
  assert.equal((await repository.pushRecipients(trip.id, leg.id)).length, 1)

  const gone = await app.inject({
    method: 'DELETE',
    url: '/api/push/subscriptions',
    headers: { authorization: owner },
    body: { endpoint: subscription.endpoint },
  })
  assert.equal(gone.statusCode, 204)
  assert.equal((await repository.pushRecipients(trip.id, leg.id)).length, 0)
  await app.close()
})

test('the card mutes its leg and reports its fate with its own token, and with nothing else', async () => {
  const repository = createMemoryRepository()
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: SECRET,
  })
  const user = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(user, { title: 'Home' })
  const leg = await repository.createSegment(user, trip.id, {
    mode: 'flight',
    number: 'AC 1115',
    departsAt: '2026-09-19T17:00:00.000Z',
  })
  const phone = await repository.savePushSubscription({
    profileId: user.id,
    endpoint: 'https://push.example/abc',
    p256dh: 'p'.repeat(40),
    auth: 'a'.repeat(22),
  })
  const sendId = randomUUID()
  await repository.recordPushSend({
    id: sendId,
    subscriptionId: phone,
    segmentId: leg.id,
    kind: 'gate',
    audible: true,
  })

  const noKey = await app.inject({ method: 'GET', url: '/api/push/key' })
  assert.equal(noKey.statusCode, 404, 'no sender, no key')

  const forged = await app.inject({
    method: 'POST',
    url: `/api/push/sends/${sendId}/mute`,
    headers: { 'x-push-token': signSend('another-secret', sendId) },
  })
  assert.equal(forged.statusCode, 403)
  const muted = await app.inject({
    method: 'POST',
    url: `/api/push/sends/${sendId}/mute`,
    headers: { 'x-push-token': signSend(SECRET, sendId) },
  })
  assert.equal(muted.statusCode, 204)
  assert.equal((await repository.pushRecipients(trip.id, leg.id))[0].muted, true)

  const opened = await app.inject({
    method: 'POST',
    url: `/api/push/sends/${sendId}/outcome`,
    headers: { 'x-push-token': signSend(SECRET, sendId) },
    body: { outcome: 'opened' },
  })
  assert.equal(opened.statusCode, 204)
  const nonsense = await app.inject({
    method: 'POST',
    url: `/api/push/sends/${sendId}/outcome`,
    headers: { 'x-push-token': signSend(SECRET, sendId) },
    body: { outcome: 'eaten' },
  })
  assert.equal(nonsense.statusCode, 400)
  const [send] = repository.pushSendsSoFar()
  assert.ok(send.openedAt, 'the opening is written down')
  assert.equal(send.dismissedAt, null)
  await app.close()
})
