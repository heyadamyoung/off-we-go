import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  atSlot,
  carryDistance,
  dragMeans,
  followed,
  isDoubleTap,
  strip,
  trackShift,
  type Tap,
} from '../../../swipe-core'

/* What a finger does to the photograph on the viewer's stage.
 *
 * Three gestures share one surface, and the whole trick is that they cannot
 * be told apart until the finger lifts:
 *
 *   swipe across   turn the page
 *   double tap     heart it
 *   single tap     open it full screen, on its own
 *
 * Before this there was only the third of those, and it was a like: the whole
 * photograph was a button, so a swipe ended as a tap and every attempt to page
 * through a trip hearted the picture instead of moving. One reader now decides
 * which of the three happened, so two of them can never happen at once.
 *
 * The single tap waits out the double tap that hearts it. That wait is the
 * same one every phone uses, and without it a like would flash the full-screen
 * view open on its way past.
 */
/* How long the strip takes to travel, and how long to wait for the browser to
   say it has. A turn is a whole photograph's width and reads as sluggish much
   under a quarter of a second and as a twitch much over it; the spring back
   from a swipe that did not carry is shorter, because nothing happened and
   the screen should stop saying so quickly.

   The grace is for a transition that never starts. The browser skips one
   whose value does not change, and a tab in the background runs none at all,
   so the commit cannot be left waiting on an event that is not coming. */
/* How much of the end of a gesture counts as "how fast it was going". Long
   enough to measure across a couple of pointer events, short enough that a
   finger which has come to rest reads as at rest. */
const RECENT_MS = 90

const TURN_MS = 260
const EASE_MS = 180
const LATE_MS = 90

/* Whether a pointer came down on something that answers for itself. The
   photograph is a button too — it is the keyboard's way to like — so it is the
   one control the stage still reads. */
function fromChrome(target: EventTarget | null): boolean {
  const control = (target as Element | null)?.closest?.('button, a[href], input, video')
  return !!control && !control.classList.contains('vmaintap')
}

export default function useViewerGestures({
  index,
  length,
  setIndex,
  onLike,
  onOpen,
}: {
  index: number
  length: number
  setIndex: (index: number) => void
  onLike: () => void
  onOpen: () => void
}) {
  /* Where the finger went down, and the tap before this one. Refs rather than
     state: a gesture in progress is not something the screen should redraw
     for, and re-rendering mid-drag is how a drag loses its own start. */
  const from = useRef<{ x: number; y: number; at: number } | null>(null)
  /* The last moment of the gesture, for how fast it was going when it left.
     An average over the whole swipe says a finger that set off quickly and
     then stopped was quick — which is exactly the shape of changing your
     mind, and exactly the case that used to turn the page anyway. */
  const recent = useRef<Array<{ x: number; at: number }>>([])
  const lastTap = useRef<Tap | null>(null)
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(opening.current ?? undefined), [])

  /* How far the photograph has followed the finger. A swipe that moves
     nothing is a swipe you cannot tell is working; letting the strip move
     says "yes, this is a page turn" while there is still time to change your
     mind. State rather than a ref, because this one is drawn — it is the only
     part of a gesture that is. */
  const [dx, setDx] = useState(0)
  /* Which way the strip is travelling, while it travels: 1 to the next
     photograph, -1 to the one before, 0 the rest of the time. */
  const [moving, setMoving] = useState(0)
  /* Whether the strip is easing rather than tracking a finger. Off under the
     finger, so the picture does not lag behind it; off again for the single
     frame in which a finished turn is committed, so nothing walks back. */
  const [easing, setEasing] = useState(false)

  /* Where the strip is counted from. It never wraps — it goes up as you page
     forward and down as you page back — so a pane keeps its identity across a
     turn, and the browser moves it rather than rebuilding it. Rebuilt panes
     are how a photograph that was already on the screen gets fetched again. */
  const [slot, setSlot] = useState(index)
  /* An index changed from somewhere else — the strip along the bottom, a pin
     on the map, the keyboard — is not a turn this strip made. */
  useEffect(() => {
    setSlot(current => (atSlot(current, length) === index ? current : index))
  }, [index, length])

  /* How far this particular picture has to be carried, and how wide a whole
     turn is. Measured off the stage the finger is actually on, at the moment
     it goes down, so a phone turned on its side asks for the width it now
     has. */
  const carry = useRef(64)
  const width = useRef(0)

  /* Which way it is travelling, kept alongside the state so that finishing a
     turn can read it without asking React for it.

     This used to be read inside a setMoving updater, and the index was moved
     from in there — a state update run during another component's render,
     which React is free to drop. It mostly did not, which is the worst way
     for a bug to behave: the strip would slide to the next photograph, and
     every so often the caption, the map and the comments would stay on the
     last one. */
  const way = useRef(0)
  const travel = useCallback((into: number) => {
    way.current = into
    setMoving(into)
  }, [])

  /* A turn that has arrived: the index moves, the strip re-centres, and both
     happen in one render with no transition — so the picture that slid into
     the middle simply stays there. */
  const settle = useCallback(() => {
    const going = way.current
    if (going) {
      way.current = 0
      setSlot(was => was + going)
      setIndex(atSlot(slot + going, length))
    }
    setMoving(0)
    setEasing(false)
    setDx(0)
  }, [slot, length, setIndex])

  /* A transition that never starts never ends. The browser skips one whose
     value does not change — a turn begun when the strip happened to be at
     exactly nought, a stage the tab has since hidden — and without this the
     viewer would sit on a page turn that had already visually happened. */
  const late = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleRef = useRef(settle)
  settleRef.current = settle
  const arrive = useCallback((after: number) => {
    clearTimeout(late.current ?? undefined)
    late.current = setTimeout(() => {
      late.current = null
      settleRef.current()
    }, after)
  }, [])
  useEffect(() => () => clearTimeout(late.current ?? undefined), [])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    /* The arrows and the film's own controls live on this stage too, and a
         click on one of them is a tap as far as a pointer is concerned — so
         turning the page with the arrow ALSO opened the picture full screen.
         A control is answering for itself; the stage stays out of it. */
    if (fromChrome(event.target)) {
      from.current = null
      return
    }
    /* A finger arriving during a turn takes over from it. The turn is
         finished where it stands rather than abandoned, so the strip is
         always counted from a whole photograph and a fast reader paging three
         at a time gets three, not one and a half. */
    clearTimeout(late.current ?? undefined)
    late.current = null
    settleRef.current()
    const stage = event.currentTarget.getBoundingClientRect().width
    width.current = stage
    carry.current = carryDistance(stage)
    from.current = { x: event.clientX, y: event.clientY, at: event.timeStamp }
    recent.current = [{ x: event.clientX, at: event.timeStamp }]
    setEasing(false)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = from.current
    if (!start) return
    recent.current.push({ x: event.clientX, at: event.timeStamp })
    /* Only the last moment is kept. Two samples are enough to measure a speed,
       and the rest is the part of the gesture already decided about. */
    while (recent.current.length > 2 && event.timeStamp - recent.current[1].at > RECENT_MS)
      recent.current.shift()
    setDx(followed({ dx: event.clientX - start.x, dy: event.clientY - start.y }))
  }, [])

  /* Pixels a millisecond, rightwards, over that last moment. A gesture with
     nothing to measure — one move, or two in the same millisecond — is not
     fast, it is unmeasured, and unmeasured must read as still: guessing fast
     is how a nudge turns the page. */
  const speed = useCallback((at: number, x: number) => {
    const first = recent.current[0]
    if (!first) return 0
    const ms = at - first.at
    return ms > 0 ? (x - first.x) / ms : 0
  }, [])

  /* Let go of the drag and let the picture ease home. Cancelling counts: a
     pointer the browser takes away mid-swipe must not leave the photograph
     parked half off the screen. */
  const forget = useCallback(() => {
    from.current = null
    setEasing(true)
    setDx(0)
    arrive(EASE_MS + LATE_MS)
  }, [arrive])

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const start = from.current
      from.current = null
      if (!start) {
        setEasing(false)
        setDx(0)
        return
      }

      const means = dragMeans(
        {
          dx: event.clientX - start.x,
          dy: event.clientY - start.y,
          ms: event.timeStamp - start.at,
          vx: speed(event.timeStamp, event.clientX),
        },
        { travel: carry.current },
      )
      recent.current = []

      if (means === 'next' || means === 'previous') {
        lastTap.current = null
        clearTimeout(opening.current ?? undefined)
        opening.current = null
        /* One movement, carried on from where the finger left it: the strip
           keeps going the way it was pushed until the next photograph is in
           the middle. The picture does not walk back and it is not swapped —
           the one arriving has been on the screen the whole time, just past
           the edge of it.

           `dx` goes to nought and `moving` takes over, so the track's target
           is exactly one width away and the distance still to travel is
           whatever the finger had not covered. */
        setDx(0)
        travel(means === 'next' ? 1 : -1)
        setEasing(true)
        arrive(TURN_MS + LATE_MS)
        return
      }

      // Not paging: let it ease back to the middle, which is the whole point.
      setEasing(true)
      setDx(0)
      arrive(EASE_MS + LATE_MS)
      if (means !== 'tap') return

      const tap = { at: event.timeStamp, x: event.clientX, y: event.clientY }
      clearTimeout(opening.current ?? undefined)
      opening.current = null
      if (isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null
        onLike()
        return
      }
      lastTap.current = tap
      opening.current = setTimeout(() => {
        opening.current = null
        onOpen()
      }, 330)
    },
    [onLike, onOpen, arrive, speed, travel],
  )

  /* The arrows and the keyboard turn the page the same way a finger does.
     Setting the index outright would put the next photograph on the screen
     without any of it moving, which is a different thing happening depending
     on how you asked for it. */
  const turn = useCallback(
    (into: 1 | -1) => {
      clearTimeout(late.current ?? undefined)
      late.current = null
      settleRef.current()
      travel(into)
      setEasing(true)
      arrive(TURN_MS + LATE_MS)
    },
    [arrive, travel],
  )

  /* The transition's own word that it has finished, which is what makes the
     commit land on the frame the movement ends rather than a guess later.
     Only the track's own transform: a heart popping over the picture ends a
     transition too, and it is not this one. */
  const onTransitionEnd = useCallback(
    (event: React.TransitionEvent) => {
      if (event.target !== event.currentTarget || event.propertyName !== 'transform') return
      clearTimeout(late.current ?? undefined)
      late.current = null
      settle()
    },
    [settle],
  )

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: forget,
      /* The browser must not take this gesture for a drag.

         A mouse swipe selects whatever it crosses, and the swipe after that
         drags the selection — at which point the browser sends pointercancel
         and keeps the rest for itself. No pointerup arrives, so this reader,
         which decides what a gesture meant at the moment the finger lifts,
         never hears that it did: the photograph eases back and the page does
         not turn, with nothing on screen to say why. It needs a selection to
         exist first, which is why it bit on the second swipe and read as a
         flake. The stylesheet stops the selection; this stops the drag. */
      onDragStart: (event: React.DragEvent) => event.preventDefault(),
    },
    /* What the stage draws. The slots to lay out, where the track sits, and
       whether it is easing there or tracking a finger. */
    slots: strip(slot, length),
    /* The one being looked at. The panes are laid out relative to THIS, not
       to the first of them: laid out from the first, the whole strip sat one
       photograph to the right and what you were looking at was the previous
       picture, with the real one peeking in at the edge. */
    slot,
    at: (value: number) => atSlot(value, length),
    shift: trackShift(dx, moving),
    dx,
    moving,
    easing,
    turn,
    onTransitionEnd,
    ms: moving ? TURN_MS : EASE_MS,
  }
}
