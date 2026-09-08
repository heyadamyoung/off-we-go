/* Which rows of a uniform grid are worth putting in the document.

   A grid that renders every photograph builds one element per photograph, and
   a trip with a few thousand of them is a few thousand buttons and images the
   browser lays out, styles and keeps alive whether or not anybody can see
   them. That is what forced a cap on how many photographs a trip could hold
   in the app at once — a limit invented to work around the grid rather than a
   fact about anything.

   A fixed-size grid is the easy case: every cell is the same height, so which
   rows are on screen is arithmetic rather than measurement. The rows above
   and below become two empty spacers of exactly the right height, so the
   scrollbar is honest and nothing jumps. */

export interface GridWindow {
  /** Index of the first item to render. */
  start: number
  /** Index one past the last item to render. */
  end: number
  /** Pixels of empty space standing in for the rows above. */
  topPad: number
  /** And for the rows below. */
  bottomPad: number
  rows: number
}

export interface GridWindowInput {
  total: number
  columns: number
  /** Height of one row including the gap beneath it. */
  rowHeight: number
  /** How far the scroller has moved past the top of the grid. */
  scrolled: number
  viewportHeight: number
  /* Rows kept beyond each edge. Some overscan is the difference between
     scrolling and watching things appear: a row must exist before it is
     visible or every flick shows a band of empty cells. */
  overscanRows?: number
}

/**
 * The slice of a uniform grid to render, and the space to leave for the rest.
 */
export function gridWindow({
  total,
  columns,
  rowHeight,
  scrolled,
  viewportHeight,
  overscanRows = 3,
}: GridWindowInput): GridWindow {
  const cols = Math.max(1, Math.floor(columns) || 1)
  const rows = Math.ceil(Math.max(0, total) / cols)
  /* Without a measured row height nothing can be placed, so everything is
     rendered rather than nothing: a grid that is briefly heavy beats a grid
     that is briefly empty, and the first measurement is one frame away. */
  if (!(rowHeight > 0) || !(viewportHeight > 0)) {
    return { start: 0, end: total, topPad: 0, bottomPad: 0, rows }
  }

  const firstVisibleRow = Math.floor(Math.max(0, scrolled) / rowHeight)
  const visibleRows = Math.ceil(viewportHeight / rowHeight)
  const firstRow = Math.max(0, firstVisibleRow - overscanRows)
  const lastRow = Math.min(rows, firstVisibleRow + visibleRows + overscanRows)

  const start = firstRow * cols
  const end = Math.min(total, lastRow * cols)
  return {
    start,
    end,
    topPad: firstRow * rowHeight,
    /* Measured from the last rendered row rather than from the total, so the
       two spacers and the rendered rows always add up to the same height —
       the scrollbar must not change size as you move through the grid. */
    bottomPad: Math.max(0, (rows - lastRow) * rowHeight),
    rows,
  }
}

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
