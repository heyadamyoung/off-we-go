import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildServer } from '../src/app.js'
import { readAgentToken, signAgentToken, AGENT_TOKEN_TTL_MS } from '../src/agent-token.js'
import { createCodexRunner, prepareCodexHome } from '../src/codex.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

const SECRET = 'test-secret-that-is-long-enough'

async function assistantServer({ assistant, allowedEmails = ['owner@example.com'] } = {}) {
  const repository = createMemoryRepository({ allowedEmails })
  const app = await buildServer({
    repository,
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: SECRET,
    assistant,
  })
  return { repository, app }
}

test('an ask is a job: started at once, polled to its answer, private to its asker', async () => {
  // The wire must never have to outlive the run: the phone that asked from
  // airport LTE lost every held response while the agent kept editing.
  let finish
  const assistant = {
    run: () => new Promise(resolve => (finish = resolve)),
  }
  const { repository, app } = await assistantServer({
    assistant,
    allowedEmails: ['owner@example.com', 'other@example.com'],
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const other = await authenticate(repository, 'other@example.com')
  await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization: owner },
    payload: { title: 'Getting home' },
  })

  const started = await app.inject({
    method: 'POST',
    url: '/api/assistant',
    headers: { authorization: owner },
    payload: { wait: false, messages: [{ role: 'user', text: 'Fill in the legs' }] },
  })
  assert.equal(started.statusCode, 202)
  const job = started.json().job
  assert.ok(job)

  const running = await app.inject({
    method: 'GET',
    url: `/api/assistant/jobs/${job}`,
    headers: { authorization: owner },
  })
  assert.equal(running.json().state, 'running')

  // Someone else's poll of the same id learns nothing, not even that it exists.
  const foreign = await app.inject({
    method: 'GET',
    url: `/api/assistant/jobs/${job}`,
    headers: { authorization: other },
  })
  assert.equal(foreign.statusCode, 404)

  finish('All three legs are in.')
  await new Promise(step => setImmediate(step))
  const done = await app.inject({
    method: 'GET',
    url: `/api/assistant/jobs/${job}`,
    headers: { authorization: owner },
  })
  assert.equal(done.json().state, 'done')
  assert.equal(done.json().reply, 'All three legs are in.')
})

test('a failed run polls out as words for a person, not a stack for a screen', async () => {
  const assistant = {
    run: () => Promise.reject(new Error('codex exec did not answer within 600000ms: mcp: tool')),
  }
  const { repository, app } = await assistantServer({ assistant })
  const owner = await authenticate(repository, 'owner@example.com')
  await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization: owner },
    payload: { title: 'Getting home' },
  })
  const started = await app.inject({
    method: 'POST',
    url: '/api/assistant',
    headers: { authorization: owner },
    payload: { wait: false, messages: [{ role: 'user', text: 'Fill in the legs' }] },
  })
  await new Promise(step => setImmediate(step))
  const failed = await app.inject({
    method: 'GET',
    url: `/api/assistant/jobs/${started.json().job}`,
    headers: { authorization: owner },
  })
  assert.equal(failed.json().state, 'failed')
  assert.match(failed.json().error, /ran out of time/)
  assert.doesNotMatch(failed.json().error, /codex|mcp|exec/i)
})

test('the assistant gets the conversation and a scoped token, never a data dump', async () => {
  const asks = []
  const assistant = {
    async run(prompt, options) {
      asks.push({ prompt, options })
      return 'Pack a raincoat.'
    },
  }
  const { repository, app } = await assistantServer({ assistant })
  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Iceland loop', crew: 'The Explorers' },
    })
  ).json()
  await app.inject({
    method: 'POST',
    url: `/api/trips/${trip.id}/stops`,
    headers: { authorization: owner },
    payload: { name: 'Skógafoss', day: 'Day 2', lng: -19.51, lat: 63.53, note: 'Bring the drone' },
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/assistant',
    headers: { authorization: owner },
    payload: {
      trip: trip.slug,
      messages: [
        { role: 'user', text: 'Is the waterfall day going to be wet?' },
        { role: 'assistant', text: 'It is a waterfall.' },
        { role: 'user', text: 'So what do I pack?' },
      ],
    },
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().reply, 'Pack a raincoat.')
  assert.equal(asks.length, 1)

  const { prompt, options } = asks[0]
  // The prompt points at the tools and names the trip; the data stays behind them.
  for (const expected of [
    'Iceland loop',
    `slug: ${trip.slug}`,
    'get_trip',
    'get_live_positions',
    'Traveller: So what do I pack?',
  ]) {
    assert.ok(prompt.includes(expected), `prompt should carry: ${expected}`)
  }
  assert.ok(!prompt.includes('Skógafoss'), 'the itinerary must not be stuffed into the prompt')
  assert.ok(!prompt.includes('Bring the drone'), 'stop notes must not be stuffed into the prompt')
  // The owner can edit, so their agent is told how to and its token allows it.
  assert.ok(prompt.includes('create_stop'), "an editor's prompt should offer the write tools")
  assert.ok(prompt.includes('what you changed'))
  // The token in the spawn environment is the asking user, verifiably.
  const agent = readAgentToken(options.env.OFFWEGO_MCP_TOKEN, SECRET)
  assert.equal(agent?.user.id, trip.ownerId)
  assert.equal(agent?.user.email, 'owner@example.com')
  assert.deepEqual(agent?.scopes, ['trips:read', 'trips:write'])
  await app.close()
})

test("a viewer's agent gets a read-only token and a read-only briefing", async () => {
  const asks = []
  const assistant = {
    async run(prompt, options) {
      asks.push({ prompt, options })
      return 'Sure.'
    },
  }
  const { repository, app } = await assistantServer({
    assistant,
    allowedEmails: ['owner@example.com', 'friend@example.com'],
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Shared trip' },
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

  const response = await app.inject({
    method: 'POST',
    url: '/api/assistant',
    headers: { authorization: friend },
    payload: { trip: trip.slug, messages: [{ role: 'user', text: 'Add a stop in Reykjavík?' }] },
  })
  assert.equal(response.statusCode, 200)
  const { prompt, options } = asks[0]
  assert.ok(prompt.includes('read-only'), "a viewer's prompt should say so")
  assert.ok(!prompt.includes('create_stop'), "a viewer's prompt must not offer write tools")
  const agent = readAgentToken(options.env.OFFWEGO_MCP_TOKEN, SECRET)
  assert.equal(agent?.user.email, 'friend@example.com')
  assert.deepEqual(agent?.scopes, ['trips:read'])
  await app.close()
})

test('the assistant is honest when it is not configured, and health says so too', async () => {
  const { repository, app } = await assistantServer()
  const owner = await authenticate(repository, 'owner@example.com')
  await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization: owner },
    payload: { title: 'A trip' },
  })
  const response = await app.inject({
    method: 'POST',
    url: '/api/assistant',
    headers: { authorization: owner },
    payload: { messages: [{ role: 'user', text: 'Hello?' }] },
  })
  assert.equal(response.statusCode, 503)
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/health' })).json().connectors.assistant,
    false,
  )
  await app.close()
})

test('the assistant refuses strangers, bad conversations, and the signed-out', async () => {
  const assistant = {
    async run() {
      throw new Error('should never run')
    },
  }
  const { repository, app } = await assistantServer({
    assistant,
    allowedEmails: ['owner@example.com', 'stranger@example.com'],
  })
  const owner = await authenticate(repository, 'owner@example.com')
  const stranger = await authenticate(repository, 'stranger@example.com')
  const trip = (
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: { authorization: owner },
      payload: { title: 'Private trip' },
    })
  ).json()

  const ask = (headers, payload) =>
    app.inject({ method: 'POST', url: '/api/assistant', headers, payload })
  assert.equal((await ask({}, { messages: [{ role: 'user', text: 'Hi' }] })).statusCode, 401)
  assert.equal(
    (
      await ask(
        { authorization: stranger },
        { trip: trip.slug, messages: [{ role: 'user', text: 'Hi' }] },
      )
    ).statusCode,
    404,
  )
  assert.equal(
    (await ask({ authorization: owner }, { trip: trip.slug, messages: [] })).statusCode,
    400,
  )
  assert.equal(
    (
      await ask(
        { authorization: owner },
        { trip: trip.slug, messages: [{ role: 'assistant', text: 'I speak first' }] },
      )
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await ask(
        { authorization: owner },
        { trip: trip.slug, messages: [{ role: 'user', text: '   ' }] },
      )
    ).statusCode,
    400,
  )
  await app.close()
})

test('a model failure is a 502, not a hang or a crash', async () => {
  const assistant = {
    async run() {
      throw new Error('codex exec exited with 1: no luck')
    },
  }
  const { repository, app } = await assistantServer({ assistant })
  const owner = await authenticate(repository, 'owner@example.com')
  await app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: { authorization: owner },
    payload: { title: 'A trip' },
  })
  const response = await app.inject({
    method: 'POST',
    url: '/api/assistant',
    headers: { authorization: owner },
    payload: { messages: [{ role: 'user', text: 'Hello?' }] },
  })
  assert.equal(response.statusCode, 502)
  await app.close()
})

test('an agent token stands for one user and role, expires, and survives no tampering', async () => {
  const now = new Date('2027-06-01T12:00:00Z')
  const token = signAgentToken({ id: 'user-1', email: 'owner@example.com' }, SECRET, now)
  assert.deepEqual(readAgentToken(token, SECRET, now), {
    user: { id: 'user-1', email: 'owner@example.com' },
    scopes: ['trips:read'],
  })
  const writable = signAgentToken({ id: 'user-1' }, SECRET, now, ['trips:read', 'trips:write'])
  assert.deepEqual(readAgentToken(writable, SECRET, now)?.scopes, ['trips:read', 'trips:write'])
  assert.deepEqual(
    readAgentToken(token, SECRET, new Date(now.getTime() + AGENT_TOKEN_TTL_MS - 1000))?.user.id,
    'user-1',
  )
  assert.equal(
    readAgentToken(token, SECRET, new Date(now.getTime() + AGENT_TOKEN_TTL_MS + 1000)),
    null,
  )
  assert.equal(readAgentToken(token, 'a-different-signing-secret', now), null)
  const [head, signature] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ id: 'user-2', issuedAt: now.getTime() })).toString(
    'base64url',
  )
  assert.equal(readAgentToken(`wf_agent_${forged}.${signature}`, SECRET, now), null)
  assert.equal(readAgentToken(`${head}.`, SECRET, now), null)
  assert.equal(readAgentToken('wf_mcp_not-an-agent-token', SECRET, now), null)
  // Scopes are part of the signed payload: inventing one is tampering too.
  assert.equal(
    readAgentToken(signAgentToken({ id: 'user-1' }, SECRET, now, ['trips:admin']), SECRET, now),
    null,
  )
  assert.equal(
    readAgentToken(signAgentToken({ id: 'user-1' }, SECRET, now, ['trips:write']), SECRET, now),
    null,
    'write without read is not a scope this system mints',
  )
})

const asBase64 = value => Buffer.from(JSON.stringify(value)).toString('base64')

test('the Codex login is seeded once and a rotated token is never clobbered', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-home-'))
  const authPath = path.join(home, 'auth.json')
  const secret = asBase64({ tokens: { refresh: 'first-login' } })

  assert.equal(await prepareCodexHome({ home, authJsonB64: secret }), true)
  assert.match(await readFile(authPath, 'utf8'), /first-login/)

  // Codex refreshed the token on its own; the same secret must leave it alone.
  await writeFile(authPath, JSON.stringify({ tokens: { refresh: 'rotated-by-codex' } }))
  assert.equal(await prepareCodexHome({ home, authJsonB64: secret }), false)
  assert.match(await readFile(authPath, 'utf8'), /rotated-by-codex/)

  // A fresh `codex login` delivered through the secret must win again.
  const newSecret = asBase64({ tokens: { refresh: 'second-login' } })
  assert.equal(await prepareCodexHome({ home, authJsonB64: newSecret }), true)
  assert.match(await readFile(authPath, 'utf8'), /second-login/)

  await assert.rejects(() => prepareCodexHome({ home, authJsonB64: 'not base64 json' }))
})

test('the codex home points the agent at the loopback MCP server', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-home-'))
  await prepareCodexHome({
    home,
    authJsonB64: asBase64({ tokens: {} }),
    mcpUrl: 'http://127.0.0.1:3000/mcp',
  })
  const config = await readFile(path.join(home, 'config.toml'), 'utf8')
  assert.match(config, /\[mcp_servers\.offwego\]/)
  assert.match(config, /url = "http:\/\/127\.0\.0\.1:3000\/mcp"/)
  assert.match(config, /bearer_token_env_var = "OFFWEGO_MCP_TOKEN"/)
})

function fakeCodex({ exitCode = 0, reply = 'An answer', onSpawn }) {
  return (binary, args, options) => {
    const child = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    let prompt = ''
    child.stdin = new EventEmitter()
    child.stdin.end = value => {
      prompt += value || ''
      const outFile = args[args.indexOf('--output-last-message') + 1]
      setImmediate(async () => {
        if (exitCode === 0) await writeFile(outFile, reply)
        else child.stderr.emit('data', 'stream error: quota')
        onSpawn?.({ binary, args, options, prompt })
        child.emit('close', exitCode)
      })
    }
    return child
  }
}

test('the runner asks codex exec for the configured model and effort, with the per-question token', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-home-'))
  let seen = null
  const run = createCodexRunner({
    home,
    model: 'luna',
    reasoningEffort: 'xhigh',
    spawn: fakeCodex({
      reply: '  The answer.\n',
      onSpawn: value => {
        seen = value
      },
    }),
  })
  assert.equal(
    await run('What now?', { env: { OFFWEGO_MCP_TOKEN: 'wf_agent_abc.def' } }),
    'The answer.',
  )
  assert.equal(seen.binary, 'codex')
  assert.equal(seen.prompt, 'What now?')
  assert.equal(seen.options.env.CODEX_HOME, home)
  assert.equal(seen.options.env.OFFWEGO_MCP_TOKEN, 'wf_agent_abc.def')
  assert.deepEqual(seen.args.slice(0, 1), ['exec'])
  assert.ok(seen.args.includes('--skip-git-repo-check'))
  assert.equal(seen.args[seen.args.indexOf('--sandbox') + 1], 'read-only')
  assert.equal(seen.args[seen.args.indexOf('--model') + 1], 'luna')
  assert.equal(seen.args[seen.args.indexOf('-c') + 1], 'model_reasoning_effort="xhigh"')
  // Without this, non-interactive exec auto-denies destructive MCP tools and
  // the agent reports the connector "blocking" deletions the owner asked for.
  assert.ok(seen.args.includes('approval_policy="never"'))
  assert.equal(seen.args[seen.args.length - 1], '-')
})

test('a codex failure surfaces its stderr instead of an empty answer', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-home-'))
  const run = createCodexRunner({ home, spawn: fakeCodex({ exitCode: 1 }) })
  await assert.rejects(() => run('What now?'), /exited with 1: stream error: quota/)
})
