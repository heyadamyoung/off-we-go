import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTrail, simplifyLine } from '../src/trail-core.ts'

/* Roughly 11.1 m per 0.0001° of latitude; longitudes at the equator match. */
const at = seconds => new Date(Date.UTC(2026, 8, 1, 12, 0, seconds))
const minute = index => new Date(Date.UTC(2026, 8, 1, 12, index))

test('gps jitter along one street collapses to a stroke, not forty wobbles', () => {
  const points = []
  for (let i = 0; i < 40; i++) {
    // Eastward walk with ±3 m of sideways noise — under the 6 m tolerance.
    points.push([i * 0.0002, (i % 2 ? 1 : -1) * 0.000027])
  }
  const line = simplifyLine(points)
  assert.ok(line.length <= 4, `expected the wobble to collapse, kept ${line.length} points`)
  assert.deepEqual(line[0], points[0])
  assert.deepEqual(line[line.length - 1], points[points.length - 1])
})

test('a real corner survives simplification', () => {
  const east = Array.from({ length: 10 }, (_, i) => [i * 0.0002, 0])
  const north = Array.from({ length: 10 }, (_, i) => [9 * 0.0002, i * 0.0002])
  const line = simplifyLine([...east, ...north])
  assert.ok(
    line.some(([lng, lat]) => Math.abs(lng - 9 * 0.0002) < 1e-9 && Math.abs(lat) < 1e-9),
    'the corner point must be kept',
  )
  assert.ok(line.length >= 3)
})

test('a long quiet gap starts a new line instead of a false straight across town', () => {
  const fixes = []
  for (let i = 0; i < 5; i++) {
    fixes.push({ deviceId: 'd1', lng: i * 0.001, lat: 0, accuracy: 10, at: minute(i) })
  }
  for (let i = 0; i < 5; i++) {
    // 40 minutes later, somewhere else entirely.
    fixes.push({ deviceId: 'd1', lng: 0.1 + i * 0.001, lat: 0.1, accuracy: 10, at: minute(45 + i) })
  }
  const lines = buildTrail(fixes)
  assert.equal(lines.length, 2)
})

test('fixes too inaccurate to trust never reach the map', () => {
  const fixes = [
    { deviceId: 'd1', lng: 0, lat: 0, accuracy: 10, at: at(0) },
    { deviceId: 'd1', lng: 0.5, lat: 0.5, accuracy: 400, at: at(30) },
    { deviceId: 'd1', lng: 0.001, lat: 0, accuracy: 10, at: at(60) },
  ]
  const [line] = buildTrail(fixes)
  assert.ok(
    line.every(([, lat]) => lat < 0.1),
    'the wild 400 m fix must be dropped',
  )
})

test('each phone draws its own line', () => {
  const fixes = [
    { deviceId: 'd1', lng: 0, lat: 0, accuracy: 10, at: at(0) },
    { deviceId: 'd1', lng: 0.001, lat: 0, accuracy: 10, at: at(30) },
    { deviceId: 'd2', lng: 0, lat: 0.01, accuracy: 10, at: at(0) },
    { deviceId: 'd2', lng: 0.001, lat: 0.01, accuracy: 10, at: at(30) },
  ]
  assert.equal(buildTrail(fixes).length, 2)
})

test('a single fix draws nothing — a point is not a path', () => {
  assert.deepEqual(buildTrail([{ deviceId: 'd1', lng: 0, lat: 0, accuracy: 10, at: at(0) }]), [])
})
