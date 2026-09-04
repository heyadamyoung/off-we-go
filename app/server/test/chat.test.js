import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { changeKind } from '../src/change-kind.js'
import { signAgentToken } from '../src/agent-token.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const SECRET = 'test-secret-that-is-long-enough'

async function chatServer() {
  const repository = createMemoryRepository({
    allowedEmails: ['owner@example.com', 'friend@example.com', 'stranger@example.com'],
  })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: SECRET,
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Chatty trip' },
    })
  ).json()
  const invitation = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/invites`,
      headers: { authorization: owner },
      payload: { email: 'friend@example.com', name: 'Alex', role: 'viewer' },
    })
  ).json()
  const friend = await authenticate(repository, 'friend@example.com')
  await app.inject({
    method: 'POST',
    url: `/api/invites/${invitation.id}/accept`,
    headers: { authorization: friend },
  })
  return { app, repository, owner, friend, trip }
}

test('the family talks: viewers included, emoji riding along, reactions toggling', async () => {
  const { app, owner, friend, trip } = await chatServer()

  const said = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/messages`,
      headers: { authorization: owner },
      payload: { body: 'Waterfall day tomorrow 🌊 pack accordingly' },
    })
  ).json()
  assert.equal(said.body, 'Waterfall day tomorrow 🌊 pack accordingly')

  // A viewer is family too — reading and speaking both work.
  const reply = await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/messages`,
    headers: { authorization: friend },
    payload: { body: 'can we sleep in though 😴' },
  })
  assert.equal(reply.statusCode, 201)

  // Reactions: friend hearts the plan; the aggregate says who and how many.
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/trips/${trip.id}/messages/${said.id}/reactions`,
        headers: { authorization: friend },
        payload: { emoji: '❤️' },
      })
    ).statusCode,
    204,
  )
  await app.inject({
    method: 'PUT',
    url: `/api/trips/${trip.id}/messages/${said.id}/reactions`,
    headers: { authorization: owner },
    payload: { emoji: '❤️' },
  })
  let listed = (
    await app.inject({
      method: 'GET',
      url: `/api/trips/${trip.id}/messages`,
      headers: { authorization: friend },
    })
  ).json().messages
  assert.equal(listed.length, 2)
  assert.deepEqual(listed[0].reactions, [{ emoji: '❤️', count: 2, mine: true }])

  // Toggling off is the same verb backwards.
  await app.inject({
    method: 'DELETE',
    url: `/api/trips/${trip.id}/messages/${said.id}/reactions`,
    headers: { authorization: friend },
    payload: { emoji: '❤️' },
  })
  listed = (
    await app.inject({
      method: 'GET',
      url: `/api/trips/${trip.id}/messages`,
      headers: { authorization: friend },
    })
  ).json().messages
  assert.deepEqual(listed[0].reactions, [{ emoji: '❤️', count: 1, mine: false }])
  await app.close()
})

test('chat has walls: strangers out, sizes bounded, deletion is yours or the owner’s', async () => {
  const { app, repository, owner, friend, trip } = await chatServer()
  const stranger = await authenticate(repository, 'stranger@example.com')

  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/trips/${trip.id}/messages`,
        headers: { authorization: stranger },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/trips/${trip.id}/messages`,
        headers: { authorization: owner },
        payload: { body: '   ' },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/trips/${trip.id}/messages`,
        headers: { authorization: owner },
        payload: { body: 'x'.repeat(2001) },
      })
    ).statusCode,
    400,
  )

  const theirs = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/messages`,
      headers: { authorization: friend },
      payload: { body: 'mine to delete' },
    })
  ).json()
  // Not the friend's to delete when it is the owner's message — and vice
  // versa the owner may moderate anything.
  const owners = (
    await app.inject({
      method: 'POST',
      url: `/api/trips/${trip.id}/messages`,
      headers: { authorization: owner },
      payload: { body: 'the plan stands' },
    })
  ).json()
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/trips/${trip.id}/messages/${owners.id}`,
        headers: { authorization: friend },
      })
    ).statusCode,
    404,
  )
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/trips/${trip.id}/messages/${theirs.id}`,
        headers: { authorization: owner },
      })
    ).statusCode,
    204,
  )

  // A "reaction" that is words is not a reaction.
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/trips/${trip.id}/messages/${owners.id}/reactions`,
        headers: { authorization: owner },
        payload: { emoji: 'lol nice' },
      })
    ).statusCode,
    400,
  )
  await app.close()
})

test('chat announces as its own kind, and the agent can read the room', async () => {
  assert.equal(changeKind('POST', '/api/trips/t1/messages'), 'chat')
  assert.equal(changeKind('PUT', '/api/trips/t1/messages/m1/reactions'), 'chat')
  assert.equal(changeKind('GET', '/api/trips/t1/messages'), null)

  const { app, owner, trip } = await chatServer()
  await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/messages`,
    headers: { authorization: owner },
    payload: { body: 'meet at the gate at 9 🛫' },
  })
  const token = signAgentToken({ id: trip.ownerId, email: 'owner@example.com' }, SECRET)
  const read = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_messages', arguments: { tripId: trip.id } },
    },
  })
  assert.equal(read.statusCode, 200)
  assert.match(read.body, /meet at the gate/)
  await app.close()
})
