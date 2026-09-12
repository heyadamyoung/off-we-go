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
  furthest,
  hold,
  measurable,
  overall,
  progressed,
  retryAll,
  startable,
  queued,
  requeue,
  retry,
  retryDelay,
  worthRetrying,
} from '../src/upload-queue-core.ts'

/* `next` was one at a time; `startable` hands back everything that may go
   now. These cases were written about "what starts next", so they ask for the
   first of them — the queue order those assertions were really about. */
const next = (uploads, limits) => startable(uploads, limits)[0] ?? null

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

/* ---- how many go at once ------------------------------------------------
   One at a time was honest and slow; all at once is how twenty uploads time
   out together on one bar of signal. A few, with films kept to one. */

const many = (count, kind) =>
  enqueue(
    [],
    Array.from({ length: count }, (_unused, index) => ({
      key: `${kind || 'p'}${index}`,
      name: `${index}.jpg`,
      ...(kind ? { kind } : {}),
    })),
  )

test('a few go at once, in the order they were chosen', () => {
  const ten = many(10)
  assert.deepEqual(
    startable(ten).map(item => item.key),
    ['p0', 'p1', 'p2'],
  )
})

test('what is already going counts against the limit', () => {
  let queue = many(10)
  for (const key of ['p0', 'p1']) queue = begin(queue, key)
  assert.deepEqual(
    startable(queue).map(item => item.key),
    ['p2'],
    'room for one more, not three',
  )
  queue = begin(queue, 'p2')
  assert.deepEqual(startable(queue), [], 'and then none')
})

test('films go one at a time, whatever else is going', () => {
  /* A single 200MB video is already the whole uplink; two beside it make all
     three slower and likelier to drop. */
  const films = many(4, 'video')
  assert.deepEqual(
    startable(films).map(item => item.key),
    ['video0'],
  )
})

test('a film does not stop the photographs behind it', () => {
  /* The thing that made this worth doing: one big video at the front of the
     queue used to hold up thirty photographs that would each take a second. */
  const mixed = enqueue(
    [],
    [
      { key: 'film', name: 'clip.mp4', kind: 'video' },
      { key: 'a', name: 'a.jpg', kind: 'photo' },
      { key: 'b', name: 'b.jpg', kind: 'photo' },
      { key: 'c', name: 'c.jpg', kind: 'photo' },
    ],
  )
  assert.deepEqual(
    startable(mixed).map(item => item.key),
    ['film', 'a', 'b'],
  )
  // With the film going, the second one waits and the pictures carry on.
  const going = begin(mixed, 'film')
  assert.deepEqual(
    startable(going).map(item => item.key),
    ['a', 'b'],
  )
})

test('the limits can be argued with, which is how they are tested at all', () => {
  const ten = many(10)
  assert.equal(startable(ten, { atOnce: 1 }).length, 1)
  assert.equal(startable(ten, { atOnce: 8 }).length, 8)
  assert.equal(startable(many(4, 'video'), { atOnce: 4, filmsAtOnce: 2 }).length, 2)
})

test('nothing waiting means nothing to start', () => {
  assert.deepEqual(startable([]), [])
  assert.deepEqual(
    startable(fail(many(2), 'p0')).map(item => item.key),
    ['p1'],
  )
  assert.deepEqual(startable(hold(many(1), 'p0', 'waiting')), [], 'held is not waiting')
})

/* ---- the bar -------------------------------------------------------------
   "Uploading…" for four minutes is indistinguishable from nothing happening.
   What the bar draws has to come from bytes, not from a guess. */

test('bytes on the way out are remembered against the right upload', () => {
  const going = begin(many(2), 'p0')
  const moved = progressed(going, 'p0', 512, 2048)
  assert.equal(moved[0].sent, 512)
  assert.equal(moved[0].total, 2048)
  assert.equal(moved[1].sent, undefined, 'and nobody else moved')
})

test('starting an attempt puts the bar back to the beginning', () => {
  /* A retry that kept the old count would draw a bar starting at ninety per
     cent and going nowhere. */
  const stalled = progressed(begin(many(1), 'p0'), 'p0', 900, 1000)
  const again = begin(requeue(stalled, 'p0'), 'p0')
  assert.equal(again[0].sent, 0)
  assert.equal(again[0].total, null)
  assert.equal(retry(fail(stalled, 'p0', 'no'), 'p0')[0].sent, 0)
})

test('the bar is drawn from bytes, so one big film does not freeze it', () => {
  /* Forty photographs and one video are not forty-one equal things. Counted
     as items the bar sits still for the whole video; counted in bytes it
     moves the whole way through. */
  let queue = enqueue(
    [],
    [
      { key: 'film', name: 'clip.mp4', kind: 'video' },
      { key: 'a', name: 'a.jpg', kind: 'photo' },
    ],
  )
  queue = progressed(begin(queue, 'film'), 'film', 0, 90_000_000)
  queue = progressed(begin(queue, 'a'), 'a', 0, 10_000_000)
  assert.equal(overall(queue).fraction, 0)

  const half = progressed(queue, 'film', 45_000_000, 90_000_000)
  assert.ok(
    Math.abs(overall(half).fraction - 0.45) < 0.01,
    'halfway through the film is nearly halfway through the batch',
  )
})

test('the bar counts the whole batch, not what is left of it', () => {
  /* Taken from the queue alone this reads "1 of 12", then "1 of 11", because
     a finished upload is gone. */
  const queue = many(8)
  assert.deepEqual(
    { done: overall(queue, 4).done, total: overall(queue, 4).total },
    { done: 4, total: 12 },
  )
  assert.ok(overall(queue, 4).fraction > 0.3, 'four already up is not nought per cent')
  assert.equal(overall([], 0).fraction, 0, 'and an empty queue claims nothing')
})

test('failures are counted apart from progress', () => {
  const queue = fail(many(3), 'p0')
  const state = overall(queue, 0)
  assert.equal(state.failed, 1)
  assert.equal(state.total, 2, 'a failure is not still going up')
})

test('a browser that will not say how big it is draws a bar that does not claim', () => {
  const going = begin(many(1), 'p0')
  assert.equal(measurable(going), false, 'nothing known yet')
  assert.equal(measurable(progressed(going, 'p0', 10, 100)), true)
  assert.equal(measurable(progressed(going, 'p0', 10, null)), false)
})

test('every failure can be sent again at once', () => {
  /* Twelve photographs lost to a tunnel is one gesture, not twelve. */
  let queue = many(4)
  queue = fail(queue, 'p0', 'no signal')
  queue = fail(queue, 'p2', 'no signal')
  const again = retryAll(queue)
  assert.deepEqual(failed(again), [])
  assert.deepEqual(
    again.filter(item => item.state === 'waiting').map(item => item.key),
    ['p0', 'p1', 'p2', 'p3'],
  )
  assert.equal(retryAll(many(2)).length, 2, 'nothing failed is nothing to do')
})

test('an unmeasured upload is weighed as the measured ones are', () => {
  /* A fixed guess of a megabyte against four-megabyte photographs made the
     denominator shrink whenever an upload started and grow again the moment
     its real size arrived — so the bar ran forwards and then visibly
     backwards, several times a batch. */
  let queue = enqueue(
    [],
    [
      { key: 'a', name: 'a.jpg' },
      { key: 'b', name: 'b.jpg' },
    ],
  )
  queue = progressed(begin(queue, 'a'), 'a', 4_000_000, 4_000_000)
  const beforeItSays = overall(begin(queue, 'b'))
  const afterItSays = overall(progressed(begin(queue, 'b'), 'b', 0, 4_000_000))
  assert.ok(
    Math.abs(beforeItSays.fraction - afterItSays.fraction) < 0.001,
    'learning a size the batch could already have guessed must not move the bar',
  )
})

test('the drawn bar only ever goes forwards', () => {
  /* Whatever the arithmetic does underneath, a progress bar that goes
     backwards reads as work being undone. */
  assert.equal(furthest(0.4, 0.6, true), 0.6)
  assert.equal(furthest(0.6, 0.4, true), 0.6, 'it does not fall back')
  assert.equal(furthest(0.9, 0.2, false), 0, 'and it starts again with the next batch')
})

test('a whole batch of uploads never draws backwards', () => {
  /* The sequence a real batch goes through: several in flight, sizes arriving
     late, and finished ones leaving the queue underneath the bar. */
  let queue = enqueue(
    [],
    Array.from({ length: 6 }, (_unused, index) => ({ key: `p${index}`, name: `${index}.jpg` })),
  )
  let finished = 0
  let drawn = 0
  const draw = () => {
    drawn = furthest(drawn, overall(queue, finished).fraction, queue.length > 0)
    return drawn
  }
  const seen = [draw()]

  // Drained, not merely stirred: the last one has to land too.
  for (let guard = 0; queue.length && guard < 50; guard++) {
    for (const item of startable(queue)) {
      queue = begin(queue, item.key)
      seen.push(draw())
      queue = progressed(queue, item.key, 0, 4_000_000)
      seen.push(draw())
      queue = progressed(queue, item.key, 4_000_000, 4_000_000)
      seen.push(draw())
    }
    const going = queue.find(item => item.state === 'uploading')
    if (!going) break
    queue = done(queue, going.key)
    finished += 1
    seen.push(draw())
  }
  assert.equal(queue.length, 0, 'the queue drained')

  /* While there is a batch. The last reading is taken after the queue has
     emptied, which is the deliberate reset for the next one rather than a bar
     falling over at the finish. */
  const during = seen.slice(0, -1)
  assert.ok(
    during.every((value, at) => at === 0 || value >= during[at - 1]),
    `the bar went backwards: ${during.map(value => Math.round(value * 100)).join(' ')}`,
  )
  /* All but the last sliver. The final byte of the last upload is paid by its
     response, and that response is also what empties the queue — so the bar
     is taken off the screen at the moment it would have filled, rather than
     sitting at a hundred per cent waiting to be noticed. */
  assert.ok(
    during[during.length - 1] > 0.95,
    `the bar stopped short at ${Math.round(during[during.length - 1] * 100)}%`,
  )
  assert.equal(seen[seen.length - 1], 0, 'then started again for the next batch')
})

test('the caption names the one furthest along, not the one least far', () => {
  /* Three in flight and the caption saying "1 of 6" reads as stuck, beside a
     bar that is plainly half full. */
  let queue = many(6)
  assert.equal(overall(queue).working, 1, 'before anything starts, it is the first')
  for (const key of ['p0', 'p1', 'p2']) queue = begin(queue, key)
  assert.equal(overall(queue).working, 3)
  assert.equal(overall(done(queue, 'p0'), 1).working, 3, 'two going, one already up')
})

test('the caption never runs past the batch', () => {
  const queue = many(2)
  assert.equal(overall(begin(begin(queue, 'p0'), 'p1'), 0).working, 2)
  assert.equal(overall([], 4).working, 4, 'and it does not exceed what there was')
})

test('bytes sent is not the same as safely arrived', () => {
  /* The last byte reaches the socket and the server has still to decode,
     resize, write and answer. A bar that hits the end and then sits there is
     the complaint this was written to fix. */
  let queue = enqueue([], [{ key: 'a', name: 'a.jpg' }])
  queue = progressed(begin(queue, 'a'), 'a', 4_000_000, 4_000_000)
  const sentEverything = overall(queue).fraction
  assert.ok(sentEverything > 0.9, 'nearly there')
  assert.ok(sentEverything < 1, 'but not finished until the server says so')

  // And it is finished the moment the row exists.
  assert.equal(overall(done(queue, 'a'), 1).fraction, 1)
})
