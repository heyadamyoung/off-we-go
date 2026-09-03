import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeOfflineAge,
  forgetOffline,
  isDeniedByServer,
  isTripData,
  isTripLandingData,
  offlineAccountId,
  readOffline,
  saveOffline,
  shouldServeOffline,
  withOfflineFallback,
} from '../src/offline-trip-core.ts'

const NOW = Date.parse('2026-09-02T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const tripBag = (title = 'Amsterdam') => ({
  tripId: 'trip-1',
  trip: { title },
  stops: [{ id: 'stop-1', name: 'Rijksmuseum', lng: 4.88, lat: 52.36 }],
  photos: [],
  route: [],
  family: [{ name: 'Adam' }],
  comments: {},
  likes: [],
  me: { name: 'Adam' },
  canEdit: true,
})

/** A browser's localStorage: synchronous. */
const webStorage = () => {
  const map = new Map()
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: key => {
      map.delete(key)
    },
  }
}

/** Capacitor Preferences: every call a promise. */
const nativeStorage = () => {
  const inner = webStorage()
  return {
    map: inner.map,
    async getItem(key) {
      return inner.getItem(key)
    },
    async setItem(key, value) {
      inner.setItem(key, value)
    },
    async removeItem(key) {
      inner.removeItem(key)
    },
  }
}

const readTrip = (storage, options) => readOffline(storage, { ...options, valid: isTripData })

test('a cached trip comes back for the account that cached it', async () => {
  const storage = webStorage()

  assert.equal(
    await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW }),
    true,
  )
  const cached = await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW + 60_000 })

  assert.equal(cached?.data.trip.title, 'Amsterdam')
  assert.equal(cached?.at, NOW)
})

test('a promise-returning store works the same, so the native app caches too', async () => {
  const storage = nativeStorage()

  await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW })

  assert.equal(
    (await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW }))?.data.tripId,
    'trip-1',
  )
})

test('one account never reads another account cached trip on a shared device', async () => {
  const storage = webStorage()
  await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW })

  assert.equal(await readTrip(storage, { account: 'u2', slug: 'ams', now: NOW }), null)
})

test('a trip whose stored envelope claims another account is refused', async () => {
  const storage = webStorage()
  await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW })
  // A storage file copied between profiles: the key says u1, the envelope does not.
  const key = [...storage.map.keys()].find(name => name.includes('ams'))
  storage.map.set(
    key,
    JSON.stringify({ at: NOW, account: 'someone-else', slug: 'ams', data: tripBag() }),
  )

  assert.equal(await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW }), null)
})

test('a month-old trip is retired rather than shown as if it were the plan', async () => {
  const storage = webStorage()
  await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW })

  assert.ok(await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW + 29 * DAY }))
  assert.equal(await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW + 31 * DAY }), null)
})

test('past six trips the oldest is dropped, and its entry goes with it', async () => {
  const storage = webStorage()
  for (let index = 0; index < 7; index++) {
    await saveOffline(storage, {
      account: 'u1',
      slug: `trip-${index}`,
      data: tripBag(`Trip ${index}`),
      now: NOW + index * 1000,
    })
  }

  assert.equal(await readTrip(storage, { account: 'u1', slug: 'trip-0', now: NOW }), null)
  assert.ok(await readTrip(storage, { account: 'u1', slug: 'trip-6', now: NOW }))
  // The evicted entry is gone from the store, not merely unindexed.
  assert.equal(
    [...storage.map.keys()].some(key => key.endsWith('trip-0')),
    false,
  )
})

test('re-saving the same trip refreshes it instead of consuming another slot', async () => {
  const storage = webStorage()
  for (let index = 0; index < 8; index++) {
    await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW + index })
  }

  assert.equal([...storage.map.keys()].filter(key => key.includes('ams')).length, 1)
})

test('a payload too large to be a trip is refused rather than filling the quota', async () => {
  const storage = webStorage()
  const huge = { ...tripBag(), photos: [{ id: 'p', caption: 'x'.repeat(2_100_000) }] }

  assert.equal(
    await saveOffline(storage, { account: 'u1', slug: 'ams', data: huge, now: NOW }),
    false,
  )
  assert.equal(storage.map.size, 0)
})

test('a storage that refuses to write loses the cache, not the trip', async () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    removeItem: () => {},
  }

  assert.equal(
    await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW }),
    false,
  )
  assert.equal(await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW }), null)
})

test('a corrupted entry reads as no cache at all', async () => {
  const storage = webStorage()
  await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW })
  const key = [...storage.map.keys()].find(name => name.includes('ams'))
  storage.map.set(key, '{ not json')

  assert.equal(await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW }), null)
})

test('something that is not a trip never reaches the screen as one', async () => {
  const storage = webStorage()
  await saveOffline(storage, { account: 'u1', slug: 'ams', data: { tripId: 5 }, now: NOW })

  assert.equal(await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW }), null)
})

test('forgetting a trip removes both the entry and its index row', async () => {
  const storage = webStorage()
  await saveOffline(storage, { account: 'u1', slug: 'ams', data: tripBag(), now: NOW })

  await forgetOffline(storage, { account: 'u1', slug: 'ams' })

  assert.equal(await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW }), null)
  assert.equal(
    [...storage.map.keys()].some(key => key.includes('ams')),
    false,
  )
})

test('a dropped connection is served from the cache; a refusal never is', () => {
  assert.equal(shouldServeOffline(new TypeError('Failed to fetch')), true)
  assert.equal(shouldServeOffline(Object.assign(new Error('Network request failed'), {})), true)
  assert.equal(shouldServeOffline(Object.assign(new Error('Forbidden'), { status: 403 })), false)
  assert.equal(
    shouldServeOffline(Object.assign(new Error('Trip not found'), { status: 404 })),
    false,
  )
  assert.equal(shouldServeOffline(Object.assign(new Error('Server error'), { status: 500 })), false)
})

test('the answers that mean this trip is no longer yours are recognised', () => {
  for (const status of [401, 403, 404, 410])
    assert.equal(isDeniedByServer(Object.assign(new Error('no'), { status })), true)
  assert.equal(isDeniedByServer(Object.assign(new Error('later'), { status: 500 })), false)
  assert.equal(isDeniedByServer(new TypeError('Failed to fetch')), false)
})

test('an account is identified by id, then by email, and otherwise not at all', () => {
  assert.equal(offlineAccountId({ user: { id: 'u1', email: 'a@b.c' } }), 'u1')
  assert.equal(offlineAccountId({ user: { email: 'Adam@Example.COM ' } }), 'email:adam@example.com')
  assert.equal(offlineAccountId({ user: {} }), null)
  assert.equal(offlineAccountId(null), null)
})

test('the landing list is recognised only when it carries both of its lists', () => {
  assert.equal(isTripLandingData({ landing: true, trips: [], invites: [] }), true)
  assert.equal(isTripLandingData({ landing: true, trips: [] }), false)
  assert.equal(isTripLandingData({ trips: [], invites: [] }), false)
})

test('the age reads as plain English at every scale', () => {
  assert.equal(describeOfflineAge(NOW, NOW + 20_000), 'moments ago')
  assert.equal(describeOfflineAge(NOW, NOW + 60_000), '1 minute ago')
  assert.equal(describeOfflineAge(NOW, NOW + 42 * 60_000), '42 minutes ago')
  assert.equal(describeOfflineAge(NOW, NOW + 3 * 60 * 60_000), '3 hours ago')
  assert.equal(describeOfflineAge(NOW, NOW + 26 * 60 * 60_000), 'yesterday')
  assert.equal(describeOfflineAge(NOW, NOW + 5 * DAY), '5 days ago')
  // A clock that moved backwards must not read as a trip synced in the future.
  assert.equal(describeOfflineAge(NOW, NOW - 60_000), 'moments ago')
})

/* ---- the policy the loaders actually run ------------------------------- */

const failing = message => () => Promise.reject(new TypeError(message))
const refusing = status => () => Promise.reject(Object.assign(new Error('nope'), { status }))

test('a successful load is kept, and the next one offline is handed straight back', async () => {
  const storage = webStorage()
  const options = { account: 'u1', slug: 'ams', valid: isTripData }

  await withOfflineFallback(storage, { ...options, load: async () => tripBag(), now: NOW })
  const offline = await withOfflineFallback(storage, {
    ...options,
    load: failing('Failed to fetch'),
    now: NOW + 5 * 60_000,
  })

  assert.equal(offline.trip.title, 'Amsterdam')
  // Stamped, so the screen can say so rather than passing it off as current.
  assert.equal(offline.offlineAt, NOW)
})

test('a live answer is never stamped as offline', async () => {
  const storage = webStorage()

  const fresh = await withOfflineFallback(storage, {
    account: 'u1',
    slug: 'ams',
    valid: isTripData,
    load: async () => tripBag(),
    now: NOW,
  })

  assert.equal(fresh.offlineAt, undefined)
})

test('a refusal is passed through, and the copy we were holding is let go', async () => {
  const storage = webStorage()
  const options = { account: 'u1', slug: 'ams', valid: isTripData }
  await withOfflineFallback(storage, { ...options, load: async () => tripBag(), now: NOW })

  await assert.rejects(
    () => withOfflineFallback(storage, { ...options, load: refusing(403), now: NOW }),
    /nope/,
  )
  // Removed from the trip: the next attempt has nothing left to fall back on.
  await assert.rejects(
    () => withOfflineFallback(storage, { ...options, load: failing('Failed to fetch'), now: NOW }),
    /Failed to fetch/,
  )
})

test('a server that is merely down keeps the copy for the next attempt', async () => {
  const storage = webStorage()
  const options = { account: 'u1', slug: 'ams', valid: isTripData }
  await withOfflineFallback(storage, { ...options, load: async () => tripBag(), now: NOW })

  await assert.rejects(
    () => withOfflineFallback(storage, { ...options, load: refusing(500), now: NOW }),
    /nope/,
  )
  const kept = await readTrip(storage, { account: 'u1', slug: 'ams', now: NOW })
  assert.ok(kept, 'a 500 is not the server disowning the trip')
})

test('an offline failure with nothing cached still reads as the failure it was', async () => {
  await assert.rejects(
    () =>
      withOfflineFallback(webStorage(), {
        account: 'u1',
        slug: 'ams',
        valid: isTripData,
        load: failing('Failed to fetch'),
        now: NOW,
      }),
    /Failed to fetch/,
  )
})

test('without a nameable account nothing is written and nothing is served', async () => {
  const storage = webStorage()

  await withOfflineFallback(storage, {
    account: null,
    slug: 'ams',
    valid: isTripData,
    load: async () => tripBag(),
    now: NOW,
  })

  assert.equal(storage.map.size, 0)
})

test('an answer that is not a trip is returned but never cached', async () => {
  const storage = webStorage()

  const result = await withOfflineFallback(storage, {
    account: 'u1',
    slug: 'ams',
    valid: isTripData,
    load: async () => ({ needsAuth: true }),
    now: NOW,
  })

  assert.deepEqual(result, { needsAuth: true })
  assert.equal(storage.map.size, 0)
})
