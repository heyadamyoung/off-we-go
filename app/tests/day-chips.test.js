import assert from 'node:assert/strict'
import test from 'node:test'
import { chipOrder, localDayIso } from '../src/trip-days-core.ts'

/* The chips on the bar: today first while the trip is under way, else its
   last day, then back a day at a time to the beginning; days still to come
   after that, nearest first. */

const day = iso => ({ iso, label: iso })
const isos = list => list.map(one => one.iso)
const trip = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'].map(day)

test('under way, today leads and the days count back to the start; the rest follow', () => {
  assert.deepEqual(isos(chipOrder(trip, '2026-09-05')), [
    '2026-09-05',
    '2026-09-04',
    '2026-09-03',
    '2026-09-06',
    '2026-09-07',
  ])
  /* Handed in any order, the answer is the same. */
  assert.deepEqual(
    isos(chipOrder([...trip].reverse(), '2026-09-05')),
    isos(chipOrder(trip, '2026-09-05')),
  )
})

test('on the last day, and after the trip, the last day leads and everything counts back', () => {
  const back = ['2026-09-07', '2026-09-06', '2026-09-05', '2026-09-04', '2026-09-03']
  assert.deepEqual(isos(chipOrder(trip, '2026-09-07')), back)
  assert.deepEqual(isos(chipOrder(trip, '2026-10-01')), back)
  assert.deepEqual(isos(chipOrder(trip, null)), back)
})

test('before the trip, the last day leads too — the whole of it is still to come', () => {
  assert.deepEqual(isos(chipOrder(trip, '2026-08-20')), [
    '2026-09-07',
    '2026-09-06',
    '2026-09-05',
    '2026-09-04',
    '2026-09-03',
  ])
  /* A day the trip skipped is no chip; today between two days counts back
     from the one before it. */
  const gappy = ['2026-09-03', '2026-09-06'].map(day)
  assert.deepEqual(isos(chipOrder(gappy, '2026-09-05')), ['2026-09-03', '2026-09-06'])
  assert.deepEqual(chipOrder([], '2026-09-05'), [])
})

test('today is the local calendar day', () => {
  assert.match(localDayIso(), /^\d{4}-\d\d-\d\d$/)
  const noon = new Date(2026, 8, 19, 12, 0, 0).getTime()
  assert.equal(localDayIso(noon), '2026-09-19')
})
