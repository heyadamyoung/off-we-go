import { useCallback, useLayoutEffect, useState } from 'react'

export interface GridBox {
  /** The grid's content width: what a row of cells actually has to fill. */
  width: number
  /** How far the grid's own first row has gone past the top of the view. */
  scrolled: number
  viewportHeight: number
}

/* The measuring half of a windowed grid, and the only part that needs a layout
   engine. Both grids lean on it — the uniform one and the grouped one — and
   neither of them should have to know how to find a scroller.

   Kept apart from the arithmetic on purpose: what is hard to get right here is
   which element scrolls and which box is being measured, and what is hard to
   get right there is the slice. Testing them together would mean testing
   neither. */
export default function useGridBox() {
  /* A callback ref rather than a ref object, because the grid is only in the
     document once there is something to put in it. A layout effect reading
     `ref.current` would find nothing on the first paint of an empty trip and,
     having no dependency to change, would never look again. */
  const [grid, setGrid] = useState<HTMLDivElement | null>(null)
  const ref = useCallback((node: HTMLDivElement | null) => setGrid(node), [])
  const [box, setBox] = useState<GridBox>({ width: 0, scrolled: 0, viewportHeight: 0 })

  useLayoutEffect(() => {
    if (!grid) return

    /* The nearest ancestor that actually scrolls. Listening to the window
       instead would miss it entirely: this grid lives inside a panel with its
       own overflow, and the page behind it never moves. */
    let scroller: HTMLElement | null = grid.parentElement
    while (scroller && scroller !== document.body) {
      const overflow = getComputedStyle(scroller).overflowY
      if (overflow === 'auto' || overflow === 'scroll') break
      scroller = scroller.parentElement
    }
    const view = scroller && scroller !== document.body ? scroller : null

    const measure = () => {
      /* The content box, not the border box. clientWidth includes the grid's
         own padding, and a cell computed from the padded width is a row eight
         pixels taller than the one the browser lays out — over a few thousand
         rows that is a scrollbar claiming a trip is a third longer than it is,
         and a window that slides faster than the photographs under it. */
      const pad = getComputedStyle(grid)
      const sides = Number.parseFloat(pad.paddingLeft) + Number.parseFloat(pad.paddingRight)
      const above = Number.parseFloat(pad.paddingTop) || 0
      const gridTop = grid.getBoundingClientRect().top + above
      const viewTop = view ? view.getBoundingClientRect().top : 0
      setBox(current => {
        const next = {
          width: Math.max(0, grid.clientWidth - (Number.isFinite(sides) ? sides : 0)),
          scrolled: Math.max(0, viewTop - gridTop),
          viewportHeight: view ? view.clientHeight : window.innerHeight,
        }
        /* Only when something moved. The spacers keep the grid's height
           constant as the window slides, so a resize observation that changed
           nothing must not become another render. */
        return current.width === next.width &&
          current.scrolled === next.scrolled &&
          current.viewportHeight === next.viewportHeight
          ? current
          : next
      })
    }

    measure()
    const target: HTMLElement | Window = view || window
    target.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(grid)
    if (view) observer?.observe(view)
    window.addEventListener('resize', measure)
    return () => {
      target.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [grid])

  return { ref, box }
}
