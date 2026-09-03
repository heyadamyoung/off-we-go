import type { AsyncStorage, Id, TripData, TripLandingData } from './shared/model/types'

/* What the app remembers so that a traveller with no signal still has their
   trip in their hand. Only what the server already sent them, only under the
   account that asked for it, and only while it is plausibly still true.

   The store is one key/value pair per trip plus one index, so it behaves the
   same on localStorage in a browser tab and on Preferences in the native app
   without either of them having to enumerate keys. */

const PREFIX = 'wayfare.offline.v1'
const INDEX_KEY = `${PREFIX}:index`

/** The trips list is cached like a trip, under a slug no trip can have. */
export const LANDING_SLUG = '@landing'

/* Six entries covers the landing list and the handful of trips anyone moves
   between; past that the oldest is dropped rather than left to grow. */
const MAX_ENTRIES = 6
/* The same horizon the GPS queue keeps. A month-old itinerary is a museum
   piece, and holding one any longer only makes the honest label read worse. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_BYTES = 2_000_000

interface Envelope<T> {
  at: number
  account: string
  slug: string
  data: T
}

interface IndexRow {
  account: string
  slug: string
  at: number
}

export interface CachedPayload<T> {
  data: T
  at: number
}

interface SessionLike {
  user?: { id?: Id; email?: string }
}

/* No account, no cache. A trip left behind on a shared device under a name we
   cannot pin to a signed-in person is a leak waiting for its moment. */
export function offlineAccountId(session: SessionLike | null | undefined): string | null {
  const id = session?.user?.id
  if (id != null && String(id).trim()) return String(id)
  const email = session?.user?.email
  return email?.trim() ? `email:${email.trim().toLowerCase()}` : null
}

const entryKey = (account: string, slug: string) =>
  `${PREFIX}:${encodeURIComponent(account)}:${encodeURIComponent(slug)}`

async function readText(storage: AsyncStorage, key: string): Promise<string | null> {
  try {
    return (await storage.getItem(key)) ?? null
  } catch {
    return null
  }
}

async function writeText(storage: AsyncStorage, key: string, value: string): Promise<boolean> {
  try {
    await storage.setItem(key, value)
    return true
  } catch {
    // A full quota or a locked-down private window: cache nothing, break nothing.
    return false
  }
}

async function drop(storage: AsyncStorage, key: string) {
  try {
    await storage.removeItem(key)
  } catch {
    /* the entry outlives us; the age check will retire it */
  }
}

const isIndexRow = (value: unknown): value is IndexRow => {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<IndexRow>
  return (
    typeof row.account === 'string' && typeof row.slug === 'string' && typeof row.at === 'number'
  )
}

async function readIndex(storage: AsyncStorage): Promise<IndexRow[]> {
  const raw = await readText(storage, INDEX_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isIndexRow) : []
  } catch {
    return []
  }
}

/* The index is read, changed and written back, so two saves landing together —
   a trip and the trips list, or two tabs — would each start from the same copy
   and the second would drop the first's row. The entry it named would then be
   invisible to both eviction and forgetting, and sit there until the quota
   ran out. They take turns. */
let indexLock: Promise<unknown> = Promise.resolve()

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = indexLock.then(work, work)
  indexLock = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/* Newest first, one row per trip, and anything past the cap is forgotten for
   real — an index that outgrows its entries is how a cache quietly leaks. */
async function rememberInIndex(storage: AsyncStorage, row: IndexRow) {
  const existing = await readIndex(storage)
  const rest = existing.filter(item => !(item.account === row.account && item.slug === row.slug))
  const kept = [row, ...rest].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES)
  const evicted = rest.filter(
    item => !kept.some(keep => keep.account === item.account && keep.slug === item.slug),
  )
  for (const item of evicted) await drop(storage, entryKey(item.account, item.slug))
  await writeText(storage, INDEX_KEY, JSON.stringify(kept))
}

interface SaveOptions<T> {
  account: string
  slug: string
  data: T
  now?: number
}

export async function saveOffline<T>(
  storage: AsyncStorage,
  { account, slug, data, now = Date.now() }: SaveOptions<T>,
): Promise<boolean> {
  const envelope: Envelope<T> = { at: now, account, slug, data }
  let text: string
  try {
    text = JSON.stringify(envelope)
  } catch {
    return false
  }
  /* A payload this size means something unbounded got in. Refusing it beats
     evicting every other trip to make room for it. */
  if (text.length > MAX_BYTES) return false
  if (!(await writeText(storage, entryKey(account, slug), text))) return false
  await inTurn(() => rememberInIndex(storage, { account, slug, at: now }))
  return true
}

interface ReadOptions<T> {
  account: string
  slug: string
  now?: number
  valid: (value: unknown) => value is T
}

export async function readOffline<T>(
  storage: AsyncStorage,
  { account, slug, now = Date.now(), valid }: ReadOptions<T>,
): Promise<CachedPayload<T> | null> {
  const raw = await readText(storage, entryKey(account, slug))
  if (!raw) return null
  let envelope: Envelope<unknown> | null
  try {
    envelope = JSON.parse(raw) as Envelope<unknown>
  } catch {
    return null
  }
  if (!envelope || typeof envelope.at !== 'number') return null
  /* The key already carries the account. This checks it again from the inside,
     because a storage file copied between profiles must never hand one person
     another person's trip. */
  if (envelope.account !== account || envelope.slug !== slug) return null
  if (now - envelope.at > MAX_AGE_MS) return null
  return valid(envelope.data) ? { data: envelope.data, at: envelope.at } : null
}

export async function forgetOffline(
  storage: AsyncStorage,
  { account, slug }: { account: string; slug: string },
) {
  await drop(storage, entryKey(account, slug))
  await inTurn(async () => {
    const kept = (await readIndex(storage)).filter(
      row => !(row.account === account && row.slug === slug),
    )
    await writeText(storage, INDEX_KEY, JSON.stringify(kept))
  })
}

/* A dropped connection is the case this cache exists for. A refusal is not: if
   the server has just said who you are or what you may see, that answer is the
   truth, and the copy we are holding is either stale or no longer ours. */
export function shouldServeOffline(caught: unknown): boolean {
  const error = caught as { status?: number; message?: string } | null
  if (Number(error?.status || 0) > 0) return false
  if (caught instanceof TypeError) return true
  return /fetch|network|offline|connection/i.test(String(error?.message || ''))
}

const DENIALS = new Set([401, 403, 404, 410])

/** The server has answered, and the answer is that this is not yours to hold. */
export function isDeniedByServer(caught: unknown): boolean {
  return DENIALS.has(Number((caught as { status?: number } | null)?.status || 0))
}

interface FallbackOptions<R, T extends R & object> {
  /** Null when we cannot name the account; then nothing is kept or served. */
  account: string | null
  slug: string
  valid: (value: unknown) => value is T
  load: () => Promise<R>
  now?: number
}

/* The whole policy in one place: keep what the server sends, hand back the
   kept copy when the connection is what failed, and let go of it the moment
   the server says it is not ours. Callers get their own answer either way —
   the only difference is the offlineAt stamp on a copy that came from here. */
export async function withOfflineFallback<R, T extends R & object>(
  storage: AsyncStorage,
  { account, slug, valid, load, now = Date.now() }: FallbackOptions<R, T>,
): Promise<R> {
  try {
    const result = await load()
    if (account && valid(result)) await saveOffline(storage, { account, slug, data: result, now })
    return result
  } catch (caught) {
    if (!account) throw caught
    if (shouldServeOffline(caught)) {
      const cached = await readOffline(storage, { account, slug, now, valid })
      if (cached) return { ...cached.data, offlineAt: cached.at }
    }
    // Removed from the trip, or signed out: stop holding a copy of it.
    if (isDeniedByServer(caught)) await forgetOffline(storage, { account, slug })
    throw caught
  }
}

export function isTripData(value: unknown): value is TripData {
  if (!value || typeof value !== 'object') return false
  const bag = value as Partial<TripData>
  return (
    typeof bag.tripId === 'string' &&
    !!bag.trip &&
    typeof bag.trip === 'object' &&
    Array.isArray(bag.stops) &&
    Array.isArray(bag.photos) &&
    Array.isArray(bag.family)
  )
}

export function isTripLandingData(value: unknown): value is TripLandingData {
  if (!value || typeof value !== 'object') return false
  const bag = value as Partial<TripLandingData>
  return bag.landing === true && Array.isArray(bag.trips) && Array.isArray(bag.invites)
}

/* Read out loud on the chip, so "offline" is never mistaken for "up to date".
   Deliberately coarse: to the minute is a precision nobody standing in a
   piazza on one bar of signal needs. */
export function describeOfflineAge(at: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'moments ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
