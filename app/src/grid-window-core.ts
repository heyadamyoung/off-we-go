/* How tall a row of a photograph grid is.

   The windowing itself lives in photo-groups-core, which arranges a trip into
   collapsible cards and takes a window over rows of differing heights. This is
   the one piece both it and the layout share: what a square cell comes out as
   once the gaps between the columns are taken out of the width.

   There used to be a second window here, for a grid where every row was the
   same height. The grouped one does that case too — one card, no header — so
   keeping both would have meant two implementations of one decision, only one
   of them reachable. */

/**
 * Row height for a grid of square cells: the cell width plus the gap under it.
 *
 * `containerWidth` is the grid's *content* width. Handing it a padded width
 * makes every row taller than the one the browser lays out, which over a few
 * thousand rows is a scrollbar claiming a trip is longer than it is.
 */
export function squareRowHeight(containerWidth: number, columns: number, gap: number): number {
  const cols = Math.max(1, Math.floor(columns) || 1)
  if (!(containerWidth > 0)) return 0
  const cell = (containerWidth - gap * (cols - 1)) / cols
  return cell > 0 ? cell + gap : 0
}
