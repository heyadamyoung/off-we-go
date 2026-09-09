import { useCallback, useMemo, useState } from 'react'
import { squareRowHeight } from '../../../grid-window-core'
import {
  columnsForWidth,
  groupPhotos,
  layoutGroups,
  windowRows,
  type GroupMode,
  type GroupableStop,
} from '../../../photo-groups-core'
import type { TripPhoto } from '../../../shared/model/types'
import useGridBox from './use-grid-box'

/** How tall a card's title bar is, including the space above it. */
export const HEADER_HEIGHT = 44

/* The photographs of a trip, arranged and then windowed.

   Everything decidable without a layout engine is decided in
   photo-groups-core; this holds the two things that need one — how wide a cell
   is and where the scroller is — and the two things that are somebody's
   choice: which arrangement, and which cards are rolled up. */
export default function usePhotoGroups(
  photos: TripPhoto[],
  stops: GroupableStop[],
  mode: GroupMode,
  gap = 8,
) {
  const { ref, box } = useGridBox()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = useCallback((key: string) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  const groups = useMemo(() => groupPhotos(photos, stops, mode), [photos, stops, mode])

  /* From the room there is, not a constant: this grid is a column on a phone
     and the whole screen on a desktop, and three tiles stretched across a
     desktop is not a gallery. */
  const columns = columnsForWidth(box.width)
  const rowHeight = squareRowHeight(box.width, columns, gap)
  /* Only the by-stop view is a set of cards. Ungrouped is one list, and a
     lone header over the whole trip saying nothing would be furniture. */
  const showHeaders = mode === 'stop'

  const { rows, height } = useMemo(
    () =>
      layoutGroups(groups, {
        columns,
        rowHeight,
        headerHeight: HEADER_HEIGHT,
        collapsed,
        showHeaders,
      }),
    [groups, columns, rowHeight, collapsed, showHeaders],
  )

  const visible = useMemo(
    () => windowRows(rows, height, { scrolled: box.scrolled, viewportHeight: box.viewportHeight }),
    [rows, height, box.scrolled, box.viewportHeight],
  )

  return { ref, columns, groups, rows, height, visible, collapsed, toggle }
}
