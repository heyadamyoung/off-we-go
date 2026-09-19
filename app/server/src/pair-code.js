import { randomInt } from 'node:crypto'

/* A phone is paired with six characters typed on it, not a QR code scanned
   from another screen. The alphabet leaves out what a person misreads — no
   O or 0, no I, L or 1 — and a typed code is forgiven its spaces, dashes and
   lower case. Six characters from thirty-one is nine hundred million codes,
   each alive a quarter of an hour and spent on its first use, behind a
   limiter on the claiming address; nobody is guessing one. */
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PAIR_CODE_LENGTH = 6
export const PAIR_CODE_TTL_MS = 15 * 60_000

export function makePairCode(random = randomInt) {
  let code = ''
  for (let at = 0; at < PAIR_CODE_LENGTH; at += 1) {
    code += PAIR_CODE_ALPHABET[random(PAIR_CODE_ALPHABET.length)]
  }
  return code
}

/** "k7m-4pq" → "K7M4PQ"; anything but letters and digits is dropped. */
export function normalizePairCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function isPairCode(text) {
  return typeof text === 'string' && text.length === PAIR_CODE_LENGTH && /^[A-Z0-9]+$/.test(text)
}
