import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify, isHeadline } from '../src/features/map/api/attractions.ts'

/* The attractions layer carries no editorial filter, by the owner's explicit
   decision (2026-09-03). These tests pin the policy so a well-meaning future
   cleanup cannot quietly bring a blocklist back: classify labels, it never
   gates. The sights feature keeps its own curation; that is a different door. */

test('the dullest article still gets a pin: classify labels and never gates', () => {
  for (const description of [
    'village in Highland, Scotland',
    'hamlet in Drenthe, Netherlands',
    'street in Amsterdam',
    'railway station in Rotterdam',
    'human settlement in the United Kingdom',
    'civil parish in Aberdeenshire',
    '',
    null,
    undefined,
  ]) {
    assert.deepEqual(classify(description), { kind: 'place' })
  }
})

test('airports are transit, and transit is headline tier', () => {
  assert.equal(classify('airport in Haarlemmermeer, Netherlands').kind, 'transit')
  assert.equal(classify('international airport serving Edinburgh, Scotland').kind, 'transit')
  assert.equal(classify('luchthaven in Noord-Holland').kind, 'transit')
  assert.ok(isHeadline('transit'))
})

test('plain places and water wait for a closer zoom, but are never excluded', () => {
  assert.ok(!isHeadline('place'))
  assert.ok(!isHeadline('water'))
  assert.equal(classify('river in the Scottish Borders').kind, 'water')
})
