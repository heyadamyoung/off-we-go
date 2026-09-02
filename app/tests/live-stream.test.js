import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveStream } from '../server/src/live-stream.js'

test('a position reaches everyone watching that trip, and nobody else', () => {
  const stream = createLiveStream()
  const seen = []
  stream.watch('trip-a', () => seen.push('first'))
  stream.watch('trip-a', () => seen.push('second'))
  stream.watch('trip-b', () => seen.push('elsewhere'))

  stream.announce('trip-a')

  assert.deepEqual(seen, ['first', 'second'])
  assert.equal(stream.watching('trip-a'), 2)
  assert.equal(stream.watching('trip-b'), 1)
})

test('a browser that leaves stops being told', () => {
  const stream = createLiveStream()
  const seen = []
  const stop = stream.watch('trip-a', () => seen.push('tick'))
  stream.announce('trip-a')
  stop()
  stream.announce('trip-a')

  assert.deepEqual(seen, ['tick'])
  assert.equal(stream.watching('trip-a'), 0, 'an empty trip should not be held onto')
})

/* The phone's request must not fail because a browser has gone away between
   the last heartbeat and this position. */
test('a listener that throws is dropped rather than raised', () => {
  const stream = createLiveStream()
  const seen = []
  stream.watch('trip-a', () => { throw new Error('socket closed') })
  stream.watch('trip-a', () => seen.push('still delivered'))

  assert.doesNotThrow(() => stream.announce('trip-a'))
  assert.deepEqual(seen, ['still delivered'])
  assert.equal(stream.watching('trip-a'), 1, 'the broken one is gone, the good one stays')
})

test('announcing a trip nobody is watching is free', () => {
  const stream = createLiveStream()
  assert.equal(stream.announce('nobody-here'), 0)
})
