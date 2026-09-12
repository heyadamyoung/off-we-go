import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import { dragMeans, isDoubleTap, type Tap } from '../../../swipe-core'
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
import type { TripPhoto } from '../../../shared/model/types'

/* The photograph, and nothing else at all.
 *
 * The viewer around this is a good place to read a trip — caption, comments,
 * where it was taken — and a poor place to LOOK at a photograph, because all
 * of that is competing with it for a phone screen. So a tap on the picture
 * brings it here, where the chrome is one button and the picture has the rest.
 *
 * Everything a thumb expects works: pinch to zoom, drag to move around once
 * zoomed, double tap to go in and out, swipe to the next photograph while
 * there is nothing to pan. Double tap means zoom here rather than like, which
 * is what it means in every other full-screen photograph on a phone — and the
 * heart lives in the viewer this came from, one tap away.
 */
/* A native drag cancels the pointer stream, and everything here — pinch, pan,
   the swipe to the next photograph — is read by hand from that stream. The
   stylesheet stops a selection from starting; this stops anything else the
   browser might decide to drag. The long version is in use-viewer-gestures,
   where the same guard sits on the viewer's own stage. */
const preventDrag = (event: React.DragEvent) => event.preventDefault()

export default function PhotoZoom({
  photo,
  onClose,
  onPage,
  siblings,
}: {
  photo: TripPhoto
  onClose: () => void
  onPage: (way: 'previous' | 'next') => void
  /** Whether there is anywhere to swipe to. */
  siblings: boolean
}) {
  const [view, setView] = useState<View>(AT_REST)
  const stage = useRef<HTMLDivElement | null>(null)
  /* Every finger currently down, by its own id. Two of them is a pinch; the
     map is what makes the second one arriving mid-drag harmless. */
  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ apart: number; view: View } | null>(null)
  const from = useRef<{ x: number; y: number; at: number; view: View } | null>(null)
  const lastTap = useRef<Tap | null>(null)

  // A new photograph is a new picture to look at, not the old one's zoom.
  useEffect(() => setView(AT_REST), [photo.id])

  /* What the picture is drawn at when it is not zoomed, and the screen it is
     drawn on. Measured rather than remembered: the phone can turn over. */
  const boxes = useCallback(() => {
    const screen = stage.current?.getBoundingClientRect()
    // Read off the element rather than held in a ref: Img is memoised and does
    // not forward one, and the size is only ever wanted mid-gesture anyway.
    const image = stage.current?.querySelector('img')
    const fallback = { width: 1, height: 1 }
    if (!screen) return { shown: fallback, screen: fallback }
    const size = { width: screen.width, height: screen.height }
    return {
      screen: size,
      shown: fitInside(
        { width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 },
        size,
      ),
    }
  }, [])

  /* Where a point sits relative to the middle of the screen, which is where
     the photograph's own origin is. */
  const middleOf = useCallback((x: number, y: number) => {
    const screen = stage.current?.getBoundingClientRect()
    if (!screen) return { x: 0, y: 0 }
    return { x: x - (screen.left + screen.width / 2), y: y - (screen.top + screen.height / 2) }
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (fingers.current.size === 2) {
        const [a, b] = [...fingers.current.values()]
        pinch.current = { apart: spread(a, b), view }
        from.current = null
        return
      }
      from.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, view }
    },
    [view],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!fingers.current.has(event.pointerId)) return
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      const held = pinch.current
      if (held && fingers.current.size >= 2) {
        const [a, b] = [...fingers.current.values()]
        const apart = spread(a, b)
        if (!(held.apart > 0)) return
        const { shown, screen } = boxes()
        const middle = middleOf((a.x + b.x) / 2, (a.y + b.y) / 2)
        setView(zoomAbout(held.view, apart / held.apart, middle, shown, screen))
        return
      }

      /* One finger, and something to pan: the picture follows it. At rest
         there is nothing to pan, so the drag is left to become a swipe when
         the finger lifts. */
      const start = from.current
      if (!start || !dragPans(start.view)) return
      const { shown, screen } = boxes()
      setView(
        clampPan(
          {
            scale: start.view.scale,
            x: start.view.x + (event.clientX - start.x),
            y: start.view.y + (event.clientY - start.y),
          },
          shown,
          screen,
        ),
      )
    },
    [boxes, middleOf],
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
        const { shown, screen } = boxes()
        setView(toggleZoom(current, middleOf(tap.x, tap.y), shown, screen))
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
    [boxes, middleOf, onClose],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      fingers.current.delete(event.pointerId)
      if (fingers.current.size < 2) pinch.current = null
      const start = from.current
      from.current = null
      // Still a finger down, or this one was part of a pinch: nothing to read.
      if (!start || fingers.current.size > 0) return

      const means = dragMeans({
        dx: event.clientX - start.x,
        dy: event.clientY - start.y,
        ms: event.timeStamp - start.at,
      })
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
        if (siblings) onPage(means)
        return
      }
      if (means === 'tap') onTap(tap, view)
    },
    [onPage, onTap, siblings, view],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && siblings) onPage('previous')
      if (event.key === 'ArrowRight' && siblings) onPage('next')
      if (event.key === '0') setView(AT_REST)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPage, siblings])

  /* Every gesture this stage reads, in one place — including the one that says
     the browser may not take the gesture for itself. */
  const stageHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onDragStart: preventDrag,
  }

  return (
    <div className="vzoom" role="dialog" aria-modal="true" aria-label={photo.caption || 'Photo'}>
      <div className="vzstage" ref={stage} {...stageHandlers}>
        <Img
          className="vzimg"
          item={photo}
          w={2400}
          h={1800}
          alt={photo.caption}
          eager
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
            /* Only while a finger is off the glass: easing a pinch makes the
               picture lag the fingers, which reads as the phone struggling. */
            transition: fingers.current.size ? 'none' : 'transform .18s ease-out',
          }}
        />
      </div>
      <button className="vzclose" onClick={onClose} title="Close" aria-label="Close">
        <Icon n="x" s={18} c="#fff" w={2} />
      </button>
      {view.scale > 1.01 && (
        <button className="vzreset" onClick={() => setView(AT_REST)}>
          Fit
        </button>
      )}
    </div>
  )
}
