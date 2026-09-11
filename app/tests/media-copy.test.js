import assert from 'node:assert/strict'
import test from 'node:test'
import { SMALL_BOX, copyFor, drawn } from '../src/media-copy-core.ts'

const both = { src: 'big.jpg', thumbSrc: 'small.jpg' }
const nothing = () => false
const everything = () => true
const only = url => seen => seen === url

test('a small box is drawn from the small copy', () => {
  assert.equal(copyFor(both, 96), 'small.jpg')
  assert.equal(copyFor(both, 480), 'small.jpg')
  assert.equal(copyFor(both, SMALL_BOX), 'small.jpg')
})

test('a big box is drawn from the one to look at', () => {
  assert.equal(copyFor(both, SMALL_BOX + 1), 'big.jpg')
  assert.equal(copyFor(both, 1200), 'big.jpg')
  assert.equal(copyFor(both, 2400), 'big.jpg')
})

test('a row from before thumbnails existed still has a picture', () => {
  assert.equal(copyFor({ src: 'big.jpg' }, 96), 'big.jpg')
  assert.equal(copyFor({ src: 'big.jpg' }, 1200), 'big.jpg')
})

test('a poster frame with only a small copy is still drawn', () => {
  assert.equal(copyFor({ thumbSrc: 'small.jpg' }, 1200), 'small.jpg')
})

test('a row with no picture at all asks for nothing', () => {
  assert.equal(copyFor({}, 1200), null)
  assert.equal(drawn({}, 1200, everything), null)
})

test('the small copy stands in for a big one that has not arrived', () => {
  assert.deepEqual(drawn(both, 1200, only('small.jpg')), {
    show: 'small.jpg',
    better: 'big.jpg',
  })
})

test('nothing stands in once the real one is in hand', () => {
  assert.deepEqual(drawn(both, 1200, everything), { show: 'big.jpg' })
})

test('a small copy that would itself be a fetch does not stand in', () => {
  // It would paint no sooner than the picture it is standing in for, and
  // costs a request to find that out.
  assert.deepEqual(drawn(both, 1200, nothing), { show: 'big.jpg' })
})

test('a small box never stands in for itself', () => {
  assert.deepEqual(drawn(both, 96, nothing), { show: 'small.jpg' })
  assert.deepEqual(drawn(both, 96, only('small.jpg')), { show: 'small.jpg' })
})
