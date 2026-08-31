import test from 'node:test'
import assert from 'node:assert/strict'
import * as routes from '../src/app-routes-core.ts'

test('native trip share links use the public API origin instead of the WebView origin', () => {
  assert.equal(typeof routes.absoluteTripHref, 'function')
  assert.equal(
    routes.absoluteTripHref('netherlands-scotland', 'capacitor://localhost', 'https://offwego.to/api'),
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
