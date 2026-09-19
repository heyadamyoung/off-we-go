/* The pairing code as the phone types it: six letters and numbers, forgiven
   their spaces, dashes and case, and shown in two halves so a person reads
   "K7M 4PQ" rather than a password. Mirrors server/src/pair-code.js. */

export const PAIR_CODE_LENGTH = 6

export function normalizePairCode(text: string | null | undefined): string {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function isPairCode(text: string): boolean {
  return text.length === PAIR_CODE_LENGTH && /^[A-Z0-9]+$/.test(text)
}

/** "K7M4PQ" → "K7M 4PQ": the way it is read out across a kitchen. */
export function spellPairCode(code: string): string {
  const clean = normalizePairCode(code)
  return clean.length > 3 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : clean
}

/** How long a code has left, in words for the screen; null once it is gone. */
export function pairCodeLifeWords(expiresAt: string, now: number): string | null {
  const left = Date.parse(expiresAt) - now
  if (!Number.isFinite(left) || left <= 0) return null
  const minutes = Math.ceil(left / 60_000)
  return minutes <= 1 ? 'less than a minute' : `${minutes} minutes`
}
