/* Choosing several photographs at once.

   Every gallery worth using lets you say "those ones, there" and then do one
   thing to all of them, and every one of them agrees on how: a tap toggles,
   a shift-click takes everything between, and a heading takes its whole
   group. What differs is only how you get into that mood — a long press on a
   phone, a button on a desktop — and that is a question for the component.

   So the arithmetic lives here. It knows about ids and the order they are
   read in, and nothing else: not React, not pointers, not what a photograph
   is. Which means the rules can be argued with in a test rather than by
   tapping at a screen and hoping. */

export type Id = string

export interface Selection {
  /** What is chosen. Never mutated — every function returns a new set. */
  readonly ids: ReadonlySet<Id>
  /** The last thing tapped, which is what a range is measured from. */
  readonly anchor: Id | null
}

export const NOTHING: Selection = { ids: new Set(), anchor: null }

/** Whether anything at all is chosen — the thing components switch on. */
export const anyChosen = (selection: Selection) => selection.ids.size > 0

export const isChosen = (selection: Selection, id: Id) => selection.ids.has(id)

/**
 * One photograph, in or out. It becomes the anchor either way: after tapping
 * something, that is plainly where you are, and a range from anywhere else
 * would be a range from something you have forgotten about.
 */
export function toggleOne(selection: Selection, id: Id): Selection {
  const ids = new Set(selection.ids)
  if (!ids.delete(id)) ids.add(id)
  return { ids, anchor: id }
}

/**
 * Everything from the anchor to here, added to what is already chosen.
 *
 * Additive rather than replacing, because a range is nearly always the second
 * gesture — a tap to start, a shift-click to reach — and somebody who has
 * built a selection out of three separate runs should not lose two of them by
 * reaching for a fourth.
 *
 * With no anchor, or an anchor that is no longer on the screen, this is an
 * ordinary tap. That is what a shift-click on a fresh gallery should do, and
 * it is also the honest answer when the anchor has been filtered away.
 *
 * @param order the ids in the order they are read, top to bottom
 */
export function extendTo(selection: Selection, id: Id, order: readonly Id[]): Selection {
  const from = selection.anchor == null ? -1 : order.indexOf(selection.anchor)
  const to = order.indexOf(id)
  if (from < 0 || to < 0) return toggleOne(selection, id)
  const ids = new Set(selection.ids)
  for (let index = Math.min(from, to); index <= Math.max(from, to); index++) ids.add(order[index])
  /* The anchor stays put, so dragging the far end of a range about keeps
     measuring from where the range started rather than from wherever it
     reached last. */
  return { ids, anchor: selection.anchor }
}

/** How much of a group is chosen — what a heading's checkbox has to draw. */
export function chosenIn(selection: Selection, ids: readonly Id[]): 'none' | 'some' | 'all' {
  if (!ids.length) return 'none'
  let count = 0
  for (const id of ids) if (selection.ids.has(id)) count++
  return count === 0 ? 'none' : count === ids.length ? 'all' : 'some'
}

/**
 * A whole group, in or out. Partly chosen counts as out, so the first tap
 * always completes the group rather than clearing the two you had — which is
 * what every other gallery does, and the only one of the two that is not
 * destructive when you guess wrong.
 */
export function toggleMany(selection: Selection, group: readonly Id[]): Selection {
  const already = chosenIn(selection, group)
  const ids = new Set(selection.ids)
  for (const id of group) {
    if (already === 'all') ids.delete(id)
    else ids.add(id)
  }
  return { ids, anchor: already === 'all' ? null : (group[group.length - 1] ?? selection.anchor) }
}

/**
 * What survives when the gallery changes underneath a selection — a filter
 * applied, a photograph deleted, a page of results arriving.
 *
 * Anything no longer there is dropped. Keeping it would mean a bulk move that
 * quietly touched pictures nobody can see, and a count that does not match
 * what is on the screen.
 */
export function prunedTo(selection: Selection, order: readonly Id[]): Selection {
  const present = new Set(order)
  let dropped = false
  const ids = new Set<Id>()
  for (const id of selection.ids) {
    if (present.has(id)) ids.add(id)
    else dropped = true
  }
  const anchor = selection.anchor && present.has(selection.anchor) ? selection.anchor : null
  if (!dropped && anchor === selection.anchor) return selection
  return { ids, anchor }
}

/** The chosen ids in reading order, which is the order anything acts in. */
export function chosenInOrder(selection: Selection, order: readonly Id[]): Id[] {
  return order.filter(id => selection.ids.has(id))
}
