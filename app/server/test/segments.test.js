import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { changeKind } from '../src/change-kind.js'
import { deriveDeadlines, SEGMENT_MODES } from '../src/segments.js'
import { authenticate } from './auth-helper.js'
import { createMemoryRepository } from './memory-repository.js'

/* The getting-there layer, server side. What these pin: one departure time
   births the whole countdown, per mode; a gate change keeps its history;
   edits are the editors' alone; and a segment change announces itself to
   watching browsers like any other trip edit. */

test('one departure time births the countdown, per mode', () => {
  const flight = deriveDeadlines('flight', '2026-09-19T16:10:00.000Z')
  assert.equal(flight.checkinClosesAt, '2026-09-19T15:10:00.000Z')
  assert.equal(flight.bagsCloseAt, '2026-09-19T15:25:00.000Z')
  assert.equal(flight.boardingAt, '2026-09-19T15:30:00.000Z')
  assert.equal(flight.doorsAt, '2026-09-19T15:55:00.000Z')

  const train = deriveDeadlines('train', '2026-09-19T13:15:00.000Z')
  assert.equal(train.boardingAt, '2026-09-19T12:55:00.000Z')
  assert.equal(train.doorsAt, '2026-09-19T13:13:00.000Z')
  assert.equal(train.checkinClosesAt, undefined, 'trains have no check-in desk')

  assert.equal(deriveDeadlines('drive', '2026-09-19T10:00:00.000Z'), null)
  assert.equal(deriveDeadlines('flight', 'not a time'), null)
  assert.ok(SEGMENT_MODES.includes('ferry'))
})

test('a segment change announces itself like any other trip edit', () => {
  assert.equal(changeKind('POST', '/api/trips/t-1/segments'), 'segments')
  assert.equal(changeKind('PATCH', '/api/trips/t-1/segments/s-1'), 'segments')
  assert.equal(changeKind('DELETE', '/api/trips/t-1/segments/documents/d-1'), 'segments')
  assert.equal(changeKind('GET', '/api/trips/t-1/segments'), null)
})

test('segments belong to editors: created, gate history kept, gone on delete', async () => {
  const repository = createMemoryRepository({ allowedEmails: [] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const stranger = await authenticate(repository, 'stranger@example.com')
  const ownerUser = await repository.ensureUser('owner@example.com')
  const trip = await repository.createTrip(ownerUser, { title: 'Getting home' })

  const created = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
    body: {
      mode: 'flight',
      carrier: 'Air Canada',
      number: 'AC 1140',
      ref: 'CLACZ3',
      fromName: 'Toronto Pearson',
      fromCode: 'YYZ',
      toName: 'Regina',
      toCode: 'YQR',
      departsAt: '2026-09-19T16:10:00.000Z',
      passengers: [{ name: 'Maya', seat: '14A' }],
    },
  })
  assert.equal(created.statusCode, 200)
  const segment = created.json()
  assert.equal(segment.deadlines.boardingAt, '2026-09-19T15:30:00.000Z', 'deadlines derive')

  /* The night the connection died mid-answer, a retried question created
     every leg twice. The same flight asked for again is the same flight. */
  const again = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
    body: {
      mode: 'flight',
      carrier: 'Air Canada',
      number: 'AC 1140',
      fromName: 'Toronto Pearson',
      toName: 'Regina',
      departsAt: '2026-09-19T16:10:00.000Z',
      gate: 'B31',
    },
  })
  assert.equal(again.statusCode, 200)
  assert.equal(again.json().id, segment.id, 'a re-asked leg updates instead of doubling')
  const afterRetry = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
  })
  assert.equal(afterRetry.json().segments.length, 1)

  const refused = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: stranger },
    body: { mode: 'train', fromName: 'A', toName: 'B', departsAt: '2026-09-19T10:00:00.000Z' },
  })
  assert.equal(refused.statusCode, 403)

  const gated = await app.inject({
    method: 'PATCH',
    url: `/api/trips/${trip.id}/segments/${segment.id}`,
    headers: { authorization: owner },
    body: { gate: 'D22' },
  })
  assert.equal(gated.statusCode, 200)
  const moved = await app.inject({
    method: 'PATCH',
    url: `/api/trips/${trip.id}/segments/${segment.id}`,
    headers: { authorization: owner },
    body: { gate: 'D28', status: 'changed', statusNote: "gate change, from Air Canada's email" },
  })
  assert.equal(moved.json().gateWas, 'D22', 'a gate change keeps its history')

  const listed = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
  })
  assert.equal(listed.json().segments.length, 1)

  const gone = await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/segments/${segment.id}`,
    headers: { authorization: owner },
  })
  assert.equal(gone.statusCode, 204)
  const after = await app.inject({
    method: 'GET',
    url: `/api/trips/${trip.id}/segments`,
    headers: { authorization: owner },
  })
  assert.equal(after.json().segments.length, 0)
  await app.close()
})
