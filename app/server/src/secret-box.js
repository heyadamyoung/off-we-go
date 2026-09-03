/* A refresh token has to come back out again, so unlike a device token it is
   encrypted rather than hashed. AES-256-GCM, key from the environment, and the
   ciphertext carries its own nonce and tag so a stored value is one string. */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'

export function readKey(value) {
  const key = Buffer.from(String(value || ''), 'base64')
  if (key.length !== 32) {
    throw new Error('MAILBOX_TOKEN_KEY must be 32 bytes of base64 (openssl rand -base64 32)')
  }
  return key
}

export function createSecretBox(rawKey, random = randomBytes) {
  const key = readKey(rawKey)

  return {
    seal(plain) {
      if (plain == null) return null
      const nonce = random(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
      return [
        VERSION,
        nonce.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        body.toString('base64'),
      ].join('.')
    },

    open(sealed) {
      if (!sealed) return null
      const [version, nonce, tag, body] = String(sealed).split('.')
      if (version !== VERSION || !nonce || !tag || !body) {
        throw new Error('That stored token is not in a shape this can read')
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(body, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}
