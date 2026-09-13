import type { Id } from './shared/model/types'

/* Where the photographs went, after an itinerary edit moved them.

   The server decides which itinerary item a photograph belongs to, and it
   re-decides the whole trip whenever a stop is added, moved or deleted. It has
   done that since it became the authority on filing, and it never told anybody:
   the screen that asked for the edit went on drawing the old filing until the
   entire trip was loaded again. That reads exactly like the re-filing not
   happening, which is what was reported about moving a stop next to some
   photographs.

   So the reply carries what moved, and this applies it. Ids and filings only —
   the client is already holding the photographs, and the one thing it is
   missing is where they went. */

export interface Refiling {
  id: Id
  stopId: Id | null
}

interface Filed {
  id: Id
  stopId?: Id | null
}

/**
 * The photographs with the filings the server just reported written over them.
 *
 * The very same array when there is nothing to apply, or when nothing it
 * mentions is on this screen. Most edits move nothing, and the gallery
 * re-groups, re-measures and re-windows whenever it is handed a different one.
 *
 * A filing for a photograph nobody is holding is dropped rather than turned
 * into a row: it belongs to somebody else's upload, and it will arrive with its
 * own picture attached.
 */
export function applyRefilings<P extends Filed>(
  photos: P[] | null | undefined,
  refiled?: readonly Refiling[] | null,
): P[] {
  const list = photos || []
  if (!refiled?.length || !list.length) return list
  const moved = new Map<Id, Id | null>()
  for (const filing of refiled) {
    if (filing?.id) moved.set(filing.id, filing.stopId ?? null)
  }
  if (!list.some(photo => moved.has(photo.id))) return list
  return list.map(photo =>
    moved.has(photo.id) ? { ...photo, stopId: moved.get(photo.id) ?? null } : photo,
  )
}
