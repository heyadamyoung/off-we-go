import assert from 'node:assert/strict'
import test from 'node:test'
import { airportsWord } from '../src/flight-word-core.ts'

/* What the airports said, as a buzz on the phone. What these pin: the first
   look says nothing (the card shows it); a note that changed on a known leg
   is said, under the leg's name; the same note again is not; a leg the
   phone has not seen before is not; a note going quiet is not. */

const leg = (rest = {}) => ({
  id: 'leg-1',
  carrier: 'Air Canada',
  number: 'AC 872',
  fromName: 'Toronto',
  toName: 'Dublin',
  statusNote: null,
  ...rest,
})

test('the first look says nothing, and remembers what it saw', () => {
  const { said, notes } = airportsWord(null, [
    leg({ statusNote: 'AC 872 is delayed by 55 minutes.' }),
  ])
  assert.deepEqual(said, [])
  assert.deepEqual(notes, { 'leg-1': 'AC 872 is delayed by 55 minutes.' })
})

test('a note that changed on a leg the phone knew is said, under the leg’s name', () => {
  const before = { 'leg-1': 'AC 872 boards from gate C34. Toronto Pearson, 12:10.' }
  const { said, notes } = airportsWord(before, [
    leg({ statusNote: 'AC 872 has moved from gate C34 to D12. Toronto Pearson, 13:30.' }),
  ])
  assert.deepEqual(said, [
    {
      segmentId: 'leg-1',
      title: 'Air Canada AC 872',
      body: 'AC 872 has moved from gate C34 to D12. Toronto Pearson, 13:30.',
    },
  ])
  assert.equal(notes['leg-1'], 'AC 872 has moved from gate C34 to D12. Toronto Pearson, 13:30.')
})

test('the same note again, a new leg’s first note, and a note going quiet are not news', () => {
  const before = { 'leg-1': 'AC 872 is boarding.' }
  const same = airportsWord(before, [leg({ statusNote: 'AC 872 is boarding.' })])
  assert.deepEqual(same.said, [])
  const unseen = airportsWord(before, [
    leg({ id: 'leg-2', statusNote: 'EI 123 has been cancelled.' }),
  ])
  assert.deepEqual(unseen.said, [])
  assert.deepEqual(unseen.notes, { 'leg-2': 'EI 123 has been cancelled.' })
  const quiet = airportsWord(before, [leg({ statusNote: '   ' })])
  assert.deepEqual(quiet.said, [])
  assert.deepEqual(quiet.notes, { 'leg-1': null })
  /* And a note that came back after going quiet is said again: it is new
     relative to the silence, which is what the traveller last saw. */
  const back = airportsWord(quiet.notes, [leg({ statusNote: 'AC 872 is boarding.' })])
  assert.equal(back.said.length, 1)
})

test('a leg with no number is still named', () => {
  const { said } = airportsWord({ 'leg-1': 'x' }, [
    leg({ carrier: null, number: null, statusNote: 'Gate changed.' }),
  ])
  assert.equal(said[0].title, 'Your flight')
})
