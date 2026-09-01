import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

test('health reports unavailable when PostgreSQL or upload storage is not writable', async () => {
  const repository = createMemoryRepository()
  repository.ready = async () => { throw new Error('database unavailable') }
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
