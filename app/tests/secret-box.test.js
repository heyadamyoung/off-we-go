import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { createSecretBox, readKey } from '../server/src/secret-box.js'

const key = randomBytes(32).toString('base64')

test('what goes in comes back out', () => {
  const box = createSecretBox(key)
  const sealed = box.seal('refresh-token-from-microsoft')

  assert.notEqual(sealed, 'refresh-token-from-microsoft', 'the point is that it is not readable')
  assert.equal(box.open(sealed), 'refresh-token-from-microsoft')
})

test('the same token seals differently every time', () => {
  const box = createSecretBox(key)
  assert.notEqual(box.seal('same'), box.seal('same'), 'a repeated ciphertext leaks that they match')
})

/* A tampered token must fail loudly rather than decrypt to something else. */
test('a value that has been meddled with is refused', () => {
  const box = createSecretBox(key)
  const sealed = box.seal('refresh-token')
  const [version, nonce, tag, body] = sealed.split('.')
  const flipped = Buffer.from(body, 'base64')
  flipped[0] ^= 0xff

  assert.throws(() => box.open([version, nonce, tag, flipped.toString('base64')].join('.')))
  assert.throws(() => box.open('not-even-close'), /shape this can read/)
})

test('another key cannot read it', () => {
  const sealed = createSecretBox(key).seal('refresh-token')
  assert.throws(() => createSecretBox(randomBytes(32).toString('base64')).open(sealed))
})

test('nothing seals to nothing, rather than to a token', () => {
  const box = createSecretBox(key)
  assert.equal(box.seal(null), null)
  assert.equal(box.open(null), null)
})

test('a key that is not a key says so, with how to make one', () => {
  assert.throws(() => readKey(''), /32 bytes of base64/)
  assert.throws(() => readKey(randomBytes(16).toString('base64')), /32 bytes/)
  assert.equal(readKey(key).length, 32)
})
