import assert from 'node:assert/strict'
import test from 'node:test'
import { buildServer } from '../src/app.js'
import { watchTravelMail } from '../src/travel-watch.js'
import { authenticate } from './auth-helper.js'
import { createMemoryRepository } from './memory-repository.js'

/* The mailbox looking without being asked.
 *
 * Every one of these is about restraint rather than reach. A watch that reads
 * a mailbox on a timer only earns its place by being narrow, and the narrowness
 * has to be held to account or it is just a sentence in a comment: off unless
 * somebody asked, nothing but the leg's own strings searched for, the subject
 * kept and never the body, and one broken account not costing the others their
 * turn.
 */

const NOW = Date.parse('2026-09-19T12:00:00Z')

const leg = (rest = {}) => ({
  id: 'g1',
  carrier: 'KLM',
  number: 'KL 677',
  ref: 'R7QWXZ',
  departsAt: '2026-09-19T16:10:00.000Z',
  ...rest,
})

const mail = (rest = {}) => ({
  id: 'm1',
  subject: 'KL 677 is delayed by 90 minutes',
  preview: 'We are sorry…',
  received: '2026-09-19T11:50:00.000Z',
  from: { name: 'KLM', address: 'noreply@klm.com' },
  ...rest,
})

const store = ({ mailboxes = [], segments = [], messages = [] } = {}) => {
  const noted = []
  const seen = []
  const asked = []
  return {
    noted,
    seen,
    asked,
    async mailboxesWatchingTravel() {
      return mailboxes
    },
    async segmentsForMailbox() {
      return segments
    },
    async noteSegmentMail(connectionId, found) {
      noted.push({ connectionId, found })
      return found.length
    },
    async markTravelMailSeen(id, at) {
      seen.push({ id, at })
    },
    reader: {
      async listMessages(_userId, options) {
        asked.push(options.search)
        return { messages }
      },
    },
  }
}

test('a mailbox nobody asked to watch is never opened', () => {
  /* The whole licence for this feature. */
  const kept = store({ mailboxes: [] })
  return watchTravelMail({ repository: kept, reader: kept.reader, now: NOW }).then(result => {
    assert.deepEqual(result, { looked: 0, found: 0 })
    assert.deepEqual(kept.asked, [])
  })
})

test('it searches for the leg’s own strings and nothing broader', () => {
  /* Not "airline", not the carrier, not everything since Tuesday: the flight
     number and the booking reference the traveller typed in themselves. */
  const kept = store({
    mailboxes: [{ id: 'c1', userId: 'u1', travelSeenAt: null }],
    segments: [leg()],
    messages: [mail()],
  })
  return watchTravelMail({ repository: kept, reader: kept.reader, now: NOW }).then(() => {
    assert.deepEqual(kept.asked, ['kl677', 'klmkl677', 'r7qwxz'])
  })
})

test('what it finds is filed against the leg it is about', () => {
  const kept = store({
    mailboxes: [{ id: 'c1', userId: 'u1', travelSeenAt: null }],
    segments: [leg()],
    messages: [mail()],
  })
  return watchTravelMail({ repository: kept, reader: kept.reader, now: NOW }).then(result => {
    assert.equal(result.found, 1)
    assert.equal(kept.noted[0].connectionId, 'c1')
    assert.equal(kept.noted[0].found[0].segmentId, 'g1')
    assert.equal(kept.noted[0].found[0].subject, 'KL 677 is delayed by 90 minutes')
  })
})

test('nothing of the body is written down', () => {
  const kept = store({
    mailboxes: [{ id: 'c1', userId: 'u1', travelSeenAt: null }],
    segments: [leg()],
    messages: [mail({ body: 'Dear Maya, your card ending 4417…' })],
  })
  return watchTravelMail({ repository: kept, reader: kept.reader, now: NOW }).then(() => {
    assert.equal(JSON.stringify(kept.noted).includes('4417'), false)
  })
})

test('the watermark moves even when there was nothing to find', () => {
  /* Otherwise the next pass reads the same window again, for ever. */
  const kept = store({
    mailboxes: [{ id: 'c1', userId: 'u1', travelSeenAt: null }],
    segments: [],
  })
  return watchTravelMail({ repository: kept, reader: kept.reader, now: NOW }).then(() => {
    assert.equal(kept.seen.length, 1)
    assert.equal(kept.seen[0].id, 'c1')
  })
})

test('one broken account does not cost the others their turn', () => {
  const kept = store({
    mailboxes: [
      { id: 'bad', userId: 'u1', travelSeenAt: null },
      { id: 'good', userId: 'u2', travelSeenAt: null },
    ],
    segments: [leg()],
    messages: [mail()],
  })
  const reader = {
    async listMessages(userId) {
      if (userId === 'u1') throw new Error('the mailbox did not answer (401)')
      return { messages: [mail()] }
    },
  }
  return watchTravelMail({ repository: kept, reader, now: NOW }).then(result => {
    assert.equal(result.looked, 2)
    assert.equal(result.found, 1)
    assert.equal(kept.noted[0].connectionId, 'good')
  })
})

test('a second pass over the same window reports nothing new', () => {
  const kept = store({
    mailboxes: [{ id: 'c1', userId: 'u1', travelSeenAt: '2026-09-19T11:55:00.000Z' }],
    segments: [leg()],
    messages: [mail()],
  })
  return watchTravelMail({ repository: kept, reader: kept.reader, now: NOW }).then(result => {
    assert.equal(result.found, 0)
    assert.deepEqual(kept.noted, [])
  })
})

/* And the switch itself, through the API a screen would use.
 *
 * Its own route rather than a field on something larger: "start reading my
 * mail on a timer" is not a setting that should ever be changed as a side
 * effect of saving something else.
 */

test('a mailbox does not watch anything until its owner says so', async () => {
  const repository = createMemoryRepository({ allowedEmails: [] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const user = await repository.ensureUser('owner@example.com')
  const saved = await repository.saveMailboxConnection({
    userId: user.id,
    provider: 'outlook',
    accountId: 'acct-1',
    accountEmail: 'owner@example.com',
    scopes: ['Mail.Read'],
  })

  /* Off the moment it is connected, and off for every mailbox connected
     before this existed — the column defaults to false so no migration turns
     anybody's watch on for them. */
  assert.notEqual(saved.watchTravel, true)
  assert.deepEqual(await repository.mailboxesWatchingTravel(), [])

  const on = await app.inject({
    method: 'PATCH',
    url: `/api/connectors/${saved.id}`,
    headers: { authorization: owner },
    body: { watchTravel: true },
  })
  assert.equal(on.statusCode, 200)
  assert.equal(on.json().connection.watchTravel, true)
  assert.equal((await repository.mailboxesWatchingTravel()).length, 1)

  const off = await app.inject({
    method: 'PATCH',
    url: `/api/connectors/${saved.id}`,
    headers: { authorization: owner },
    body: { watchTravel: false },
  })
  assert.equal(off.statusCode, 200)
  assert.deepEqual(await repository.mailboxesWatchingTravel(), [])
})

test('somebody else’s mailbox is not theirs to switch on', async () => {
  const repository = createMemoryRepository({ allowedEmails: [] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await authenticate(repository, 'owner@example.com')
  const stranger = await authenticate(repository, 'stranger@example.com')
  const user = await repository.ensureUser('owner@example.com')
  const saved = await repository.saveMailboxConnection({
    userId: user.id,
    provider: 'outlook',
    accountId: 'acct-1',
    accountEmail: 'owner@example.com',
    scopes: ['Mail.Read'],
  })

  const tried = await app.inject({
    method: 'PATCH',
    url: `/api/connectors/${saved.id}`,
    headers: { authorization: stranger },
    body: { watchTravel: true },
  })
  assert.equal(tried.statusCode, 404)
  assert.deepEqual(await repository.mailboxesWatchingTravel(), [])
})

test('a request that does not say either way is refused rather than guessed', async () => {
  const repository = createMemoryRepository({ allowedEmails: [] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const user = await repository.ensureUser('owner@example.com')
  const saved = await repository.saveMailboxConnection({
    userId: user.id,
    provider: 'outlook',
    accountId: 'acct-1',
    accountEmail: 'owner@example.com',
    scopes: ['Mail.Read'],
  })
  const vague = await app.inject({
    method: 'PATCH',
    url: `/api/connectors/${saved.id}`,
    headers: { authorization: owner },
    body: { watchTravel: 'yes please' },
  })
  assert.equal(vague.statusCode, 400)
})
