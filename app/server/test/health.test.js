import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

test('health reports unavailable when PostgreSQL or upload storage is not writable', async () => {
  const repository = createMemoryRepository()
  repository.ready = async () => {
    throw new Error('database unavailable')
  }
  const app = await buildServer({
    repository,
    fileStore: { async ready() {}, async remove() {} },
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })

  const response = await app.inject({ method: 'GET', url: '/api/health' })

  assert.equal(response.statusCode, 503)
  assert.deepEqual(response.json(), { ok: false })
  await app.close()
})

/* The connector's secrets reach the box through the deployment, so the only
   way to see whether they arrived is from outside. */
test('health says whether the mailbox connector came up configured', async () => {
  const base = {
    repository: createMemoryRepository(),
    fileStore: { async ready() {}, async remove() {} },
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  }

  const bare = await buildServer(base)
  const connected = await buildServer({
    ...base,
    repository: createMemoryRepository(),
    microsoft: { clientId: 'client-abc', clientSecret: 'shhh', tenant: 'common' },
    mailboxTokenKey: Buffer.alloc(32, 7).toString('base64'),
  })

  assert.deepEqual((await bare.inject({ method: 'GET', url: '/api/health' })).json(), {
    ok: true,
    connectors: { outlook: false, assistant: false, routing: false, replay: false },
  })
  assert.deepEqual((await connected.inject({ method: 'GET', url: '/api/health' })).json(), {
    ok: true,
    connectors: { outlook: true, assistant: false, routing: false, replay: false },
  })
  await bare.close()
  await connected.close()
})
