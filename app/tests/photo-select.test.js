import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NOTHING,
  anyChosen,
  chosenIn,
  chosenInOrder,
  extendTo,
  isChosen,
  prunedTo,
  toggleMany,
  toggleOne,
} from '../src/photo-select-core.ts'

const order = ['a', 'b', 'c', 'd', 'e', 'f']
const chose = (...ids) => ids.reduce((selection, id) => toggleOne(selection, id), NOTHING)
const listed = selection => [...selection.ids].sort()

test('nothing is chosen to begin with', () => {
  assert.equal(anyChosen(NOTHING), false)
  assert.equal(isChosen(NOTHING, 'a'), false)
  assert.equal(NOTHING.anchor, null)
})

test('a tap puts one in, and a second tap takes it out again', () => {
  const one = toggleOne(NOTHING, 'c')
  assert.deepEqual(listed(one), ['c'])
  assert.equal(one.anchor, 'c', 'a range would be measured from here')
  assert.equal(anyChosen(toggleOne(one, 'c')), false)
})

test('a selection is never edited in place', () => {
  /* React decides what to redraw by whether the thing changed identity. A set
     mutated in place is a selection the screen never hears about. */
  const before = chose('a', 'b')
  const after = toggleOne(before, 'c')
  assert.deepEqual(listed(before), ['a', 'b'])
  assert.notEqual(before.ids, after.ids)
})

test('shift-click takes everything between, in either direction', () => {
  assert.deepEqual(listed(extendTo(chose('b'), 'e', order)), ['b', 'c', 'd', 'e'])
  assert.deepEqual(listed(extendTo(chose('e'), 'b', order)), ['b', 'c', 'd', 'e'])
})

test('a range adds to what was already chosen rather than replacing it', () => {
  /* A range is nearly always the second gesture. Losing the first one is how
     somebody ends up rebuilding a selection they had already made. */
  const scattered = chose('a', 'f')
  const reached = extendTo(scattered, 'd', order)
  assert.deepEqual(listed(reached), ['a', 'd', 'e', 'f'], 'from the anchor f back to d')
})

test('the far end of a range can be dragged about without losing the near end', () => {
  const started = chose('b')
  const reached = extendTo(started, 'e', order)
  assert.equal(reached.anchor, 'b', 'still measuring from where the range began')
  assert.deepEqual(listed(extendTo(reached, 'c', order)), ['b', 'c', 'd', 'e'])
})

test('a shift-click with nothing to measure from is an ordinary tap', () => {
  assert.deepEqual(listed(extendTo(NOTHING, 'c', order)), ['c'])
  // And an anchor that has since been filtered off the screen is no anchor.
  const stale = { ids: new Set(['z']), anchor: 'z' }
  assert.deepEqual(listed(extendTo(stale, 'c', order)), ['c', 'z'])
})

test('a heading says how much of its group is chosen', () => {
  const group = ['b', 'c', 'd']
  assert.equal(chosenIn(NOTHING, group), 'none')
  assert.equal(chosenIn(chose('c'), group), 'some')
  assert.equal(chosenIn(chose('b', 'c', 'd'), group), 'all')
  assert.equal(chosenIn(chose('b', 'c', 'd', 'f'), group), 'all', 'others do not count against')
  assert.equal(chosenIn(NOTHING, []), 'none', 'an empty group is not secretly complete')
})

test('a heading takes its whole group, and gives it all back', () => {
  const group = ['b', 'c', 'd']
  const all = toggleMany(NOTHING, group)
  assert.deepEqual(listed(all), ['b', 'c', 'd'])
  assert.equal(anyChosen(toggleMany(all, group)), false)
})

test('a part-chosen group completes rather than clearing', () => {
  /* The first tap on a heading must never be the destructive one: guessing
     wrong should cost a second tap, not two pictures you had already found. */
  const group = ['b', 'c', 'd']
  assert.deepEqual(listed(toggleMany(chose('c'), group)), ['b', 'c', 'd'])
})

test('taking a group back leaves everything outside it alone', () => {
  const group = ['b', 'c']
  const both = toggleMany(chose('f'), group)
  assert.deepEqual(listed(both), ['b', 'c', 'f'])
  assert.deepEqual(listed(toggleMany(both, group)), ['f'])
})

test('what is no longer on the screen is no longer chosen', () => {
  /* A filter applied, a photograph deleted, a page of results replaced. A
     count that does not match what is visible is a bulk move that touches
     pictures nobody meant. */
  const chosen = chose('a', 'c', 'z')
  const pruned = prunedTo(chosen, order)
  assert.deepEqual(listed(pruned), ['a', 'c'])
  assert.equal(prunedTo(pruned, order), pruned, 'nothing to do means the same object')
  assert.equal(prunedTo(chose('z'), order).anchor, null, 'and no anchor pointing off-screen')
})

test('the chosen come back in the order they are read', () => {
  /* Insertion order is the order they were tapped, which is not the order
     anybody sees them in, and a confirmation that lists them in tap order
     reads like a different set of pictures. */
  const chosen = chose('e', 'a', 'c')
  assert.deepEqual(chosenInOrder(chosen, order), ['a', 'c', 'e'])
})
