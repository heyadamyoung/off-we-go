import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  NOTHING,
  chosenInOrder,
  extendTo,
  prunedTo,
  setChosen,
  toggleMany,
  toggleOne,
  type Selection,
} from '../../../photo-select-core'
import type { Id, TripPhoto } from '../../../shared/model/types'

/* Choosing several photographs, as a thumb or a mouse does it.

   The rules are in photo-select-core; this is the part that needs a browser:
   how somebody gets into selection at all, and how a press becomes a choice
   rather than an opening.

   Two ways in, because there are two kinds of hands. A long press on a tile,
   which is how every phone gallery has worked since about 2012 and needs no
   teaching; and a button, which is how a mouse does it and is also the only
   part of this that is discoverable by looking. Once in, a tap toggles, a
   shift-click takes a range, and Escape gets out.

   And a sweep: the finger that pressed a tile, still down, moves across the
   tiles beside it, and each one it crosses follows the first — chosen if the
   first became chosen, let go if it was let go. The tiles let the page have
   up and down (touch-action: pan-y), so a sweep is sideways or slantwise,
   and a straight pull is still a scroll. */

/** How long a press has to last to mean "these ones" rather than "this one". */
const PRESS_MS = 450
/** How far a thumb may wander in that time and still be a press, not a scroll. */
const WOBBLE = 10
/** How long after a hold or a sweep its own click is still on its way. */
const CLICK_AFTER_MS = 600

/** The tile under a point on the screen, by the id the grid writes on it. */
const tileAt = (x: number, y: number): Id | null =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-photo-id]')?.dataset.photoId ?? null

export interface PhotoSelection {
  on: boolean
  chosen: ReadonlySet<Id>
  count: number
  /** The chosen photographs, in the order the gallery reads them. */
  photos: TripPhoto[]
  begin: (id?: Id) => void
  end: () => void
  /** A tap or click on a tile. Returns false if the gallery should open it. */
  press: (id: Id, how: PressKind) => boolean
  /** A whole group, from its heading. */
  pressGroup: (ids: readonly Id[]) => void
  all: () => void
  /** Props for a tile, giving it the long press that starts a selection. */
  holdProps: (id: Id) => {
    onPointerDown: (event: React.PointerEvent) => void
    onPointerMove: (event: React.PointerEvent) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onContextMenu: (event: React.MouseEvent) => void
  }
}

/** A plain tap, a shift-click reaching for a range, or a cmd-click adding one. */
export type PressKind = 'tap' | 'range' | 'add'

export default function usePhotoSelection(reading: TripPhoto[]): PhotoSelection {
  const [selection, setSelection] = useState<Selection>(NOTHING)
  const [on, setOn] = useState(false)
  /* Set by a long press or a sweep, read by the click either is about to
     cause. A deadline rather than a flag: a sweep that ends off any tile
     sends no click at all, and a flag left set would have eaten the next
     honest tap. */
  const swallowUntil = useRef(0)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const onRef = useRef(on)
  onRef.current = on

  const order = useMemo(() => reading.map(photo => photo.id), [reading])
  const orderRef = useRef(order)
  orderRef.current = order

  /* A photograph deleted, a filter applied, a page replaced. Anything no
     longer on the screen leaves the selection with it — a count that does not
     match what is visible is a bulk move nobody agreed to. */
  useEffect(() => {
    setSelection(current => prunedTo(current, order))
  }, [order])

  const begin = useCallback((id?: Id) => {
    setOn(true)
    /* An id, or nothing. Passed straight to an onClick this would be handed
       React's event, and an event in a set of chosen photographs is a count
       that is one too high and a move that names something that is not a
       picture. */
    if (typeof id === 'string' && id) setSelection(current => toggleOne(current, id))
  }, [])

  const end = useCallback(() => {
    setOn(false)
    setSelection(NOTHING)
  }, [])

  /* Escape is the way out of every other mode in this app, so it is the way
     out of this one. */
  useEffect(() => {
    if (!on) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        /* Claimed, so the trip's Escape ladder behind this does not also step
           back — closing this and the screen under it on one keypress. */
        event.preventDefault()
        end()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [on, end])

  const press = useCallback(
    (id: Id, how: PressKind) => {
      /* The click that follows the long press that started all this. Without
         swallowing it the picture is chosen by the hold and unchosen by the
         tap a millisecond later, and a long press appears to do nothing. */
      if (Date.now() < swallowUntil.current) {
        swallowUntil.current = 0
        return true
      }
      /* A shift- or cmd-click on a desktop starts a selection without any
         mode at all, which is what anybody who has used a file manager
         expects. A plain click outside selection opens the picture. */
      if (how === 'tap' && !on) return false
      setOn(true)
      setSelection(current =>
        how === 'range' ? extendTo(current, id, orderRef.current) : toggleOne(current, id),
      )
      return true
    },
    [on],
  )

  const pressGroup = useCallback((ids: readonly Id[]) => {
    setOn(true)
    setSelection(current => toggleMany(current, ids))
  }, [])

  const all = useCallback(() => {
    setOn(true)
    setSelection(current => {
      const order = orderRef.current
      /* Everything, or nothing if it was already everything — one button that
         does both, because the moment after "select all" is often "no, not
         like that". */
      return current.ids.size >= order.length ? NOTHING : toggleMany(NOTHING, order)
    })
  }, [])

  /* The long press. A pointer that moves is a scroll and a pointer that lifts
     early is a tap, so both cancel it; what is left is somebody holding still
     on one picture, which means one thing and nothing else. */
  const held = useRef<{
    timer: ReturnType<typeof setTimeout> | null
    x: number
    y: number
    id: Id
    pointerId: number
    target: Element
  } | null>(null)
  /* A sweep in progress: which way it sets the tiles, and the ones it has
     crossed, so a finger wobbling over the same tile does not flip it. */
  const sweep = useRef<{ choose: boolean; seen: Set<Id> } | null>(null)
  const clearHold = useCallback(() => {
    if (held.current?.timer) clearTimeout(held.current.timer)
    held.current = null
    sweep.current = null
  }, [])
  useEffect(() => clearHold, [clearHold])

  /* From this tile, the way its own state decides: pressed while chosen, the
     sweep lets go; pressed while not, it chooses. The tile itself is first. */
  const startSweep = useCallback((id: Id, pointerId: number, target: Element) => {
    const choose = !selectionRef.current.ids.has(id)
    sweep.current = { choose, seen: new Set([id]) }
    setOn(true)
    setSelection(current => setChosen(current, [id], choose))
    swallowUntil.current = Date.now() + CLICK_AFTER_MS
    try {
      target.setPointerCapture?.(pointerId)
    } catch {
      /* a pointer already gone is nothing to capture */
    }
  }, [])

  const holdProps = useCallback(
    (id: Id) => ({
      onPointerDown: (event: React.PointerEvent) => {
        clearHold()
        /* A mouse has a button and a keyboard for this. Holding one still is
           how somebody reads a caption, not how they select. */
        if (event.pointerType === 'mouse') return
        const { clientX: x, clientY: y, pointerId, currentTarget: target } = event
        held.current = {
          x,
          y,
          id,
          pointerId,
          target,
          timer: setTimeout(() => {
            if (held.current) held.current.timer = null
            /* The hold chooses this one and opens the sweep from it, so a
               finger that then moves takes the next ones too. */
            startSweep(id, pointerId, target)
            /* The phone says it happened. Without it a long press is half a
               second of nothing followed by a screen that changed by itself. */
            navigator.vibrate?.(8)
          }, PRESS_MS),
        }
      },
      onPointerMove: (event: React.PointerEvent) => {
        const start = held.current
        if (!start) return
        if (!sweep.current) {
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= WOBBLE) return
          /* Moved before the hold matured: while choosing, a finger drawn
             across the tiles is a sweep from the one it pressed; otherwise
             it is a scroll, and the press is forgotten. */
          if (start.timer) clearTimeout(start.timer)
          start.timer = null
          if (!onRef.current) {
            clearHold()
            return
          }
          startSweep(start.id, start.pointerId, start.target)
        }
        /* The tile under the finger now — this same move, when it is the
           one that began the sweep, since the finger is already past the
           tile it pressed. */
        const under = tileAt(event.clientX, event.clientY)
        const going = sweep.current
        if (going && under && !going.seen.has(under)) {
          going.seen.add(under)
          setSelection(current => setChosen(current, [under], going.choose))
        }
      },
      onPointerUp: clearHold,
      onPointerCancel: clearHold,
      /* A right-click is the mouse's long press, and on Android the browser
         raises it for a real one — where it would otherwise put its own menu
         over the selection that just started. */
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault()
        begin(id)
      },
    }),
    [begin, clearHold, startSweep],
  )

  const photos = useMemo(() => {
    const chosen = new Set(chosenInOrder(selection, order))
    return reading.filter(photo => chosen.has(photo.id))
  }, [selection, order, reading])

  return {
    on,
    chosen: selection.ids,
    count: selection.ids.size,
    photos,
    begin,
    end,
    press,
    pressGroup,
    all,
    holdProps,
  }
}
