import assert from 'node:assert/strict'
import test from 'node:test'
import { cabinFor, parseSeat } from '../src/seatmap-core.ts'

test('a seat string is a row and a letter, or nothing', () => {
  assert.deepEqual(parseSeat('31A'), { row: 31, letter: 'A' })
  assert.deepEqual(parseSeat(' 4 f '), { row: 4, letter: 'F' })
  assert.equal(parseSeat('window'), null)
  assert.equal(parseSeat('0A'), null)
  assert.equal(parseSeat(''), null)
  assert.equal(parseSeat(null), null)
})

test('letters A–F draw a narrow-body, anything past F a wide-body', () => {
  const narrow = cabinFor(['14A', '14C'])
  assert.equal(narrow.kind, 'narrow')
  assert.deepEqual(narrow.sections, [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
  ])

  const wide = cabinFor(['31A', '31K'])
  assert.equal(wide.kind, 'wide')
  // Every bookable wide-body letter has a cell, I skipped as airlines do.
  assert.deepEqual(wide.sections.flat(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'])
})

test('the cabin always reaches past the deepest booked row', () => {
  assert.equal(cabinFor(['14A']).rows, 32)
  assert.equal(cabinFor(['52C']).rows, 58)
  const { rows, wing } = cabinFor(['31A', '31B'])
  assert.ok(wing[0] > 1 && wing[1] < rows, 'the wing band sits inside the cabin')
  assert.ok(wing[0] < wing[1])
})

test('unparseable seats still yield a drawable default cabin', () => {
  const plan = cabinFor(['aisle please', null])
  assert.equal(plan.kind, 'narrow')
  assert.equal(plan.rows, 32)
})
