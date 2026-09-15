import { useRef } from 'react'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import useZoomGestures from '../model/use-zoom-gestures'
import type { TripPhoto } from '../../../shared/model/types'

/* The photograph, and nothing else at all.
 *
 * The viewer around this is a good place to read a trip — caption, comments,
 * where it was taken — and a poor place to LOOK at a photograph, because all
 * of that is competing with it for a phone screen. So a tap on the picture
 * brings it here, where the chrome is one button and the picture has the rest.
 *
 * Everything a thumb expects works: pinch to zoom, drag to move around once
 * zoomed, double tap to go in and out, swipe to the next photograph while
 * there is nothing to pan. Which of those a gesture was is use-zoom-gestures';
 * this draws the answer.
 */
export default function PhotoZoom({
  list,
  index,
  setIndex,
  onClose,
}: {
  list: TripPhoto[]
  index: number
  setIndex: (index: number) => void
  onClose: () => void
}) {
  const stage = useRef<HTMLDivElement | null>(null)
  const photo = list[index]
  const gestures = useZoomGestures({
    photoId: photo?.id ?? '',
    index,
    length: list.length,
    setIndex,
    stage,
    onClose,
  })
  const { view } = gestures

  if (!photo) return null

  return (
    <div className="vzoom" role="dialog" aria-modal="true" aria-label={photo.caption || 'Photo'}>
      <div className="vzstage" ref={stage} {...gestures.handlers}>
        {/* The strip, the same one the viewer behind this has: the picture
            before, the one being looked at, and the one after, side by side,
            with the track carrying all three. Under the finger the next one
            comes in at the edge; let go and it carries on in one movement.

            Nothing is swapped and nothing reloads — the photograph arriving
            has been on the screen the whole time, just past the edge of it —
            and each pane is keyed by a slot that never wraps, so a turn moves
            the panes rather than rebuilding them. */}
        <div
          className="vztrack"
          style={{
            transform: `translate3d(${gestures.shift}, 0, 0)`,
            transition: gestures.easing
              ? `transform ${gestures.ms}ms cubic-bezier(.22,.61,.36,1)`
              : 'none',
          }}
          onTransitionEnd={gestures.onTransitionEnd}>
          {gestures.slots.map(at => {
            const shown = list[gestures.at(at)]
            const middle = at === gestures.slot
            if (!shown) return null
            return (
              <div
                key={at}
                className={middle ? 'vzpane on' : 'vzpane'}
                style={{ transform: `translate3d(${(at - gestures.slot) * 100}%, 0, 0)` }}
                aria-hidden={middle ? undefined : true}>
                <Img
                  className="vzimg"
                  item={shown}
                  w={2400}
                  h={1800}
                  alt={middle ? shown.caption : ''}
                  eager
                  style={
                    middle
                      ? {
                          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
                          /* Only while a finger is off the glass: easing a
                             pinch makes the picture lag the fingers, which
                             reads as the phone struggling. */
                          transition: gestures.touched ? 'none' : 'transform .18s ease-out',
                        }
                      : undefined
                  }
                />
              </div>
            )
          })}
        </div>
      </div>
      <button className="vzclose" onClick={onClose} title="Close" aria-label="Close">
        <Icon n="x" s={18} c="#fff" w={2} />
      </button>
      {view.scale > 1.01 && (
        <button className="vzreset" onClick={gestures.reset}>
          Fit
        </button>
      )}
    </div>
  )
}
