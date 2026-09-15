/* Work that can only ever be shown once a frame.

   A scroll or a pointer move fires far more often than a screen can paint — a
   hundred and twenty times a second under a finger on a recent phone, and
   faster than that under a trackpad. Every one of these handlers ends in a
   measurement and a render, so running them per event runs them several times
   for each frame anybody sees. The extra ones are invisible by definition, and
   the main thread is busy doing them when the next touch arrives, which is
   what a gesture ignoring you actually is.

   So the work is scheduled rather than run. A frame that already has one
   scheduled keeps the newest arguments instead of queueing a second: the last
   call before the paint is the one that matters, and the ones before it were
   never going to be seen. Nothing is dropped that could have been drawn.

   Injected schedulers so this can be tested without a screen in the room. */

type Scheduler = (run: () => void) => number
type Canceller = (handle: number) => void

export interface FrameOptions {
  schedule?: Scheduler
  cancel?: Canceller
}

export interface Throttled<A extends unknown[]> {
  (...args: A): void
  /** Drop anything waiting. For an effect's cleanup: a frame that lands after
      the thing it was measuring has gone is a render of nothing. */
  cancel(): void
}

const defaults = (): Required<FrameOptions> =>
  typeof requestAnimationFrame === 'function'
    ? { schedule: requestAnimationFrame, cancel: cancelAnimationFrame }
    : /* No screen — a test, or a render on a server. Straight through, so the
         behaviour is the same and only the timing is missing. */
      {
        schedule: run => {
          run()
          return 0
        },
        cancel: () => {},
      }

export function oncePerFrame<A extends unknown[]>(
  run: (...args: A) => void,
  options: FrameOptions = {},
): Throttled<A> {
  const { schedule, cancel } = { ...defaults(), ...options }
  let waiting = false
  let handle: number | null = null
  let latest: A | null = null

  const fire = () => {
    waiting = false
    handle = null
    const args = latest
    latest = null
    if (args) run(...args)
  }

  const throttled = ((...args: A) => {
    latest = args
    if (waiting) return
    waiting = true
    const id = schedule(fire)
    /* A scheduler that runs straight through has already fired by the time it
       hands back a handle, and keeping that one would leave a frame in flight
       for ever — every later call seeing work already scheduled, and none of
       it ever happening. */
    if (waiting) handle = id
  }) as Throttled<A>

  throttled.cancel = () => {
    if (handle !== null) cancel(handle)
    waiting = false
    handle = null
    latest = null
  }
  return throttled
}
