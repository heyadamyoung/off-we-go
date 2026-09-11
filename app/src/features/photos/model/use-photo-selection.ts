import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  NOTHING,
  chosenInOrder,
  extendTo,
  prunedTo,
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
   shift-click takes a range, and Escape gets out. */

/** How long a press has to last to mean "these ones" rather than "this one". */
const PRESS_MS = 450
/** How far a thumb may wander in that time and still be a press, not a scroll. */
const WOBBLE = 10

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
  /* Set by a long press, read by the click it is about to cause. */
  const swallow = useRef(false)

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
      if (swallow.current) {
        swallow.current = false
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
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const clearHold = useCallback(() => {
    if (held.current) clearTimeout(held.current.timer)
    held.current = null
  }, [])
  useEffect(() => clearHold, [clearHold])

  const holdProps = useCallback(
    (id: Id) => ({
      onPointerDown: (event: React.PointerEvent) => {
        clearHold()
        /* A mouse has a button and a keyboard for this. Holding one still is
           how somebody reads a caption, not how they select. */
        if (event.pointerType === 'mouse') return
        const { clientX: x, clientY: y } = event
        held.current = {
          x,
          y,
          timer: setTimeout(() => {
            held.current = null
            swallow.current = true
            begin(id)
            /* The phone says it happened. Without it a long press is half a
               second of nothing followed by a screen that changed by itself. */
            navigator.vibrate?.(8)
          }, PRESS_MS),
        }
      },
      onPointerMove: (event: React.PointerEvent) => {
        const start = held.current
        if (!start) return
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > WOBBLE) clearHold()
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
    [begin, clearHold],
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
