import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { oncePerFrame } from '../../../frame-throttle-core'
import {
  carryDistance,
  dragMeans,
  followed,
  isDoubleTap,
  lastMoments,
  speedFrom,
  type Moment,
  type Tap,
} from '../../../swipe-core'
import {
  AT_REST,
  clampPan,
  dragPans,
  fitInside,
  spread,
  toggleZoom,
  zoomAbout,
  type View,
} from '../../../zoom-core'
import useFilmTrack from './use-film-track'

/* What a finger does to the photograph on its own, full screen.
 *
 * Four gestures share one surface: pinch to zoom, drag to move around once
 * zoomed, double tap to go in and out, and swipe to the next photograph while
 * there is nothing to pan. Double tap means zoom here rather than like, which
 * is what it means in every other full-screen photograph on a phone — and the
 * heart lives in the viewer this came from, one tap away.
 *
 * The swipe is the same one the viewer behind it has, on the same track: the
 * strip follows the finger and carries on to the next photograph in one
 * movement when it lets go. It used to decide at the moment the finger lifted
 * and then simply swap the picture, which reads as a machine doing what it
 * was told rather than a photograph being pushed aside.
 *
 * Only a picture at rest swipes. Zoomed in, a drag is panning and must never
 * turn the page: reaching the right-hand edge of something you are reading is
 * not a request to leave it.
 */

/* The stage, the picture drawn on it, and the middle of the screen in page
   coordinates. */
interface Stage {
  shown: { width: number; height: number }
  screen: { width: number; height: number }
  middle: { x: number; y: number }
}

/** Where a point sits relative to the middle, which is the picture's origin. */
const about = (stage: Stage, x: number, y: number) => ({
  x: x - stage.middle.x,
  y: y - stage.middle.y,
})

export default function useZoomGestures({
  photoId,
  index,
  length,
  setIndex,
  stage,
  onClose,
}: {
  /** What is being looked at, so a new picture is not the old one's zoom. */
  photoId: string
  index: number
  length: number
  setIndex: (index: number) => void
  stage: React.RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  const track = useFilmTrack({ index, length, setIndex })
  const { takeOver, follow, page, home } = track

  const [view, setView] = useState<View>(AT_REST)
  /* Every finger currently down, by its own id. Two of them is a pinch; the
     map is what makes the second one arriving mid-drag harmless. */
  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ apart: number; view: View } | null>(null)
  const from = useRef<{ x: number; y: number; at: number; view: View } | null>(null)
  const recent = useRef<Moment[]>([])
  const lastTap = useRef<Tap | null>(null)
  const carry = useRef(64)

  /* What the picture is drawn at when it is not zoomed, and the screen it is
     drawn on. Measured rather than remembered: the phone can turn over. */
  const measure = useCallback((): Stage => {
    const screen = stage.current?.getBoundingClientRect()
    /* The middle pane's picture, not simply the first one on the stage: the
       neighbours either side are on it too, and a zoom worked out from the
       shape of the photograph BEFORE this one clamps the pan to the wrong
       box. Read off the element rather than held in a ref, because Img is
       memoised and does not forward one. */
    const image = stage.current?.querySelector('.vzpane.on img')
    const fallback = { width: 1, height: 1 }
    if (!screen) return { shown: fallback, screen: fallback, middle: { x: 0, y: 0 } }
    const size = { width: screen.width, height: screen.height }
    return {
      screen: size,
      shown: fitInside(
        {
          width: (image as HTMLImageElement | null)?.naturalWidth ?? 0,
          height: (image as HTMLImageElement | null)?.naturalHeight ?? 0,
        },
        size,
      ),
      middle: { x: screen.left + screen.width / 2, y: screen.top + screen.height / 2 },
    }
  }, [stage])

  /* Measured once when a finger lands and held for the whole gesture. Reading
     a bounding rect forces the browser to lay the page out there and then, and
     a finger reports itself a hundred and twenty times a second: doing it per
     move was the main thread being busy with an answer it already had at the
     moment the next touch arrived. The stage is fixed to the screen and the
     picture's natural size belongs to the file, so neither can change while a
     finger is down — and the next gesture takes its own measurement, so a
     phone turned over between them is measured again. */
  const held = useRef<Stage | null>(null)
  const measured = useCallback(() => {
    /* Except a picture that had not decoded when the finger landed: it has no
       drawn size worth keeping, so look again until it has one. */
    const kept = held.current
    if (kept && kept.shown.width > 0 && kept.shown.height > 0) return kept
    held.current = measure()
    return held.current
  }, [measure])

  /* The picture follows the fingers once a frame rather than once an event.
     Each of these is a render, and the ones between two paints were never
     going to be seen. */
  const flow = useMemo(() => oncePerFrame(setView), [])
  useEffect(() => () => flow.cancel(), [flow])
  /** A view set outright — and nothing half-drawn left to land on top of it. */
  const settle = useCallback(
    (next: View) => {
      flow.cancel()
      setView(next)
    },
    [flow],
  )

  // A new photograph is a new picture to look at, not the old one's zoom.
  useEffect(() => settle(AT_REST), [photoId, settle])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      held.current = measure()
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (fingers.current.size === 2) {
        const [a, b] = [...fingers.current.values()]
        pinch.current = { apart: spread(a, b), view }
        /* A drag that has become a pinch: whatever the strip had followed is
           let go of here, or it sits off-centre for good — the pinch's own
           fingers lift with nothing to read, so nothing else would. */
        if (from.current) home()
        from.current = null
        return
      }
      takeOver()
      carry.current = carryDistance(held.current.screen.width)
      from.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, view }
      recent.current = [{ x: event.clientX, at: event.timeStamp }]
    },
    [home, measure, takeOver, view],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!fingers.current.has(event.pointerId)) return
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      const started = pinch.current
      if (started && fingers.current.size >= 2) {
        const [a, b] = [...fingers.current.values()]
        const apart = spread(a, b)
        if (!(started.apart > 0)) return
        const box = measured()
        const middle = about(box, (a.x + b.x) / 2, (a.y + b.y) / 2)
        flow(zoomAbout(started.view, apart / started.apart, middle, box.shown, box.screen))
        return
      }

      const start = from.current
      if (!start) return
      recent.current.push({ x: event.clientX, at: event.timeStamp })
      recent.current = lastMoments(recent.current, event.timeStamp)

      /* At rest there is nothing to pan, so the finger moves the strip — the
         next photograph coming in at the edge, the same as in the viewer
         behind this one. */
      if (!dragPans(start.view)) {
        follow(followed({ dx: event.clientX - start.x, dy: event.clientY - start.y }))
        return
      }

      // Zoomed in: the picture itself follows the finger.
      const box = measured()
      flow(
        clampPan(
          {
            scale: start.view.scale,
            x: start.view.x + (event.clientX - start.x),
            y: start.view.y + (event.clientY - start.y),
          },
          box.shown,
          box.screen,
        ),
      )
    },
    [flow, follow, measured],
  )

  /* A tap is either half of a double tap or the way out, and the only thing
     that tells them apart is waiting to see whether a second one arrives. The
     wait is the same one every phone uses. */
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(closing.current ?? undefined), [])

  const onTap = useCallback(
    (tap: Tap, current: View) => {
      clearTimeout(closing.current ?? undefined)
      closing.current = null
      if (isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null
        const box = measured()
        settle(toggleZoom(current, about(box, tap.x, tap.y), box.shown, box.screen))
        return
      }
      lastTap.current = tap
      closing.current = setTimeout(() => {
        closing.current = null
        /* A single tap on a picture at rest is "I am done looking at this".
           Zoomed in it is not: a thumb resting on a photograph somebody is
           reading should not throw them out of it. */
        if (!dragPans(current)) onClose()
      }, 330)
    },
    [measured, onClose, settle],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      fingers.current.delete(event.pointerId)
      if (fingers.current.size < 2) pinch.current = null
      const start = from.current
      from.current = null
      // Still a finger down, or this one was part of a pinch: nothing to read.
      if (!start || fingers.current.size > 0) return

      const means = dragMeans(
        {
          dx: event.clientX - start.x,
          dy: event.clientY - start.y,
          ms: event.timeStamp - start.at,
          vx: speedFrom(recent.current, event.timeStamp, event.clientX),
        },
        { travel: carry.current },
      )
      recent.current = []
      const tap = { at: event.timeStamp, x: event.clientX, y: event.clientY }

      if (dragPans(start.view)) {
        // The finger was moving the picture. Only a still one means anything.
        if (means === 'tap') onTap(tap, view)
        return
      }
      if (means === 'next' || means === 'previous') {
        lastTap.current = null
        clearTimeout(closing.current ?? undefined)
        closing.current = null
        if (length > 1) page(means === 'next' ? 1 : -1)
        else home()
        return
      }
      home()
      if (means === 'tap') onTap(tap, view)
    },
    [home, length, onTap, page, view],
  )

  /* The browser taking the gesture away mid-swipe must not leave the strip
     parked half off the screen. */
  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      fingers.current.delete(event.pointerId)
      if (fingers.current.size < 2) pinch.current = null
      if (!from.current) return
      from.current = null
      recent.current = []
      home()
    },
    [home],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && length > 1) track.turn(-1)
      if (event.key === 'ArrowRight' && length > 1) track.turn(1)
      if (event.key === '0') settle(AT_REST)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [length, settle, track.turn])

  return {
    ...track,
    view,
    /** Back to the whole picture, from the Fit button. */
    reset: useCallback(() => settle(AT_REST), [settle]),
    /** Whether a finger is on the glass, which decides whether to ease. */
    touched: fingers.current.size > 0,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      /* A native drag cancels the pointer stream, and everything here — pinch,
         pan, the swipe to the next photograph — is read by hand from that
         stream. The stylesheet stops a selection from starting; this stops
         anything else the browser might decide to drag. The long version is in
         use-viewer-gestures, where the same guard sits on the viewer's own
         stage. */
      onDragStart: (event: React.DragEvent) => event.preventDefault(),
    },
  }
}
