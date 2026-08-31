import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeRequestForLog } from '../src/logging.js'

test('production request logs omit signed-media and device-token query strings', () => {
  assert.deepEqual(serializeRequestForLog({
    method: 'POST',
    url: '/api/track?id=private-device-token&token=another-secret',
    headers: { host: 'offwego.to', authorization: 'Bearer secret' },
    remoteAddress: '203.0.113.4', remotePort: 49152,
  }), {
    method: 'POST', url: '/api/track', host: 'offwego.to',
    remoteAddress: '203.0.113.4', remotePort: 49152,
  })

  assert.equal(serializeRequestForLog({
    method: 'GET', url: '/api/media/trip/photo.jpg?expires=1&signature=private-signature',
  }).url, '/api/media/trip/photo.jpg')
})
