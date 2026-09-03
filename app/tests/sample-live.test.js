import assert from 'node:assert/strict'
import test from 'node:test'
import { sampleLiveHistory, sampleLiveNow } from '../src/sample-live-core.ts'
import {
  ARRIVAL_RADIUS_METRES,
  ARRIVAL_MAX_SPEED_METRES_PER_SECOND,
} from '../src/live-stop-progress-core.ts'
import { TRAIL_GAP_MS, TRAIL_MAX_ACCURACY_METRES } from '../src/trail-core.ts'
import { LIVE_FIX_MAX_ACCURACY_METRES } from '../src/live-freshness-core.ts'
import { metres } from '../src/shared/lib/geo.ts'
import { STOPS, FAMILY } from '../src/data.ts'

const at = iso => new Date(iso)
const stop = id => STOPS.find(s => s.id === id)

test('the sample walk is a pure function of the clock', () => {
  const moment = at('2026-09-05T13:00:00Z')
  assert.deepEqual(sampleLiveNow(moment), sampleLiveNow(moment))
  const later = sampleLiveNow(at('2026-09-05T13:00:30Z'))
  assert.notDeepEqual(sampleLiveNow(moment)[0].lng, later[0].lng, 'she is walking, not parked')
})

test('every fix satisfies the thresholds the real pipeline enforces', () => {
  const now = at('2026-09-05T13:00:00Z')
  const { devices, fixes } = sampleLiveHistory(now)
  assert.ok(fixes.length > 400, 'a Friday, a morning and two hours of laps is a real backlog')
  for (const fix of fixes) {
    assert.ok(
      fix.lng > 4.75 && fix.lng < 4.94 && fix.lat > 52.3 && fix.lat < 52.395,
      'between Schiphol and the IJ',
    )
    assert.ok(fix.accuracy <= TRAIL_MAX_ACCURACY_METRES, 'every fix is trail-worthy')
    assert.ok(fix.accuracy <= LIVE_FIX_MAX_ACCURACY_METRES, 'every fix counts as reliable')
    assert.ok(fix.at.getTime() <= now.getTime(), 'no fixes from the future')
  }
  const ids = new Set(devices.map(d => d.userId))
  for (const id of ids)
    assert.ok(
      FAMILY.some(person => person.id === id),
      'phones belong to the family',
    )
})

test("Maya's history splits exactly at the overnight, never inside a day", () => {
  const now = at('2026-09-05T13:00:00Z')
  const maya = sampleLiveHistory(now)
    .fixes.filter(fix => fix.deviceId === 'sample-phone-maya')
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  let splits = 0
  for (let i = 1; i < maya.length; i++) {
    const pause = maya[i].at.getTime() - maya[i - 1].at.getTime()
    if (pause >= TRAIL_GAP_MS) {
      splits++
      continue // the overnight; distance across it is the walk home, off the record
    }
    const jump = metres([maya[i - 1].lng, maya[i - 1].lat], [maya[i].lng, maya[i].lat])
    assert.ok(jump < 500, `no teleporting inside a day (${Math.round(jump)} m, train included)`)
  }
  assert.equal(splits, 1, 'one overnight, so the trail draws one line per day')
})

test("Friday's stops are all in the record, so progress never resurrects them", () => {
  const now = at('2026-09-05T13:00:00Z')
  const fixes = sampleLiveHistory(now).fixes.filter(fix => fix.deviceId === 'sample-phone-maya')
  for (const id of ['s1', 's2', 's3']) {
    const there = stop(id)
    const visited = fixes.some(
      fix =>
        fix.speed <= ARRIVAL_MAX_SPEED_METRES_PER_SECOND &&
        metres([fix.lng, fix.lat], [there.lng, there.lat]) < ARRIVAL_RADIUS_METRES,
    )
    assert.ok(visited, `${there.name} was honestly visited on Friday`)
  }
})

test('the loop honestly arrives at the Saturday stops', () => {
  // Scan one full lap: somewhere in it she is standing at the museum steps,
  // and somewhere she is standing at Foodhallen — inside the arrival radius,
  // under the arrival speed, so the capsule may truthfully say "arrived".
  const rijks = stop('s4')
  const foodhallen = stop('s5')
  let atRijks = false
  let atFood = false
  const start = at('2026-09-05T10:00:00Z').getTime()
  for (let t = start; t < start + 60 * 60_000; t += 30_000) {
    const [maya] = sampleLiveNow(new Date(t))
    if (maya.speed > ARRIVAL_MAX_SPEED_METRES_PER_SECOND) continue
    if (metres([maya.lng, maya.lat], [rijks.lng, rijks.lat]) < ARRIVAL_RADIUS_METRES) atRijks = true
    if (metres([maya.lng, maya.lat], [foodhallen.lng, foodhallen.lat]) < ARRIVAL_RADIUS_METRES)
      atFood = true
  }
  assert.ok(atRijks, 'a lap pauses at the Rijksmuseum')
  assert.ok(atFood, 'a lap pauses at Foodhallen')
})

test('Alex is at the Foodhallen table, and stays there', () => {
  const foodhallen = stop('s5')
  const [, alex] = sampleLiveNow(at('2026-09-05T13:00:00Z'))
  assert.equal(alex.speed, 0)
  assert.ok(metres([alex.lng, alex.lat], [foodhallen.lng, foodhallen.lat]) < ARRIVAL_RADIUS_METRES)
})
