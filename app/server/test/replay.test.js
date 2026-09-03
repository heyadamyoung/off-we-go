import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildServer } from '../src/app.js'
import { createReplayStore, validChunk } from '../src/replay-store.js'
import { authenticate } from './auth-helper.js'
import { createMemoryRepository } from './memory-repository.js'

/* Session replay: the family's screens, kept on the family's own server.
   What these pin: only well-formed chunks are stored, events come back in
   order however the chunks arrived, old sessions die on schedule, and the
   watching side belongs to the admin email alone. */

const SESSION_A = '11111111-2222-4333-8444-555555555555'
const chunk = (over = {}) => ({ session: SESSION_A, seq: 0, events: [{ type: 2 }], ...over })

test('only a well-formed chunk is a chunk', () => {
  assert.ok(validChunk(chunk()))
  assert.equal(validChunk(chunk({ session: 'not-a-uuid' })), null)
  assert.equal(validChunk(chunk({ seq: -1 })), null)
  assert.equal(validChunk(chunk({ seq: 1.5 })), null)
  assert.equal(validChunk(chunk({ events: [] })), null)
  assert.equal(validChunk(chunk({ events: 'lots' })), null)
  assert.equal(validChunk(null), null)
})

test('chunks reassemble in seq order, whatever order the network delivered', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'replay-'))
  const store = createReplayStore({ directory })
  await store.append('u-1', chunk({ seq: 1, events: [{ n: 'second' }] }))
  await store.append('u-1', chunk({ seq: 0, events: [{ n: 'first' }] }))

  const events = await store.events(SESSION_A)
  assert.deepEqual(
    events.map(e => e.n),
    ['first', 'second'],
  )
  const sessions = await store.sessions()
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].userId, 'u-1')
  assert.equal(sessions[0].session, SESSION_A)
})

test('the sweep keeps its fortnight promise', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'replay-'))
  const store = createReplayStore({ directory })
  await store.append('u-1', chunk())
  const old = new Date(Date.now() - 20 * 24 * 3600_000)
  await utimes(path.join(directory, `u-1__${SESSION_A}.jsonl`), old, old)

  assert.equal(await store.sweep(), 1)
  assert.deepEqual(await store.sessions(), [])
})

test('uploads need a session; watching needs the owner', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'replay-'))
  const repository = createMemoryRepository({ allowedEmails: [] })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    replayStore: createReplayStore({ directory }),
    adminEmail: 'owner@example.com',
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const other = await authenticate(repository, 'catherine@example.com')

  const anonymous = await app.inject({ method: 'POST', url: '/api/replay/chunks', body: chunk() })
  assert.equal(anonymous.statusCode, 401)

  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/replay/chunks',
    headers: { authorization: other },
    body: chunk(),
  })
  assert.equal(uploaded.statusCode, 204)

  const refused = await app.inject({
    method: 'GET',
    url: '/api/replay/sessions',
    headers: { authorization: other },
  })
  assert.equal(refused.statusCode, 403)

  const listed = await app.inject({
    method: 'GET',
    url: '/api/replay/sessions',
    headers: { authorization: owner },
  })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json().sessions.length, 1)

  const watched = await app.inject({
    method: 'GET',
    url: `/api/replay/sessions/${SESSION_A}/events`,
    headers: { authorization: owner },
  })
  assert.equal(watched.statusCode, 200)
  assert.equal(watched.json().events.length, 1)

  const garbage = await app.inject({
    method: 'POST',
    url: '/api/replay/chunks',
    headers: { authorization: other },
    body: { session: 'nope', seq: 0, events: [] },
  })
  assert.equal(garbage.statusCode, 400)
  await app.close()
})
