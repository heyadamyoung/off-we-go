import assert from 'node:assert/strict'
import test from 'node:test'
import {
  begin, dismiss, done, enqueue, fail, failed, next, queued, retry,
} from '../src/upload-queue-core.ts'

const two = enqueue([], [{ key: 'a', name: 'one.jpg' }, { key: 'b', name: 'two.jpg' }])

test('files join the back of the queue and wait their turn', () => {
  assert.deepEqual(two.map(item => [item.key, item.state]), [['a', 'waiting'], ['b', 'waiting']])
  assert.equal(next(two).key, 'a', 'one at a time, in the order they were chosen')
  assert.equal(queued(two), 2)
})

test('choosing the same file twice does not upload it twice', () => {
  const again = enqueue(two, [{ key: 'a', name: 'one.jpg' }, { key: 'c', name: 'three.jpg' }])
  assert.deepEqual(again.map(item => item.key), ['a', 'b', 'c'])
})

test('what is going up is not also next', () => {
  const going = begin(two, 'a')
  assert.equal(going[0].state, 'uploading')
  assert.equal(next(going).key, 'b', 'the one in flight must not be started again')
})

/* The photograph appears on the map when it lands, which says more than a tick
   in a tray would. */
test('a finished upload leaves the tray', () => {
  const after = done(begin(two, 'a'), 'a')
  assert.deepEqual(after.map(item => item.key), ['b'])
})

test('a failure stays, with why, and can be sent again', () => {
  const broken = fail(begin(two, 'a'), 'a', 'Network unavailable')
  assert.equal(broken[0].state, 'failed')
  assert.equal(broken[0].error, 'Network unavailable')
  assert.deepEqual(failed(broken).map(item => item.key), ['a'])
  assert.equal(queued(broken), 1, 'a failure is not still uploading')
  assert.equal(next(broken).key, 'b', 'and it does not block the rest of the queue')

  const asked = retry(broken, 'a')
  assert.equal(asked[0].state, 'waiting')
  assert.equal(asked[0].error, undefined)
})

test('a failure can be waved away', () => {
  const broken = fail(two, 'a', 'nope')
  assert.deepEqual(dismiss(broken, 'a').map(item => item.key), ['b'])
})

test('an empty queue has nothing to send', () => {
  assert.equal(next([]), null)
  assert.equal(queued([]), 0)
})
