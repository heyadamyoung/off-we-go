import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

test('the iOS WKWebView origin can preflight authenticated VPS requests but arbitrary sites cannot', async () => {
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: [] }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const allowed = await app.inject({
    method: 'OPTIONS',
    url: '/api/trips/current',
    headers: {
      origin: 'capacitor://localhost',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  })
  assert.equal(allowed.statusCode, 204)
  assert.equal(allowed.headers['access-control-allow-origin'], 'capacitor://localhost')
  assert.match(allowed.headers['access-control-allow-headers'], /authorization/i)

  const rejected = await app.inject({
    method: 'OPTIONS',
    url: '/api/trips/current',
    headers: { origin: 'https://attacker.example', 'access-control-request-method': 'GET' },
  })
  assert.equal(rejected.headers['access-control-allow-origin'], undefined)
  await app.close()
})

test('the Android WebView origin can preflight authenticated VPS requests', async () => {
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: [] }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  const response = await app.inject({
    method: 'OPTIONS',
    url: '/api/trips',
    headers: {
      origin: 'https://localhost',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  })
  assert.equal(response.statusCode, 204)
  assert.equal(response.headers['access-control-allow-origin'], 'https://localhost')
  await app.close()
})
