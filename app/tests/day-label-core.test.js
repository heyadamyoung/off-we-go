import assert from 'node:assert/strict'
import test from 'node:test'
import { dayLabelOf, isoOfDayLabel, outsideRange, tripDayIsos } from '../src/day-label-core.ts'

test('an ISO date wears the label the app has always spoken', () => {
  assert.equal(dayLabelOf('2026-09-04'), 'Fri 4 Sep')
  assert.equal(dayLabelOf('2026-09-05'), 'Sat 5 Sep')
  assert.equal(dayLabelOf('2026-12-31'), 'Thu 31 Dec')
  assert.equal(dayLabelOf('not-a-date'), '')
})

test('the trip enumerates its own days, inclusive of both ends', () => {
  assert.deepEqual(tripDayIsos('2026-09-04', '2026-09-06'), [
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ])
  assert.deepEqual(tripDayIsos('2026-09-30', '2026-10-02'), [
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
  ])
  assert.deepEqual(tripDayIsos(null, '2026-09-06'), [], 'no range, no days')
  assert.deepEqual(tripDayIsos('2026-09-06', '2026-09-04'), [], 'a backwards range is nothing')
})

test('a label maps back to the one date inside the trip that wears it', () => {
  assert.equal(isoOfDayLabel('Sat 5 Sep', '2026-09-04', '2026-09-06'), '2026-09-05')
  assert.equal(isoOfDayLabel(' Sat 5 Sep ', '2026-09-04', '2026-09-06'), '2026-09-05')
  assert.equal(isoOfDayLabel('Sat 12 Sep', '2026-09-04', '2026-09-06'), null, 'outside: no date')
  assert.equal(isoOfDayLabel('Day 3', '2026-09-04', '2026-09-06'), null, 'foreign labels stay')
  assert.equal(isoOfDayLabel('Sat 5 Sep', null, null), null, 'no range, no mapping')
  assert.equal(isoOfDayLabel('', '2026-09-04', '2026-09-06'), null)
})

test('every trip day roundtrips through its label', () => {
  for (const iso of tripDayIsos('2026-02-26', '2026-03-03')) {
    assert.equal(isoOfDayLabel(dayLabelOf(iso), '2026-02-26', '2026-03-03'), iso)
  }
})

test('outsideRange knows the fence, and an open side never excludes', () => {
  assert.equal(outsideRange('2026-09-03', '2026-09-04', '2026-09-06'), true)
  assert.equal(outsideRange('2026-09-07', '2026-09-04', '2026-09-06'), true)
  assert.equal(outsideRange('2026-09-04', '2026-09-04', '2026-09-06'), false)
  assert.equal(outsideRange('2026-09-06', '2026-09-04', '2026-09-06'), false)
  assert.equal(outsideRange('1999-01-01', null, '2026-09-06'), false)
  assert.equal(outsideRange(null, '2026-09-04', '2026-09-06'), false)
})
