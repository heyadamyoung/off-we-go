import type { Stop } from '../../../shared/model/types'

/* One past the highest, not the count. After a stop in the middle is deleted
   the count collides with a seq that is still in use, and two stops sharing a
   seq make "move earlier" swap a number for itself — a button that does
   nothing, twice. */
export const nextSeq = (stops: Stop[]) =>
  stops.reduce((highest, stop) => Math.max(highest, stop.seq ?? -1), -1) + 1
