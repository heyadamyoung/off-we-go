import { errorMessage } from './shared/model/types'
import type {
  LocationDriver,
  NativeLocation,
  TrackerState,
  TrackerStorage,
  TrackingConfig,
  TrackingFetch,
} from './mobile-tracking-contract'

export type {
  LocationDriver,
  NativeLocation,
  TrackerState,
  TrackerStorage,
  TrackingConfig,
  TrackingFetch,
  TrackingResponse,
  WatcherOptions,
} from './mobile-tracking-contract'

const CONFIG_KEY = 'wayfare.mobile-tracking.config.v1'
const QUEUE_KEY = 'wayfare.mobile-tracking.queue.v1'
const MAX_QUEUED_FIXES = 2_000
const MAX_FIX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DISCARDABLE_STATUSES = new Set([400, 409, 413, 415, 422])

interface TrackPayload {
  _type: 'location'
  lat: number
  lon: number
  tst: number
  acc?: number
  alt?: number
  vel?: number
  cog?: number
}

interface QueuedFix {
  payload: TrackPayload
  at: number
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function payloadFor(location: NativeLocation | null | undefined) {
  if (
    !location ||
    !finite(location.latitude) ||
    !finite(location.longitude) ||
    Math.abs(location.latitude) > 90 ||
    Math.abs(location.longitude) > 180
  )
    return null

  const at = finite(location.time) ? location.time : Date.now()
  const payload: TrackPayload = {
    _type: 'location',
    lat: location.latitude,
    lon: location.longitude,
    tst: Math.floor(at / 1000),
  }
  if (finite(location.accuracy)) payload.acc = location.accuracy
  if (finite(location.altitude)) payload.alt = location.altitude
  if (finite(location.speed)) payload.vel = location.speed * 3.6
  if (finite(location.bearing)) payload.cog = location.bearing
  return { payload, at }
}

function readJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function validConfig(value: unknown): value is TrackingConfig {
  const config = value as TrackingConfig | null | undefined
  if (
    !config ||
    typeof config.token !== 'string' ||
    config.token.length < 16 ||
    typeof config.deviceId !== 'string' ||
    !config.deviceId
  )
    return false
  try {
    const url = new URL(config.endpoint)
    const local =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
    return url.protocol === 'https:' || (url.protocol === 'http:' && local)
  } catch {
    return false
  }
}

export function createMobileTracker({
  driver,
  storage,
  fetch: fetchFn,
  now = Date.now,
}: {
  driver: LocationDriver
  storage: TrackerStorage
  fetch: TrackingFetch
  now?: () => number
}) {
  if (!driver || !storage || !fetchFn)
    throw new Error('A location driver, persistent storage and fetch are required')

  let config: TrackingConfig | null = null
  let watcherId: string | null = null
  let queue: QueuedFix[] | null = null
  let flushing: Promise<void> | null = null
  let retryAt = 0
  const listeners = new Set<(state: TrackerState) => void>()
  let state: TrackerState = {
    status: 'stopped',
    configured: false,
    deviceId: null,
    name: null,
    queued: 0,
    lastSentAt: null,
    error: null,
  }

  const publish = (patch: Partial<TrackerState>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => {
      listener({ ...state })
    })
  }

  const saveQueue = async () => {
    await storage.set({ key: QUEUE_KEY, value: JSON.stringify(queue) })
    publish({ queued: queue!.length })
  }

  const loadQueue = async () => {
    if (queue) return queue
    const { value } = await storage.get({ key: QUEUE_KEY })
    queue = readJson<QueuedFix[]>(value, [])
    if (!Array.isArray(queue)) queue = []
    const originalLength = queue.length
    const cutoff = now() - MAX_FIX_AGE_MS
    queue = queue.filter(fix => finite(fix?.at) && fix.at >= cutoff)
    if (queue.length !== originalLength) {
      await storage.set({ key: QUEUE_KEY, value: JSON.stringify(queue) })
    }
    publish({ queued: queue.length })
    return queue
  }

  const forget = async (error: string | null = null) => {
    if (watcherId) await driver.removeWatcher({ id: watcherId })
    watcherId = null
    config = null
    queue = []
    await Promise.all([storage.remove({ key: CONFIG_KEY }), storage.remove({ key: QUEUE_KEY })])
    publish({
      status: 'stopped',
      configured: false,
      deviceId: null,
      name: null,
      queued: 0,
      error,
    })
  }

  const flush = async () => {
    if (flushing) return flushing
    flushing = (async () => {
      await loadQueue()
      while (queue!.length && config) {
        if (now() < retryAt) {
          const seconds = Math.max(1, Math.ceil((retryAt - now()) / 1000))
          publish({
            status: 'waiting',
            error: `Location service rate limited; retrying in ${seconds} seconds`,
          })
          break
        }
        const fix = queue![0]
        try {
          const response = await fetchFn(config.endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${config.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(fix.payload),
          })
          if (response.status === 429) {
            const raw = response.headers.get('retry-after')
            // Number(null) is 0, and 0 is finite — without this an absent
            // header stands the phone down for one second instead of a minute.
            const seconds = raw == null || raw === '' ? Number.NaN : Number(raw)
            const date = Date.parse(raw || '')
            retryAt = Number.isFinite(seconds)
              ? now() + Math.max(1, seconds) * 1000
              : Number.isFinite(date)
                ? Math.max(now() + 1000, date)
                : now() + 60_000
            throw new Error('Location service rate limited')
          }
          if (response.status === 401) {
            await forget(
              'This phone registration was revoked. Set up location sharing again to resume.',
            )
            return
          }
          if (!response.ok && DISCARDABLE_STATUSES.has(response.status)) {
            queue!.shift()
            await saveQueue()
            publish({
              status: 'error',
              error: `A location was rejected (${response.status}) and removed from the queue`,
            })
            continue
          }
          if (!response.ok) throw new Error(`Location service returned ${response.status}`)
          retryAt = 0
          queue!.shift()
          await saveQueue()
          publish({ status: 'tracking', lastSentAt: fix.at, error: null })
        } catch (error) {
          publish({ status: 'waiting', error: errorMessage(error, 'Location could not be sent') })
          break
        }
      }
    })().finally(() => {
      flushing = null
    })
    return flushing
  }

  const receive = async (location: NativeLocation | null | undefined, error?: Error) => {
    if (error) {
      publish({ status: 'error', error: error.message || String(error) })
      return
    }
    const fix = payloadFor(location)
    if (!fix) {
      publish({ status: 'error', error: 'The phone returned an invalid location' })
      return
    }
    await loadQueue()
    queue!.push(fix)
    if (queue!.length > MAX_QUEUED_FIXES) queue!.splice(0, queue!.length - MAX_QUEUED_FIXES)
    await saveQueue()
    publish({ status: 'waiting', error: null })
    await flush()
  }

  const start = async () => {
    if (!validConfig(config))
      throw new Error('Register this phone before starting location sharing')
    if (watcherId) return { ...state }
    if (config.enabled !== true) {
      config = { ...config, enabled: true }
      await storage.set({ key: CONFIG_KEY, value: JSON.stringify(config) })
    }
    publish({ status: 'starting', error: null })
    try {
      watcherId = await driver.addWatcher(
        {
          backgroundTitle: 'Off We Go location sharing',
          backgroundMessage: 'Your trip location is being shared with your Off We Go group.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
        },
        receive,
      )
      publish({
        status: 'tracking',
        configured: true,
        deviceId: config.deviceId,
        name: config.name || 'This phone',
      })
      await flush()
      return { ...state }
    } catch (error) {
      publish({ status: 'error', error: errorMessage(error, 'Location sharing could not start') })
      throw error
    }
  }

  return {
    async configure(next: TrackingConfig) {
      if (!validConfig(next)) throw new Error('The phone registration is incomplete')
      if (watcherId) {
        await driver.removeWatcher({ id: watcherId })
        watcherId = null
      }
      config = {
        endpoint: next.endpoint,
        token: next.token,
        deviceId: next.deviceId,
        name: next.name || 'This phone',
        enabled: true,
      }
      await storage.set({ key: CONFIG_KEY, value: JSON.stringify(config) })
      publish({ configured: true, deviceId: config.deviceId, name: config.name ?? null })
      return start()
    },
    async restore() {
      const { value } = await storage.get({ key: CONFIG_KEY })
      const saved = readJson<TrackingConfig | null>(value, null)
      if (!validConfig(saved)) return false
      // Configurations written before the pause flag existed were actively
      // tracking, so preserve that behavior during migration.
      config = { ...saved, enabled: saved.enabled !== false }
      publish({ configured: true, deviceId: config.deviceId, name: config.name || 'This phone' })
      if (!config.enabled) return true
      await start()
      return true
    },
    start,
    async stop() {
      if (watcherId) await driver.removeWatcher({ id: watcherId })
      watcherId = null
      if (validConfig(config)) {
        config = { ...config, enabled: false }
        await storage.set({ key: CONFIG_KEY, value: JSON.stringify(config) })
        /* Tell the trip this was a decision. Without the beacon the viewers
           can only watch fixes go stale, and "no update for 40 min" is the
           copy that frightens a parent. Best effort: a beacon that cannot be
           sent simply leaves the honest stale copy standing. */
        try {
          await fetchFn(config.endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${config.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ paused: true }),
          })
        } catch {
          /* offline — the stale copy stays truthful */
        }
      }
      publish({ status: 'stopped', error: null })
    },
    forget,
    getState() {
      return { ...state }
    },
    subscribe(listener: (state: TrackerState) => void) {
      listeners.add(listener)
      listener({ ...state })
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type MobileTracker = ReturnType<typeof createMobileTracker>
