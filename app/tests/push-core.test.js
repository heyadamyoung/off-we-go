import assert from 'node:assert/strict'
import test from 'node:test'
import { PUSH_OFFER, applicationServerKey, pushSupport } from '../src/push-core.ts'

/* Where the offer is drawn at all, and how the server's key becomes bytes. */

const browser = {
  native: false,
  sample: false,
  backend: true,
  worker: true,
  pushManager: true,
  notifications: true,
  permission: 'default',
}

test('the offer is drawn only where it can be taken', () => {
  assert.equal(pushSupport(browser), 'ready')
  assert.equal(pushSupport({ ...browser, native: true }), 'unsupported', 'the app has its own')
  assert.equal(
    pushSupport({ ...browser, sample: true }),
    'unsupported',
    'no server behind the sample',
  )
  assert.equal(pushSupport({ ...browser, backend: false }), 'unsupported')
  assert.equal(
    pushSupport({ ...browser, worker: false }),
    'unsupported',
    'no worker in development',
  )
  assert.equal(pushSupport({ ...browser, pushManager: false }), 'unsupported', 'Safari in a tab')
  assert.equal(pushSupport({ ...browser, notifications: false }), 'unsupported')
  assert.equal(pushSupport({ ...browser, permission: 'denied' }), 'denied')
  assert.equal(pushSupport({ ...browser, permission: 'granted' }), 'ready')
})

test('the key is base64url in and bytes out', () => {
  assert.deepEqual([...applicationServerKey('AQID')], [1, 2, 3])
  assert.deepEqual([...applicationServerKey('-_8')], [251, 255], 'url-safe letters, no padding')
  /* A real key is 65 bytes: an uncompressed P-256 point. */
  const point = Buffer.from(Array.from({ length: 65 }, (_, i) => (i * 7) % 256))
  const bytes = applicationServerKey(point.toString('base64url'))
  assert.equal(bytes.length, 65)
  assert.deepEqual([...bytes], [...point])
})

test('the offer says what the phone will hear', () => {
  assert.match(PUSH_OFFER.off, /gate/)
  assert.match(PUSH_OFFER.on, /landings/)
})
