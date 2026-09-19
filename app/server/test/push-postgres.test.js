import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { privateDatabase } from './private-database.js'

/* The push tables through the real repository (migration 040): the key pair
   kept, a phone's address kept once however often it subscribes, the legs
   with their board and when it last changed, every phone on a trip with its
   role and what it was last told, the mute, the outcome, the dead address. */

const moduleUnderTest = await import('../src/postgres.js').catch(() => null)
const baseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'

let databaseUrl = baseUrl
const reachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  databaseUrl = await privateDatabase(baseUrl, 'push')
  return false
})()

test('the phones that asked to be told, in PostgreSQL', { skip: reachable }, async t => {
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query('drop schema public cascade; create schema public')
  await admin.end()
  const repository = await moduleUnderTest.createPostgresRepository({
    databaseUrl,
    adminEmail: 'owner@example.com',
  })
  t.after(() => repository.close())
  await repository.migrate()

  /* One key pair, whoever asks first. */
  assert.equal(await repository.pushKeys(), null)
  const keys = await repository.savePushKeys({ publicKey: 'BPUB', privateKey: 'priv' })
  assert.deepEqual(keys, { publicKey: 'BPUB', privateKey: 'priv' })
  assert.deepEqual(await repository.savePushKeys({ publicKey: 'BOTHER', privateKey: 'x' }), keys)

  const owner = await repository.ensureUser('owner@example.com')
  const home = await repository.ensureUser('home@example.com')
  const trip = await repository.createTrip(owner, { title: 'Prairie run' })
  // Added by email, so on the trip at once: nothing to accept.
  await repository.upsertInvite(owner, trip.id, {
    email: 'home@example.com',
    name: 'Home',
    role: 'viewer',
  })
  const leg = await repository.createSegment(owner, trip.id, {
    mode: 'flight',
    carrier: 'Air Canada',
    number: 'AC 1115',
    fromName: 'Toronto Pearson',
    fromCode: 'YYZ',
    toName: 'Regina',
    toCode: 'YQR',
    departsAt: '2026-09-19T17:00:00.000Z',
    arrivesAt: '2026-09-19T19:25:00.000Z',
    departTz: 'America/Toronto',
    arriveTz: 'America/Regina',
  })

  /* A phone subscribes twice: one row, the newer keys. */
  const phone = await repository.savePushSubscription({
    profileId: owner.id,
    endpoint: 'https://push.example/maya',
    p256dh: 'p1',
    auth: 'a1',
    userAgent: 'a phone',
  })
  const same = await repository.savePushSubscription({
    profileId: owner.id,
    endpoint: 'https://push.example/maya',
    p256dh: 'p2',
    auth: 'a2',
  })
  assert.equal(same, phone)
  const sofa = await repository.savePushSubscription({
    profileId: home.id,
    endpoint: 'https://push.example/home',
    p256dh: 'p3',
    auth: 'a3',
  })

  /* The legs, with the board's last word and when it last changed. */
  const NOW = Date.parse('2026-09-19T15:00:00Z')
  let legs = await repository.pushLegs({ now: NOW })
  assert.equal(legs.length, 1)
  assert.deepEqual(
    [legs[0].id, legs[0].tripSlug, legs[0].info, legs[0].changedAt, legs[0].fromCode],
    [leg.id, trip.slug, null, null, 'YYZ'],
  )
  await repository.saveFlightSnapshot(leg.id, {
    info: { status: 'scheduled', gate: 'D43' },
    fetchedAt: new Date(NOW).toISOString(),
  })
  await repository.recordFlightEvents(leg.id, [
    {
      type: 'GateChanged',
      oldValue: null,
      newValue: 'D43',
      text: 'gate',
      at: new Date(NOW).toISOString(),
    },
  ])
  legs = await repository.pushLegs({ now: NOW })
  assert.equal(legs[0].info.gate, 'D43')
  assert.equal(legs[0].changedAt, new Date(NOW).toISOString())
  assert.equal((await repository.pushLegs({ now: NOW + 48 * 3600_000 })).length, 0, 'long gone')

  /* Everybody on the trip, with their role and a blank card. */
  let people = await repository.pushRecipients(trip.id, leg.id)
  assert.deepEqual(
    people.map(one => [
      one.subscriptionId,
      one.role,
      one.said,
      one.woken,
      one.muted,
      one.wokenToday,
      one.p256dh,
    ]),
    [
      [phone, 'owner', null, 0, false, 0, 'p2'],
      [sofa, 'viewer', null, 0, false, 0, 'p3'],
    ],
  )

  /* Told, woken, muted, opened. */
  await repository.savePushCard(phone, leg.id, {
    said: { phase: 'before', body: 'On time' },
    woken: 1,
  })
  const sendId = randomUUID()
  await repository.recordPushSend({
    id: sendId,
    subscriptionId: phone,
    segmentId: leg.id,
    kind: 'gate',
    audible: true,
  })
  people = await repository.pushRecipients(trip.id, leg.id)
  assert.deepEqual(
    [people[0].said, people[0].woken, people[0].wokenToday],
    [{ phase: 'before', body: 'On time' }, 1, 1],
  )
  assert.equal(await repository.mutePushSend(sendId), true)
  assert.equal(await repository.mutePushSend(sendId), true, 'muting twice is muted')
  assert.equal(await repository.mutePushSend(randomUUID()), false)
  assert.equal((await repository.pushRecipients(trip.id, leg.id))[0].muted, true)
  assert.equal(await repository.recordPushOutcome(sendId, 'opened'), true)
  assert.equal(await repository.recordPushOutcome(randomUUID(), 'opened'), false)
  await repository.clearPushCard(phone, leg.id)
  assert.equal((await repository.pushRecipients(trip.id, leg.id))[0].said, null)

  /* A dead address goes; a failing one is left out after enough failures. */
  for (let i = 0; i < 8; i += 1) await repository.notePushFailure(sofa)
  assert.equal(
    (await repository.pushRecipients(trip.id, leg.id)).some(one => one.subscriptionId === sofa),
    false,
  )
  assert.equal(
    await repository.deletePushSubscriptionByEndpoint(home.id, 'https://push.example/maya'),
    false,
    'not theirs',
  )
  assert.equal(
    await repository.deletePushSubscriptionByEndpoint(owner.id, 'https://push.example/maya'),
    true,
  )
  await repository.deletePushSubscription(sofa)
  assert.deepEqual(await repository.pushRecipients(trip.id, leg.id), [])
})
