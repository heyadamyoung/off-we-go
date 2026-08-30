import test from 'node:test'
import assert from 'node:assert/strict'
import { createWindowRateLimiter } from '../src/rateLimit.js'

test('rate-limit buckets expire and stay bounded under unique-key attacks', () => {
  let now = 1_800_000_000_000
  const limiter = createWindowRateLimiter({ clock: () => now, maxEntries: 100 })
  for (let index = 0; index < 1_000; index++) {
    limiter.hit(`attacker-${index}`, { max: 3, windowMs: 60_000 })
  }
  assert.ok(limiter.size() <= 100)

  now += 60_001
  limiter.hit('fresh', { max: 3, windowMs: 60_000 })
  assert.equal(limiter.size(), 1)
})
