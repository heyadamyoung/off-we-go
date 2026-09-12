import assert from 'node:assert/strict'
import test from 'node:test'
import { daysBetween, formatRange } from '../src/shared/lib/trip-dates.ts'

/* The words under a trip's name. They are drawn on the home cards, in the
   past-trips list, on a profile, and in the fence the stop editor shows when a
   day falls outside the trip — and `new-trip` stores the result as the trip's
   own `dates`, so anything wrong here is not merely displayed, it is kept. */

test('a range reads the way somebody would say it', () => {
  assert.equal(formatRange('2026-09-04', '2026-09-06'), '4 – 6 September')
  assert.equal(formatRange('2026-08-30', '2026-09-02'), '30 August – 2 September')
  assert.equal(formatRange('2026-12-30', '2027-01-02'), '30 December 2026 – 2 January 2027')
})

test('one open side still says what it knows', () => {
  assert.equal(formatRange('2026-09-04', undefined), 'from 4 September')
  assert.equal(formatRange(undefined, '2026-09-06'), 'until 6 September')
  assert.equal(formatRange(undefined, undefined), '')
})

test('a date it cannot read comes out as nothing, never as NaN', () => {
  /* The reported bug. These went through `new Date(...)` and straight into
     `.getDate()`, so an unreadable value printed "NaN September" — and on the
     new-trip screen that string is what gets stored as the trip's dates, which
     is how a nonsense date stops being a display problem and becomes the data.

     Where these came from is the other half: the assistant's tools declared a
     stop's day as an integer, and a trip whose dates went in the same way had
     nothing to catch them. */
  for (const junk of ['10', 'Fri 4 Sep', 'tbc', '2026-13-45', 'NaN', '']) {
    const both = formatRange(junk, junk)
    const start = formatRange(junk, '2026-09-06')
    const end = formatRange('2026-09-04', junk)
    for (const shown of [both, start, end]) {
      assert.ok(!/NaN|undefined/.test(shown), `${JSON.stringify(junk)} produced ${shown}`)
    }
  }
})

test('an unreadable end still lets the readable start speak', () => {
  /* Losing half a range to the other half being wrong would hide a date the
     trip does know. */
  assert.equal(formatRange('2026-09-04', 'tbc'), 'from 4 September')
  assert.equal(formatRange('tbc', '2026-09-06'), 'until 6 September')
  assert.equal(formatRange('tbc', 'tbc'), '')
})

test('a day count is a count or nothing', () => {
  assert.equal(daysBetween('2026-09-04', '2026-09-06'), 3)
  assert.equal(daysBetween('2026-09-04', '2026-09-04'), 1)
  assert.equal(daysBetween('2026-09-06', '2026-09-04'), null, 'backwards is not a length')
  assert.equal(daysBetween('tbc', '2026-09-06'), null)
  assert.equal(daysBetween('2026-09-04', 'tbc'), null)
  assert.equal(daysBetween(undefined, undefined), null)
})
