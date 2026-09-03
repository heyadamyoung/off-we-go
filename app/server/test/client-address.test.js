import test from 'node:test'
import assert from 'node:assert/strict'
import { clientAddress } from '../src/rateLimit.js'

/* Limiters keyed on request.ip saw a Cloudflare edge address and lumped
   every phone behind it into one bucket — a family at one airport split
   thirty lookups and the second phone starved. The edge's own header is
   the truth, and the fallback still works with Cloudflare out of the way. */
test('the true client wins over the shared edge address', () => {
  assert.equal(
    clientAddress({ headers: { 'cf-connecting-ip': '203.0.113.7' }, ip: '172.68.1.1' }),
    '203.0.113.7',
  )
  assert.equal(
    clientAddress({ headers: { 'cf-connecting-ip': ['203.0.113.7'] }, ip: '172.68.1.1' }),
    '203.0.113.7',
  )
  assert.equal(clientAddress({ headers: {}, ip: '192.0.2.9' }), '192.0.2.9')
  assert.equal(clientAddress({ headers: {} }), 'unknown')
})
