import assert from 'node:assert/strict'
import test from 'node:test'
import { keyboardInset } from '../src/shared/lib/keyboard-inset.ts'

test('no keyboard is no inset', () => {
  assert.equal(keyboardInset({ height: 844, offsetTop: 0 }, 844), 0)
})

test('a keyboard is the part of the page it covers', () => {
  assert.equal(keyboardInset({ height: 480, offsetTop: 0 }, 844), 364)
  assert.equal(
    keyboardInset({ height: 480, offsetTop: 20 }, 844),
    344,
    'a scrolled visual viewport counts',
  )
})

/* Pinch-zooming and the URL bar sliding away also shrink the visual viewport,
   and lifting the panels for those would be a jump for no reason. */
test('small changes are not a keyboard', () => {
  assert.equal(keyboardInset({ height: 800, offsetTop: 0 }, 844), 0)
  assert.equal(
    keyboardInset({ height: 900, offsetTop: 0 }, 844),
    0,
    'a taller viewport is not a keyboard',
  )
})
