import assert from 'node:assert/strict'
import test from 'node:test'
import { oncePerFrame } from '../src/frame-throttle-core.ts'

/* Reported from the road: "scrolling photos can be unresponsive at times,
   especially in the zoom view". Nothing in it is slow on its own — it is that
   a finger reports itself a hundred and twenty times a second and every
   report was ending in a forced layout and a render. */

/** A screen that only paints when told to. */
const screen = () => {
  const frames = []
  return {
    frames,
    schedule: run => frames.push(run),
    cancel: handle => {
      frames[handle - 1] = null
    },
    /** The handle is the index after it, so nothing is ever a falsy handle. */
    paint: () => {
      const due = frames.splice(0, frames.length)
      for (const run of due) run?.()
    },
  }
}

const throttleOn = (paper, run) =>
  oncePerFrame(run, {
    schedule: work => paper.schedule(work),
    cancel: handle => paper.cancel(handle),
  })

test('a hundred calls inside one frame run the work once', () => {
  const paper = screen()
  const ran = []
  const throttled = throttleOn(paper, at => ran.push(at))

  for (let at = 0; at < 100; at++) throttled(at)
  assert.deepEqual(ran, [], 'nothing runs before the screen paints')

  paper.paint()
  assert.equal(ran.length, 1)
})

test('the run gets the newest arguments, not the first ones', () => {
  /* The whole bargain: the calls in between were never going to be seen, so
     dropping them costs nothing — but the last one is where the finger is. */
  const paper = screen()
  const ran = []
  const throttled = throttleOn(paper, at => ran.push(at))

  throttled('first')
  throttled('middle')
  throttled('newest')
  paper.paint()

  assert.deepEqual(ran, ['newest'])
})

test('each frame gets its own run, so a long drag is not one measurement', () => {
  const paper = screen()
  const ran = []
  const throttled = throttleOn(paper, at => ran.push(at))

  for (const frame of ['a', 'b', 'c']) {
    throttled(`${frame}1`)
    throttled(`${frame}2`)
    paper.paint()
  }

  assert.deepEqual(ran, ['a2', 'b2', 'c2'])
})

test('cancelling drops the frame that was waiting', () => {
  /* An effect's cleanup. A measurement that lands after the element it was
     measuring has gone is a render of nothing, on a component that may not be
     there to receive it. */
  const paper = screen()
  const ran = []
  const throttled = throttleOn(paper, at => ran.push(at))

  throttled('waiting')
  throttled.cancel()
  paper.paint()

  assert.deepEqual(ran, [])
})

test('it still works after being cancelled', () => {
  const paper = screen()
  const ran = []
  const throttled = throttleOn(paper, at => ran.push(at))

  throttled('dropped')
  throttled.cancel()
  throttled('kept')
  paper.paint()

  assert.deepEqual(ran, ['kept'])
})

test('a scheduler that runs straight through does not jam after the first call', () => {
  /* Server rendering, and the tests around anything that uses this: with no
     requestAnimationFrame the work runs where it stands. The trap is that such
     a scheduler has already fired by the time it hands back its handle, so a
     frame recorded as in flight afterwards is one that never lands — and every
     call after the first is silently thrown away. */
  const ran = []
  const throttled = oncePerFrame(at => ran.push(at), {
    schedule: run => {
      run()
      return 0
    },
    cancel: () => {},
  })

  throttled('one')
  throttled('two')
  throttled('three')

  assert.deepEqual(ran, ['one', 'two', 'three'])
})

test('cancelling does not reach for a frame that has already run', () => {
  /* Whoever hands back the handle does so after the work, not before, when the
     scheduler runs straight through. Holding on to that one would have the
     cleanup cancel a frame that is long finished — and on a screen, a number
     the browser has since given to somebody else. */
  const cancelled = []
  const throttled = oncePerFrame(() => {}, {
    schedule: run => {
      run()
      return 77
    },
    cancel: handle => cancelled.push(handle),
  })

  throttled()
  throttled.cancel()

  assert.deepEqual(cancelled, [])
})

test('work scheduled from inside the work waits for the next frame', () => {
  /* A measurement that moves something that is being measured would otherwise
     loop until the stack gave out. */
  const paper = screen()
  let runs = 0
  const throttled = oncePerFrame(
    () => {
      runs++
      if (runs < 5) throttled()
    },
    {
      schedule: work => paper.schedule(work),
      cancel: handle => paper.cancel(handle),
    },
  )

  throttled()
  paper.paint()
  assert.equal(runs, 1, 'the re-entrant call is a new frame, not this one')

  paper.paint()
  assert.equal(runs, 2)
})
