import assert from 'node:assert/strict'
import test from 'node:test'
import { marksOf, travelMail, WATCH_BEFORE_MS } from '../src/travel-mail.js'

/* Which of somebody's emails are plainly about a leg of this journey.
 *
 * Reading a mailbox on a timer is a serious thing to do to somebody, so the
 * whole of this file is about being narrow. It matches the flight number and
 * the booking reference the traveller typed onto the leg themselves — the
 * strings that could only be about their own journey — and it takes the
 * subject line, never the body.
 *
 * What the email SAYS is left to whoever reads it. An app that rewrites a
 * departure time from its own reading of an email is an app that will one day
 * move a flight because a newsletter mentioned one.
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

const mail = (subject, rest = {}) => ({
  id: `m-${subject.slice(0, 6)}`,
  subject,
  preview: '',
  received: '2026-09-19T11:30:00.000Z',
  from: { name: 'KLM', address: 'noreply@klm.com' },
  ...rest,
})

test('a subject naming the flight is about the flight', () => {
  const found = travelMail({ segments: [leg()], messages: [mail('KL 677 is delayed')], now: NOW })
  assert.equal(found.length, 1)
  assert.equal(found[0].segmentId, 'g1')
  assert.equal(found[0].subject, 'KL 677 is delayed')
})

test('the spaces and dashes an airline chooses are not the traveller’s problem', () => {
  /* "KL677", "KL 677" and "kl-677" are one flight to everybody except a
     string comparison. */
  for (const spelling of ['KL677 delayed', 'kl-677 gate change', 'Your KL 677']) {
    const found = travelMail({ segments: [leg()], messages: [mail(spelling)], now: NOW })
    assert.equal(found.length, 1, spelling)
  }
})

test('the booking reference finds mail that never names the flight', () => {
  const found = travelMail({
    segments: [leg()],
    messages: [mail('Changes to your booking R7QWXZ')],
    now: NOW,
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].mark, 'r7qwxz')
})

test('the carrier alone is never a match, or every fare sale is a delay', () => {
  const found = travelMail({
    segments: [leg()],
    messages: [mail('KLM: 20% off flights this autumn')],
    now: NOW,
  })
  assert.deepEqual(found, [])
})

test('a reference too short to be one is a word, and a word matches a mailbox', () => {
  assert.deepEqual(marksOf({ number: null, ref: 'AB1' }), [])
  assert.ok(marksOf({ number: 'KL 677', ref: null }).includes('kl677'))
})

test('a flight months out does not have its owner’s mail watched', () => {
  /* The window is "near enough that a change would still change what you do".
     Nothing else justifies looking. */
  const distant = leg({ departsAt: new Date(NOW + WATCH_BEFORE_MS + 60_000).toISOString() })
  assert.deepEqual(
    travelMail({ segments: [distant], messages: [mail('KL 677 delayed')], now: NOW }),
    [],
  )
})

test('a flight long gone is somebody else’s problem now', () => {
  const past = leg({ departsAt: '2026-09-18T06:00:00.000Z' })
  assert.deepEqual(
    travelMail({ segments: [past], messages: [mail('KL 677 delayed')], now: NOW }),
    [],
  )
})

test('mail that arrived before the last look is not reported again', () => {
  /* This runs on a timer, and a job that re-reports the same email every few
     minutes is a job somebody turns off. */
  const since = Date.parse('2026-09-19T11:45:00Z')
  assert.deepEqual(
    travelMail({ segments: [leg()], messages: [mail('KL 677 delayed')], now: NOW, since }),
    [],
  )
})

test('the newest thing the airline said comes first, because it is the true one', () => {
  const found = travelMail({
    segments: [leg()],
    messages: [
      mail('KL 677 delayed by 30', { id: 'm1', received: '2026-09-19T10:00:00.000Z' }),
      mail('KL 677 delayed by 90', { id: 'm2', received: '2026-09-19T11:30:00.000Z' }),
    ],
    now: NOW,
  })
  assert.deepEqual(
    found.map(one => one.id ?? one.messageId),
    ['m2', 'm1'],
  )
})

test('one email is about one leg, not every leg it could be read into', () => {
  const train = leg({ id: 'g2', carrier: 'NS', number: 'IC 3155', ref: 'NSI4KQ' })
  const found = travelMail({
    segments: [leg(), train],
    messages: [mail('IC 3155 is running late')],
    now: NOW,
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].segmentId, 'g2')
})

test('nothing of the body ever leaves this function', () => {
  /* The subject is what a traveller needs to decide whether to open it, and
     nothing more of their mail than that. */
  const found = travelMail({
    segments: [leg()],
    messages: [mail('KL 677 delayed', { body: 'Dear Maya, your bank details are…' })],
    now: NOW,
  })
  assert.equal(JSON.stringify(found).includes('bank details'), false)
  assert.deepEqual(Object.keys(found[0]).sort(), [
    'from',
    'mark',
    'messageId',
    'received',
    'segmentId',
    'subject',
  ])
})

test('nothing to match against is nothing claimed, rather than a throw', () => {
  assert.deepEqual(travelMail({}), [])
  assert.deepEqual(travelMail({ segments: [leg()], messages: [] }), [])
  assert.deepEqual(travelMail({ segments: [{ id: 'g9' }], messages: [mail('KL 677')] }), [])
})
