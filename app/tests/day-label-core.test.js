import assert from 'node:assert/strict'
import test from 'node:test'
import { clockLabel, dayLabelOf, outsideRange, tripDayIsos } from '../src/day-label-core.ts'

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

test('outsideRange knows the fence, and an open side never excludes', () => {
  assert.equal(outsideRange('2026-09-03', '2026-09-04', '2026-09-06'), true)
  assert.equal(outsideRange('2026-09-07', '2026-09-04', '2026-09-06'), true)
  assert.equal(outsideRange('2026-09-04', '2026-09-04', '2026-09-06'), false)
  assert.equal(outsideRange('2026-09-06', '2026-09-04', '2026-09-06'), false)
  assert.equal(outsideRange('1999-01-01', null, '2026-09-06'), false)
  assert.equal(outsideRange(null, '2026-09-04', '2026-09-06'), false)
})

test('a label handed back in is not read as a date', () => {
  /* Labels go one way now. There used to be a reverse lookup — a label against
     the trip's own dates gave back the one date wearing it — which existed so
     the app could read days people had typed. Nothing types one any more, and
     a mapping kept "just in case" is the one a future caller reaches for.

     A browser reads 'Fri 4 Sep' as the fourth of September 2001, which is a
     Tuesday — so a stop added under the 'Fri 4 Sep' chip was filed on
     'Tue 4 Sep', a day of the trip that does not exist, and the timeline grew
     a second heading for it. Only an ISO date names a day. */
  assert.equal(dayLabelOf('Fri 4 Sep'), '')
  assert.equal(dayLabelOf('4'), '')
  assert.equal(dayLabelOf('tbc'), '')
  assert.equal(dayLabelOf(''), '')
  assert.equal(dayLabelOf('2026-09-04'), 'Fri 4 Sep', 'and a real date still reads')
})

test('a stored moment is read as a clock, whatever shape it arrived in', () => {
  /* A photograph's `when` is whatever wrote it. The server writes an ISO
     timestamp; the bundled sample writes "Today · 10:42", already formatted —
     which is why a real trip titled every uncaptioned photograph
     "2026-09-05T11:00:00.000Z" and nobody saw it in the demo. */
  assert.equal(
    clockLabel('2026-09-05T11:24:00.000Z'),
    new Date('2026-09-05T11:24:00.000Z').getHours().toString().padStart(2, '0') + ':24',
  )

  // Anything already written for a person is handed straight back.
  assert.equal(clockLabel('Today · 10:42'), 'Today · 10:42')
  assert.equal(clockLabel('09:30 – 12:30'), '09:30 – 12:30')
  assert.equal(clockLabel(''), '')
  assert.equal(clockLabel(null), '')
  assert.equal(clockLabel(undefined), '')
  // A timestamp shaped right but meaning nothing is not worth mangling.
  assert.equal(clockLabel('2026-13-45T99:99'), '2026-13-45T99:99')
})
