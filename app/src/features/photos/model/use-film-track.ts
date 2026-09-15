import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { atSlot, strip, trackShift } from '../../../swipe-core'

/* The filmstrip itself: three photographs side by side, and the movement of
 * the track that holds them.
 *
 * A viewer that draws one picture and puts its transform back to nought when
 * the page turns can only ever snap — there is no next photograph on the
 * screen to slide in, so the one you pushed walks back to the middle and is
 * replaced where it stands. Under the finger the next one comes in at the
 * edge; let go and the track carries on to it in one movement. Nothing is
 * swapped and nothing reloads, because the picture that arrives has been on
 * the screen the whole time, just past the edge of it.
 *
 * Kept apart from what a finger MEANT, which is a different question with a
 * different answer on each surface: the viewer reads a swipe, a heart and a
 * tap; the full-screen picture reads a swipe, a pinch, a pan and a tap. What
 * they share is this — where the strip sits, and how a turn finishes.
 */

/* How long a turn takes, and how long to wait for the browser to say it has.
   A turn is a whole photograph's width and reads as sluggish much under a
   quarter of a second and as a twitch much over it; the spring back from a
   swipe that did not carry is shorter, because nothing happened and the
   screen should stop saying so quickly.

   The grace is for a transition that never starts. The browser skips one
   whose value does not change, and a tab in the background runs none at all,
   so the commit cannot be left waiting on an event that is not coming. */
const TURN_MS = 260
const EASE_MS = 180
const LATE_MS = 90

export default function useFilmTrack({
  index,
  length,
  setIndex,
}: {
  index: number
  length: number
  setIndex: (index: number) => void
}) {
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

  /* Which way it is travelling, kept alongside the state so that finishing a
     turn can read it without asking React for it.

     This used to be read inside a setMoving updater, and the index was moved
     from in there — a state update run during another component's render,
     which React is free to drop. It mostly did not, which is the worst way
     for a bug to behave: the strip would slide to the next photograph, and
     every so often the caption, the map and the comments would stay on the
     last one. */
  const way = useRef(0)

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

  /* A finger arriving during a turn takes over from it. The turn is finished
     where it stands rather than abandoned, so the strip is always counted
     from a whole photograph and a fast reader paging three at a time gets
     three, not one and a half. */
  const takeOver = useCallback(() => {
    clearTimeout(late.current ?? undefined)
    late.current = null
    settleRef.current()
    setEasing(false)
  }, [])

  /** The strip under the finger, at the offset it has been carried to. */
  const follow = useCallback((carried: number) => setDx(carried), [])

  /* One movement, carried on from where the finger left it: the strip keeps
     going the way it was pushed until the next photograph is in the middle.
     `dx` goes to nought and `moving` takes over, so the track's target is
     exactly one width away and the distance still to travel is whatever the
     finger had not covered. */
  const page = useCallback(
    (into: 1 | -1) => {
      setDx(0)
      way.current = into
      setMoving(into)
      setEasing(true)
      arrive(TURN_MS + LATE_MS)
    },
    [arrive],
  )

  /** Not paging: let it ease back to the middle, which is the whole point. */
  const home = useCallback(() => {
    setEasing(true)
    setDx(0)
    arrive(EASE_MS + LATE_MS)
  }, [arrive])

  /* The arrows and the keyboard turn the page the same way a finger does.
     Setting the index outright would put the next photograph on the screen
     without any of it moving, which is a different thing happening depending
     on how you asked for it. */
  const turn = useCallback(
    (into: 1 | -1) => {
      takeOver()
      page(into)
    },
    [page, takeOver],
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
    ms: moving ? TURN_MS : EASE_MS,
    onTransitionEnd,
    takeOver,
    follow,
    page,
    home,
    turn,
  }
}

export type FilmTrack = ReturnType<typeof useFilmTrack>
