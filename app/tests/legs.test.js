import assert from 'node:assert/strict'
import test from 'node:test'
import { legLabel, legsByFrom } from '../src/legs-core.ts'

const leg = (seconds, meters) => ({ fromId: 'a', toId: 'b', seconds, meters })

test('a leg reads the way a person would say it', () => {
  assert.equal(legLabel(leg(1380, 18_300)), '23 min drive · 18 km')
  assert.equal(legLabel(leg(140, 480), 'pedestrian'), '2 min walk · 480 m')
  assert.equal(legLabel(leg(6000, 112_000)), '1 h 40 min drive · 112 km')
  assert.equal(legLabel(leg(3600, 42_000), 'bicycle'), '1 h ride · 42 km')
  // Under a minute still says a minute — "0 min" reads as broken.
  assert.equal(legLabel(leg(20, 90)), '1 min drive · 90 m')
  // Just under the km line rounds to metres, just over shows one decimal.
  assert.equal(legLabel(leg(60, 949)), '1 min drive · 950 m')
  assert.equal(legLabel(leg(60, 1049)), '1 min drive · 1.0 km')
})

test('legs key by the stop they leave', () => {
  const map = legsByFrom([
    { fromId: 'a', toId: 'b', seconds: 60, meters: 100 },
    { fromId: 'b', toId: 'c', seconds: 120, meters: 200 },
  ])
  assert.equal(map.get('a')?.toId, 'b')
  assert.equal(map.get('b')?.seconds, 120)
  assert.equal(map.get('c'), undefined)
})
