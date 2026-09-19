import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWebLocationDriver,
  describePositionError,
  metresBetween,
  STILL_MS,
} from '../src/web-tracking-core.ts'

/* A browser as a location driver: the Geolocation API in the plugin's
   shape, sending a fix when the phone has moved or has stood still a while,
   and saying in words why it cannot. */

function fakeGeolocation() {
  const watchers = new Map()
  let serial = 0
  return {
    watchers,
    watchPosition(success, error) {
      const id = ++serial
      watchers.set(id, { success, error })
      return id
    },
    clearWatch(id) {
      watchers.delete(id)
    },
    fix(latitude, longitude, timestamp, extra = {}) {
      for (const { success } of watchers.values())
        success({ coords: { latitude, longitude, accuracy: 8, ...extra }, timestamp })
    },
    fail(code) {
      for (const { error } of watchers.values()) error({ code })
    },
  }
}

test('a fix is sent when the phone moved ten metres, or stood still a minute', async () => {
  const geo = fakeGeolocation()
  const clock = 1_000_000
  const driver = createWebLocationDriver(geo, () => clock)
  const heard = []
  const id = await driver.addWatcher({ distanceFilter: 10 }, (location, error) => {
    heard.push(error ? { error: error.message } : location)
  })
  geo.fix(52.37, 4.9, clock, { speed: 1.5, heading: 90, altitude: 3 })
  geo.fix(52.37001, 4.9, clock + 5_000) // a metre: not worth a request
  geo.fix(52.3702, 4.9, clock + 10_000) // twenty-odd metres: sent
  geo.fix(52.3702, 4.9, clock + 10_000 + STILL_MS) // standing still, but a minute on: sent
  assert.equal(heard.length, 3)
  assert.deepEqual(heard[0], {
    latitude: 52.37,
    longitude: 4.9,
    accuracy: 8,
    altitude: 3,
    speed: 1.5,
    bearing: 90,
    time: clock,
  })
  driver.removeWatcher({ id })
  assert.equal(geo.watchers.size, 0, 'the watch is cleared when the driver lets go')
})

test('a refusal is said in words, a timeout is waited through, and no API is a plain no', async () => {
  const geo = fakeGeolocation()
  const driver = createWebLocationDriver(geo)
  const heard = []
  await driver.addWatcher({}, (location, error) => heard.push(error ? error.message : location))
  geo.fail(3)
  assert.equal(heard.length, 0, 'a timeout is not an error the person can act on')
  geo.fail(1)
  assert.match(heard[0], /Allow location access/)
  assert.equal(describePositionError({ code: 2 }), 'The phone could not find its position')

  const none = createWebLocationDriver(null)
  await assert.rejects(() => none.addWatcher({}, () => {}), /cannot share its location/)
})

test('metres between two points are metres', () => {
  assert.ok(
    Math.abs(
      metresBetween({ latitude: 52.37, longitude: 4.9 }, { latitude: 52.37, longitude: 4.9 }),
    ) < 0.01,
  )
  const km = metresBetween(
    { latitude: 52.37, longitude: 4.9 },
    { latitude: 52.379, longitude: 4.9 },
  )
  assert.ok(km > 990 && km < 1010, `${km}`)
})
