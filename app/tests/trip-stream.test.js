import assert from 'node:assert/strict'
import test from 'node:test'
import { createTripStreams } from '../src/trip-stream-core.ts'

const encoder = new TextEncoder()

/* A stream the test writes into, so the dispatch can be exercised without a
   server, a socket or a browser. */
function fakeStream() {
  let push = null
  let close = null
  const body = new ReadableStream({
    start(controller) {
      push = text => controller.enqueue(encoder.encode(text))
      close = () => { try { controller.close() } catch { /* already closed */ } }
    },
  })
  return { body, write: text => push(text), end: () => close() }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const deps = (over = {}) => ({
  open: async () => fakeStream(),
  poll: async () => ({ fixes: [], cursor: 0 }),
  path: id => `/trips/${id}`,
  asFix: value => value,
  retryDelay: () => 1,
  ...over,
})

test('a position frame reaches the listener as a fix', async () => {
  const socket = fakeStream()
  const streams = createTripStreams(deps({ open: async () => socket }))
  const fixes = []
  const stop = streams.watch('trip-a', { onFix: fix => fixes.push(fix) })
  await settle()

  socket.write('id: 4\ndata: {"fixes":[{"lng":1,"lat":2}],"cursor":4}\n\n')
  await settle()

  assert.deepEqual(fixes, [{ lng: 1, lat: 2 }])
  stop()
})

test('a change frame says what changed, and does not look like a position', async () => {
  const socket = fakeStream()
  const streams = createTripStreams(deps({ open: async () => socket }))
  const changes = []
  const fixes = []
  const stop = streams.watch('trip-a', { onChange: kind => changes.push(kind), onFix: fix => fixes.push(fix) })
  await settle()

  socket.write('event: changed\ndata: {"kind":"photos"}\n\n')
  socket.write('event: changed\ndata: {"kind":"comments"}\n\n')
  await settle()

  assert.deepEqual(changes, ['photos', 'comments'])
  assert.deepEqual(fixes, [], 'a change is not a position')
  stop()
})

/* Bytes arrive when they arrive: half a frame now, the rest later. */
test('a frame split across two reads is still one frame', async () => {
  const socket = fakeStream()
  const streams = createTripStreams(deps({ open: async () => socket }))
  const fixes = []
  const stop = streams.watch('trip-a', { onFix: fix => fixes.push(fix) })
  await settle()

  socket.write('data: {"fixes":[{"lng":9,')
  await settle()
  assert.deepEqual(fixes, [], 'half a frame is not an event')

  socket.write('"lat":8}],"cursor":2}\n\n')
  await settle()
  assert.deepEqual(fixes, [{ lng: 9, lat: 8 }])
  stop()
})

test('everything watching one trip shares one connection', async () => {
  let opened = 0
  const streams = createTripStreams(deps({ open: async () => { opened += 1; return fakeStream() } }))
  const stopOne = streams.watch('trip-a', { onFix: () => {} })
  const stopTwo = streams.watch('trip-a', { onChange: () => {} })
  await settle()

  assert.equal(opened, 1, 'the map and the page should not each hold their own')
  assert.equal(streams.open, 1)

  stopOne()
  assert.equal(streams.open, 1, 'one listener leaving does not close it for the other')
  stopTwo()
  assert.equal(streams.open, 0, 'the last one out closes it')
})

/* Something in the middle that will not hold a connection open should not mean
   no updates at all. */
test('a stream that will not open falls back to asking', async () => {
  const asked = []
  const streams = createTripStreams(deps({
    open: async () => { throw new Error('refused') },
    poll: async (tripId, options) => {
      asked.push(options.cursor)
      return { fixes: [{ lng: 3, lat: 4 }], cursor: 6 }
    },
    retryDelay: () => 1,
    pollEvery: 1,
  }))
  const fixes = []
  const states = []
  const stop = streams.watch('trip-a',
    { onFix: fix => fixes.push(fix), onState: value => states.push(value) })

  await new Promise(resolve => setTimeout(resolve, 40))
  stop()

  assert.ok(states.includes('error'), 'a refused stream is an error worth reporting')
  assert.ok(asked.length >= 1, 'it should have started asking instead')
  assert.ok(fixes.length >= 1, 'and the positions should still arrive')
})

test('the cursor a listener brings is where the stream starts', async () => {
  const opened = []
  const streams = createTripStreams(deps({
    open: async path => { opened.push(path); return fakeStream() },
  }))
  const stop = streams.watch('trip-a', { onFix: () => {}, cursor: 42, hours: 48 })
  await settle()

  assert.match(opened[0], /cursor=42/)
  assert.match(opened[0], /hours=48/)
  stop()
})
