import { useCallback, useEffect, useRef, useState } from 'react'
import MediaThumb from '../../../shared/ui/media-thumb'
import { filmScroll, filmWindow } from '../../../film-window-core'
import type { TripPhoto } from '../../../shared/model/types'

/* The strip of thumbnails along the bottom of the viewer: where you are in the
 * trip, and a way to jump.
 *
 * It drew a button and an image for every photograph on the trip — a thousand
 * elements on a trip of five hundred, rebuilt on every page turn, for a row
 * that shows eight. Below 640px the stylesheet hides it outright, which saves
 * the pixels and none of the work: `display: none` is not `do not build`.
 *
 * And it never moved. Paging to the fortieth picture left it showing the first
 * ten with the highlighted one somewhere off the side, so the one control whose
 * whole job is "where am I" was the one thing not answering.
 *
 * Now it draws what is in view and a few either side, holds the rest of the
 * trip's width open at each end so the scrollbar stays honest, and follows the
 * photograph being looked at. The arithmetic is in film-window-core.
 */
export default function PhotoFilm({
  list,
  index,
  setIndex,
}: {
  list: TripPhoto[]
  index: number
  setIndex: (index: number) => void
}) {
  const row = useRef<HTMLDivElement | null>(null)
  const [strip, setStrip] = useState(() => filmWindow(list.length, { keep: index }))

  const read = useCallback(
    (at: number) => {
      const film = row.current
      if (!film) return
      const next = filmWindow(list.length, {
        scroll: film.scrollLeft,
        width: film.clientWidth,
        keep: at,
      })
      setStrip(now => (now.from === next.from && now.to === next.to ? now : next))
    },
    [list.length],
  )

  /* Setting the scroll fires a scroll event, which reads the window back — so
     the two only have to agree here, not be kept in step by hand. */
  useEffect(() => {
    const film = row.current
    if (!film) return
    film.scrollLeft = filmScroll(index, film.clientWidth)
    read(index)
  }, [index, read])

  return (
    <div className="vfilm" ref={row} onScroll={() => read(index)}>
      {strip.before > 0 && (
        <span className="vhold" style={{ width: strip.before }} aria-hidden="true" />
      )}
      {list.slice(strip.from, strip.to).map((photo, nth) => {
        const at = strip.from + nth
        return (
          <button key={photo.id} className={at === index ? 'on' : ''} onClick={() => setIndex(at)}>
            <MediaThumb item={photo} w={300} h={200} badge={20} />
          </button>
        )
      })}
      {strip.after > 0 && (
        <span className="vhold" style={{ width: strip.after }} aria-hidden="true" />
      )}
    </div>
  )
}
