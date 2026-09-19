import assert from 'node:assert/strict'
import test from 'node:test'
import { HOLD_AFTER_LANDING_MS, HOLD_MS } from '../src/push/card.js'
import { pushTick, sendTokenValid, signSend } from '../src/push/tick.js'
import { createMemoryRepository } from './memory-repository.js'

/* The minute-by-minute of it, against the memory repository and a sender
   that only remembers: one card per phone per leg, quiet at first, a sound
   for the gate moving, nothing for a gate that flapped and settled, nothing
   for a phone that asked to hear no more, the landing for the people at
   home, the card cleared when it is over, and a dead address dropped. */

const H = 3600_000
const M = 60_000
const DEPARTS = Date.parse('2026-09-19T17:00:00Z')
const ARRIVES = Date.parse('2026-09-19T19:25:00Z')
const SECRET = 'a-secret-long-enough-for-the-tests'
const iso = when => new Date(when).toISOString()

const board = (changes = {}) => ({
  status: 'scheduled',
  gate: 'D43',
  terminal: '1',
  scheduledDeparture: iso(DEPARTS),
  scheduledArrival: iso(ARRIVES),
  boardingStatus: null,
  baggageBelt: null,
  ...changes,
})

function rememberingSender() {
  const sent = []
  const dead = new Set()
  return {
    sent,
    dead,
    async send(subscription, payload) {
      sent.push({ endpoint: subscription.endpoint, ...payload })
      return dead.has(subscription.endpoint) ? { ok: false, gone: true, status: 410 } : { ok: true }
    },
  }
}

async function family() {
  const repository = createMemoryRepository()
  const owner = await repository.ensureUser('owner@example.com')
  const home = await repository.ensureUser('home@example.com')
  const trip = await repository.createTrip(owner, { title: 'Prairie run' })
  await repository.upsertInvite(owner, trip.id, {
    email: 'home@example.com',
    name: 'Home',
    role: 'viewer',
  })
  // Added by email, so on the trip at once: nothing to accept.
  const leg = await repository.createSegment(owner, trip.id, {
    mode: 'flight',
    carrier: 'Air Canada',
    number: 'AC 1115',
    fromCode: 'YYZ',
    fromName: 'Toronto Pearson',
    toCode: 'YQR',
    toName: 'Regina',
    departsAt: iso(DEPARTS),
    arrivesAt: iso(ARRIVES),
    departTz: 'America/Toronto',
    arriveTz: 'America/Regina',
    passengers: [{ name: 'Maya' }, { name: 'Alex' }],
    deadlines: { boardingAt: iso(DEPARTS - 40 * M) },
  })
  const phone = await repository.savePushSubscription({
    profileId: owner.id,
    endpoint: 'https://push.example/maya',
    p256dh: 'p'.repeat(24),
    auth: 'a'.repeat(24),
  })
  const sofa = await repository.savePushSubscription({
    profileId: home.id,
    endpoint: 'https://push.example/home',
    p256dh: 'p'.repeat(24),
    auth: 'a'.repeat(24),
  })
  const said = async (info, at) => {
    await repository.saveFlightSnapshot(leg.id, { info, fetchedAt: iso(at) })
    await repository.recordFlightEvents(leg.id, [{ type: 'Something', at: iso(at) }])
  }
  return { repository, trip, leg, phone, sofa, said }
}

const tick = (repository, sender, now) => pushTick({ repository, sender, secret: SECRET, now })

test('a phone is told once, quietly, and then only when the card reads differently', async () => {
  const { repository, leg, said } = await family()
  const sender = rememberingSender()
  await said(board(), DEPARTS - 3 * H)
  let stats = await tick(repository, sender, DEPARTS - 2 * H)
  assert.deepEqual([stats.sent, stats.woken], [2, 0])
  assert.equal(sender.sent.length, 2)
  const maya = sender.sent.find(one => one.endpoint.endsWith('maya'))
  const home = sender.sent.find(one => one.endpoint.endsWith('home'))
  assert.equal(maya.title, 'AC 1115 YYZ → YQR')
  assert.equal(
    home.title,
    'Maya and Alex · AC 1115 YYZ → YQR',
    'the people at home are told whose flight',
  )
  assert.equal(maya.body, 'On time · gate D43 · boarding 12:20')
  assert.equal(maya.silent, true)
  assert.equal(maya.tag, `leg-${leg.id}`)
  assert.equal(maya.url, '/trips/prairie-run?view=travel')
  assert.ok(sendTokenValid(SECRET, maya.sendId, maya.token), 'the card can speak for itself')
  assert.ok(!sendTokenValid(SECRET, maya.sendId, signSend('other', maya.sendId)))

  stats = await tick(repository, sender, DEPARTS - 2 * H + M)
  assert.equal(stats.sent, 0, 'the same card is not sent twice')

  /* The gate flaps and settles before the hold is up: nothing to tell. */
  await said(board({ gate: 'D51' }), DEPARTS - 100 * M)
  stats = await tick(repository, sender, DEPARTS - 99 * M)
  assert.equal(stats.sent, 0, 'a change is held for two minutes')
  await said(board({ gate: 'D43' }), DEPARTS - 99 * M)
  stats = await tick(repository, sender, DEPARTS - 99 * M + HOLD_MS)
  assert.equal(stats.sent, 0, 'a gate that went and came back is not news')

  /* The gate really moves: the people on the leg hear it, home is told quietly. */
  await said(board({ gate: 'D51' }), DEPARTS - 90 * M)
  stats = await tick(repository, sender, DEPARTS - 90 * M + HOLD_MS)
  assert.deepEqual([stats.sent, stats.woken], [2, 1])
  const moved = sender.sent.slice(-2)
  const loud = moved.find(one => one.endpoint.endsWith('maya'))
  const quiet = moved.find(one => one.endpoint.endsWith('home'))
  assert.deepEqual(
    [loud.silent, loud.kind, loud.body],
    [false, 'gate', 'On time · gate D51 · boarding 12:20'],
  )
  assert.deepEqual([quiet.silent, quiet.kind], [true, 'update'])
})

test('a muted phone hears nothing more, home hears the landing, the card is cleared when it is over, and a dead address is dropped', async () => {
  const { repository, leg, phone, sofa, said } = await family()
  const sender = rememberingSender()
  await said(board(), DEPARTS - 3 * H)
  await tick(repository, sender, DEPARTS - 2 * H)
  const first = sender.sent.find(one => one.endpoint.endsWith('maya'))
  assert.equal(await repository.mutePushSend(first.sendId), true)
  assert.equal(await repository.mutePushSend('00000000-0000-4000-8000-000000000000'), false)

  await said(board({ status: 'landed', actualArrival: iso(ARRIVES), baggageBelt: '2' }), ARRIVES)
  let stats = await tick(repository, sender, ARRIVES + HOLD_MS)
  assert.deepEqual([stats.sent, stats.woken], [1, 1], 'only the sofa is told, and it is woken')
  const landed = sender.sent.at(-1)
  assert.equal(landed.endpoint, 'https://push.example/home')
  assert.deepEqual([landed.kind, landed.body], ['landed', 'Landed 13:25 · baggage claim belt 2'])
  const people = await repository.pushRecipients(leg.tripId, leg.id)
  assert.equal(people.find(one => one.subscriptionId === phone).muted, true)
  assert.equal(people.find(one => one.subscriptionId === sofa).woken, 1)

  /* A quarter of an hour after landing the card goes, and so does the send. */
  stats = await tick(repository, sender, ARRIVES + HOLD_AFTER_LANDING_MS + HOLD_MS)
  assert.equal(stats.cleared, 1)
  assert.deepEqual(sender.sent.at(-1), {
    endpoint: 'https://push.example/home',
    tag: `leg-${leg.id}`,
    clear: true,
  })
  assert.equal(
    (await repository.pushRecipients(leg.tripId, leg.id)).find(one => one.subscriptionId === sofa)
      .said,
    null,
  )

  /* The push service says the address is gone: the subscription is dropped. */
  sender.dead.add('https://push.example/home')
  await said(
    board({ status: 'landed', actualArrival: iso(ARRIVES), baggageBelt: '3' }),
    ARRIVES + 2 * M,
  )
  stats = await tick(repository, sender, ARRIVES + 5 * M)
  assert.equal(stats.gone, 1)
  assert.equal(
    (await repository.pushRecipients(leg.tripId, leg.id)).some(one => one.subscriptionId === sofa),
    false,
  )
})
