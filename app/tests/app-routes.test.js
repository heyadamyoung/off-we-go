import test from 'node:test'
import assert from 'node:assert/strict'
import * as routes from '../src/app-routes-core.ts'

test('native trip share links use the public API origin instead of the WebView origin', () => {
  assert.equal(typeof routes.absoluteTripHref, 'function')
  assert.equal(
    routes.absoluteTripHref(
      'netherlands-scotland',
      'capacitor://localhost',
      'https://offwego.to/api',
    ),
    'https://offwego.to/trips/netherlands-scotland',
  )
})

test('web trip share links keep the current public origin when the API path is relative', () => {
  assert.equal(typeof routes.absoluteTripHref, 'function')
  assert.equal(
    routes.absoluteTripHref('netherlands-scotland', 'https://offwego.to', '/api'),
    'https://offwego.to/trips/netherlands-scotland',
  )
})

test('pairing links carry their secret in the fragment and round-trip losslessly', () => {
  const payload = {
    endpoint: 'https://offwego.to/api/ingest/track',
    token: 'a-very-secret-token',
    deviceId: 'device-7',
    name: "Catherine's phone",
  }
  const href = routes.absolutePairHref(payload, 'capacitor://localhost', 'https://offwego.to/api')
  assert.ok(href.startsWith('https://offwego.to/pair#'), href)
  assert.ok(!href.includes('?'), 'the payload must ride in the fragment, never the query string')
  assert.deepEqual(routes.parsePairHash(new URL(href).hash), payload)
})

test('a mangled pairing hash is rejected rather than half-configured', () => {
  assert.equal(routes.parsePairHash(''), null)
  assert.equal(routes.parsePairHash('#e=&t=x&d=1'), null)
  assert.equal(routes.parsePairHash('#e=javascript:alert(1)&t=x&d=1&n=y'), null)
  assert.equal(routes.parsePairHash('#t=only-a-token'), null)
})
