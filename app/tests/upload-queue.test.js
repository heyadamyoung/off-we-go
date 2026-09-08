import assert from 'node:assert/strict'
import test from 'node:test'
import {
  begin,
  countable,
  dismiss,
  done,
  enqueue,
  fail,
  failed,
  hold,
  next,
  queued,
  requeue,
  retry,
  retryDelay,
  worthRetrying,
} from '../src/upload-queue-core.ts'

const two = enqueue(
  [],
  [
    { key: 'a', name: 'one.jpg' },
    { key: 'b', name: 'two.jpg' },
  ],
)

test('files join the back of the queue and wait their turn', () => {
  assert.deepEqual(
    two.map(item => [item.key, item.state]),
    [
      ['a', 'waiting'],
      ['b', 'waiting'],
    ],
  )
  assert.equal(next(two).key, 'a', 'one at a time, in the order they were chosen')
  assert.equal(queued(two), 2)
})

test('choosing the same file twice does not upload it twice', () => {
  const again = enqueue(two, [
    { key: 'a', name: 'one.jpg' },
    { key: 'c', name: 'three.jpg' },
  ])
  assert.deepEqual(
    again.map(item => item.key),
    ['a', 'b', 'c'],
  )
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
  assert.deepEqual(
    after.map(item => item.key),
    ['b'],
  )
})

test('a failure stays, with why, and can be sent again', () => {
  const broken = fail(begin(two, 'a'), 'a', 'Network unavailable')
  assert.equal(broken[0].state, 'failed')
  assert.equal(broken[0].error, 'Network unavailable')
  assert.deepEqual(
    failed(broken).map(item => item.key),
    ['a'],
  )
  assert.equal(queued(broken), 1, 'a failure is not still uploading')
  assert.equal(next(broken).key, 'b', 'and it does not block the rest of the queue')

  const asked = retry(broken, 'a')
  assert.equal(asked[0].state, 'waiting')
  assert.equal(asked[0].error, undefined)
})

test('a failure can be waved away', () => {
  const broken = fail(two, 'a', 'nope')
  assert.deepEqual(
    dismiss(broken, 'a').map(item => item.key),
    ['b'],
  )
})

test('an empty queue has nothing to send', () => {
  assert.equal(next([]), null)
  assert.equal(queued([]), 0)
})

test('the tray names what is going up: films, pictures, or a mix of the two', () => {
  const films = enqueue(
    [],
    [
      { key: 'v1', name: 'one.mp4', kind: 'video' },
      { key: 'v2', name: 'two.mov', kind: 'video' },
    ],
  )
  assert.equal(countable(films), 'videos')
  assert.equal(countable(enqueue([], [{ key: 'v1', name: 'one.mp4', kind: 'video' }])), 'video')
  assert.equal(countable(two), 'photos')
  assert.equal(countable(enqueue([], [{ key: 'a', name: 'one.jpg' }])), 'photo')
  assert.equal(
    countable(enqueue(films, [{ key: 'a', name: 'one.jpg', kind: 'photo' }])),
    'items',
    'a mixed queue is counted, not mislabelled',
  )

  // A failure is not still going up, so it is not counted in the going noun.
  assert.equal(countable(fail(films, 'v2', 'no signal')), 'video')
})

test('a dropped line is retried unprompted; a refusal is not', () => {
  // No response at all: the network, not the file.
  assert.equal(worthRetrying(new Error('Failed to fetch')), true)
  assert.equal(worthRetrying(Object.assign(new Error('gateway'), { status: 502 })), true)
  assert.equal(worthRetrying(Object.assign(new Error('slow down'), { status: 429 })), true)
  // The server looked at this upload and said no; sending it again is data burnt.
  assert.equal(worthRetrying(Object.assign(new Error('too big'), { status: 413 })), false)
  assert.equal(worthRetrying(Object.assign(new Error('nope'), { status: 403 })), false)

  // Backoff grows, then stops growing.
  assert.deepEqual([1, 2, 3].map(retryDelay), [2000, 6000, 18000])
  assert.equal(retryDelay(9), 30_000)
})

test('a retrying upload is neither a failure nor something to prod', () => {
  const going = begin(enqueue([], [{ key: 'v', name: 'clip.mp4', kind: 'video' }]), 'v')
  assert.equal(going[0].attempts, 1, 'each send is counted, so backoff can grow')

  const held = hold(going, 'v', 'Waiting for a better signal…')
  assert.equal(held[0].state, 'retrying')
  assert.deepEqual(failed(held), [], 'it has not failed — it is coming round again')
  assert.equal(queued(held), 1, 'and it still counts as going up')
  assert.equal(next(held), null, 'but it must not be picked up before its delay')

  const again = requeue(held, 'v')
  assert.equal(next(again)?.key, 'v')
  assert.equal(again[0].attempts, 1, 'requeue keeps the count; only a person resets it')
  assert.equal(begin(again, 'v')[0].attempts, 2)

  // A person asking again is a fresh start, patience included.
  assert.equal(retry(fail(going, 'v', 'no'), 'v')[0].attempts, 0)
})
