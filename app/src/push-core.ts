/* Web push, the pure parts: whether this browser can be told at all, how
   the server's key is handed to it, and the words on the offer.
 *
 * A phone that is not running the app is told about the travel day by the
 * server, one card per leg, replaced in place, a sound only for the moments
 * worth one — the rule is in server/src/push/card.js. This side asks the
 * browser for an address and hands it over; the rest is the server's. */

export type PushSupport = 'unsupported' | 'denied' | 'ready'

export interface PushEnvironment {
  /** the native app has its own notifications, and no service worker */
  native: boolean
  /** the sample trip has no server behind it */
  sample: boolean
  backend: boolean
  /** the app-shell worker is registered (production builds only) */
  worker: boolean
  pushManager: boolean
  notifications: boolean
  permission?: string
}

export function pushSupport(env: PushEnvironment): PushSupport {
  if (env.native || env.sample || !env.backend || !env.worker) return 'unsupported'
  if (!env.pushManager || !env.notifications) return 'unsupported'
  if (env.permission === 'denied') return 'denied'
  return 'ready'
}

/** The server's VAPID key, base64url, as the bytes PushManager wants. */
export function applicationServerKey(key: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (key.length % 4)) % 4)
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  /* On its own buffer, which is what PushManager.subscribe accepts. */
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Remembered per browser, so the offer knows which way it is. */
export const REMEMBER_PUSH = 'offwego.push'

export const PUSH_OFFER = {
  off: 'Get told on this phone when the gate, the plan or the landing changes',
  on: 'This phone is told about gates, boarding, delays and landings',
} as const
