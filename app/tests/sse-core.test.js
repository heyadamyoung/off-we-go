import assert from 'node:assert/strict'
import test from 'node:test'
import { frameJson, readFrames } from '../src/sse-core.ts'

test('a frame is what arrives before the blank line', () => {
  const { frames, rest } = readFrames('id: 7\ndata: {"cursor":7}\n\n')

  assert.equal(frames.length, 1)
  assert.equal(frames[0].id, '7')
  assert.deepEqual(frameJson(frames[0]), { cursor: 7 })
  assert.equal(rest, '')
})

/* A socket hands over bytes, not messages: one read can hold three frames and
   the first half of a fourth. */
test('several frames in one read, and a half one kept for the next', () => {
  const { frames, rest } = readFrames('data: one\n\ndata: two\n\ndata: thr')

  assert.deepEqual(
    frames.map(f => f.data),
    ['one', 'two'],
  )
  assert.equal(rest, 'data: thr')

  const next = readFrames(rest + 'ee\n\n')
  assert.deepEqual(
    next.frames.map(f => f.data),
    ['three'],
  )
})

test('a heartbeat is not an event', () => {
  const { frames } = readFrames(':\n\n:keep-alive\n\ndata: real\n\n')

  assert.deepEqual(
    frames.map(f => f.data),
    ['real'],
    'comments must not wake the app up',
  )
})

test('multi-line data is joined, and the space after the colon is not data', () => {
  const { frames } = readFrames('data: first\ndata: second\n\n')
  assert.equal(frames[0].data, 'first\nsecond')

  const { frames: tight } = readFrames('data:no-space\n\n')
  assert.equal(tight[0].data, 'no-space')
})

test('carriage returns are the same frames', () => {
  const { frames } = readFrames('id: 3\r\ndata: {"cursor":3}\r\n\r\n')
  assert.equal(frames.length, 1)
  assert.deepEqual(frameJson(frames[0]), { cursor: 3 })
})

test('anything that is not the JSON we expected is nothing, not a crash', () => {
  assert.equal(frameJson({ data: 'not json' }), null)
  assert.equal(frameJson({ data: '"a string"' }), null)
  assert.equal(frameJson({ data: '' }), null)
})
