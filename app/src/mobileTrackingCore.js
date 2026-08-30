const CONFIG_KEY = 'wayfare.mobile-tracking.config.v1'
const QUEUE_KEY = 'wayfare.mobile-tracking.queue.v1'
const MAX_QUEUED_FIXES = 2_000
const MAX_FIX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DISCARDABLE_STATUSES = new Set([400, 409, 413, 415, 422])

const finite = value => typeof value === 'number' && Number.isFinite(value)

function payloadFor(location) {
  if (!location || !finite(location.latitude) || !finite(location.longitude)
      || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return null

  const at = finite(location.time) ? location.time : Date.now()
  const payload = {
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

function readJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function validConfig(value) {
  if (!value || typeof value.token !== 'string' || value.token.length < 16
      || typeof value.deviceId !== 'string' || !value.deviceId) return false
  try {
    const url = new URL(value.endpoint)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
    return url.protocol === 'https:' || (url.protocol === 'http:' && local)
  } catch { return false }
}

export function createMobileTracker({ driver, storage, fetch: fetchFn, now = Date.now }) {
  if (!driver || !storage || !fetchFn) throw new Error('A location driver, persistent storage and fetch are required')

  let config = null
  let watcherId = null
  let queue = null
  let flushing = null
  let retryAt = 0
  const listeners = new Set()
  let state = {
    status: 'stopped', configured: false, deviceId: null, name: null,
    queued: 0, lastSentAt: null, error: null,
  }

  const publish = patch => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener({ ...state }))
  }

  const saveQueue = async () => {
    await storage.set({ key: QUEUE_KEY, value: JSON.stringify(queue) })
    publish({ queued: queue.length })
  }

  const loadQueue = async () => {
    if (queue) return queue
    const { value } = await storage.get({ key: QUEUE_KEY })
    queue = readJson(value, [])
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

  const forget = async (error = null) => {
    if (watcherId) await driver.removeWatcher({ id: watcherId })
    watcherId = null
    config = null
    queue = []
    await Promise.all([storage.remove({ key: CONFIG_KEY }), storage.remove({ key: QUEUE_KEY })])
    publish({
      status: 'stopped', configured: false, deviceId: null, name: null,
      queued: 0, error,
    })
  }

  const flush = async () => {
    if (flushing) return flushing
    flushing = (async () => {
      await loadQueue()
      while (queue.length && config) {
        if (now() < retryAt) {
          const seconds = Math.max(1, Math.ceil((retryAt - now()) / 1000))
          publish({ status: 'waiting', error: `Location service rate limited; retrying in ${seconds} seconds` })
          break
        }
        const fix = queue[0]
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
            const seconds = Number(raw)
            const date = Date.parse(raw || '')
            retryAt = Number.isFinite(seconds)
              ? now() + Math.max(1, seconds) * 1000
              : Number.isFinite(date) ? Math.max(now() + 1000, date) : now() + 60_000
            throw new Error('Location service rate limited')
          }
          if (response.status === 401) {
            await forget('This phone registration was revoked. Set up location sharing again to resume.')
            return
          }
          if (!response.ok && DISCARDABLE_STATUSES.has(response.status)) {
            queue.shift()
            await saveQueue()
            publish({ status: 'error', error: `A location was rejected (${response.status}) and removed from the queue` })
            continue
          }
          if (!response.ok) throw new Error(`Location service returned ${response.status}`)
          retryAt = 0
          queue.shift()
          await saveQueue()
          publish({ status: 'tracking', lastSentAt: fix.at, error: null })
        } catch (error) {
          publish({ status: 'waiting', error: error?.message || 'Location could not be sent' })
          break
        }
      }
    })().finally(() => { flushing = null })
    return flushing
  }

  const receive = async (location, error) => {
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
    queue.push(fix)
    if (queue.length > MAX_QUEUED_FIXES) queue.splice(0, queue.length - MAX_QUEUED_FIXES)
    await saveQueue()
    publish({ status: 'waiting', error: null })
    await flush()
  }

  const start = async () => {
    if (!validConfig(config)) throw new Error('Register this iPhone before starting location sharing')
    if (watcherId) return { ...state }
    if (config.enabled !== true) {
      config = { ...config, enabled: true }
      await storage.set({ key: CONFIG_KEY, value: JSON.stringify(config) })
    }
    publish({ status: 'starting', error: null })
    try {
      watcherId = await driver.addWatcher({
        backgroundTitle: 'Wayfare location sharing',
        backgroundMessage: 'Your trip location is being shared with your Wayfare group.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 10,
      }, receive)
      publish({ status: 'tracking', configured: true, deviceId: config.deviceId, name: config.name || 'This iPhone' })
      await flush()
      return { ...state }
    } catch (error) {
      publish({ status: 'error', error: error?.message || 'Location sharing could not start' })
      throw error
    }
  }

  return {
    async configure(next) {
      if (!validConfig(next)) throw new Error('The phone registration is incomplete')
      if (watcherId) {
        await driver.removeWatcher({ id: watcherId })
        watcherId = null
      }
      config = {
        endpoint: next.endpoint, token: next.token, deviceId: next.deviceId,
        name: next.name || 'This iPhone', enabled: true,
      }
      await storage.set({ key: CONFIG_KEY, value: JSON.stringify(config) })
      publish({ configured: true, deviceId: config.deviceId, name: config.name })
      return start()
    },
    async restore() {
      const { value } = await storage.get({ key: CONFIG_KEY })
      const saved = readJson(value, null)
      if (!validConfig(saved)) return false
      // Configurations written before the pause flag existed were actively
      // tracking, so preserve that behavior during migration.
      config = { ...saved, enabled: saved.enabled !== false }
      publish({ configured: true, deviceId: config.deviceId, name: config.name || 'This iPhone' })
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
      }
      publish({ status: 'stopped', error: null })
    },
    forget,
    getState() { return { ...state } },
    subscribe(listener) {
      listeners.add(listener)
      listener({ ...state })
      return () => listeners.delete(listener)
    },
  }
}
