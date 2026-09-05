import Icon from '../../../shared/ui/icon'
import { coordinateLabel } from '../../../shared/lib/geo'
import type { Coordinates } from '../../../shared/model/types'

/* The map's own ask-about-a-place menu: right-click on a desktop, long-press
   on a phone. A small action sheet rather than a cursor-anchored popover —
   one component serves both inputs, and on the phone it lands where thumbs
   already live. */
export function MapMenu({
  at,
  canEdit,
  canMeasure,
  onAddStop,
  onMeasure,
  onClose,
}: {
  at: Coordinates
  canEdit: boolean
  /** false when there is no live position to measure from */
  canMeasure: boolean
  onAddStop: (at: Coordinates) => void
  onMeasure: (at: Coordinates) => void
  onClose: () => void
}) {
  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm ' +
    'font-semibold hover:bg-raised2'
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is the pointer way out; every action is a real button
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only fences clicks off the scrim */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: as above */}
      <div
        role="menu"
        aria-label="Map actions"
        className="sheet rise absolute inset-x-4 bottom-[calc(var(--trip-1)+8px)] mx-auto
                   max-w-[360px] rounded-2xl p-2 sm:inset-x-auto sm:right-6"
        onClick={event => event.stopPropagation()}>
        <div className="px-3 pb-1.5 pt-1 font-mono text-[10.5px] text-faint">
          {coordinateLabel(at)}
        </div>
        {canEdit && (
          <button
            className={item}
            role="menuitem"
            onClick={() => {
              onClose()
              onAddStop(at)
            }}>
            <Icon n="pinplus" s={15} />
            Add a stop here
          </button>
        )}
        <button
          className={item + (canMeasure ? '' : ' opacity-45')}
          role="menuitem"
          disabled={!canMeasure}
          title={canMeasure ? undefined : 'Needs a live position to measure from'}
          onClick={() => {
            onClose()
            onMeasure(at)
          }}>
          <Icon n="pin" s={15} />
          How far from me
        </button>
        <button className={item + ' text-muted'} role="menuitem" onClick={onClose}>
          <Icon n="x" s={14} />
          Cancel
        </button>
      </div>
    </div>
  )
}

/* The answer to "how far": a floating pill over the map, dismissed by its ✕
   or by asking something else. */
export function MeasurePill({ summary, onClose }: { summary: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="glass absolute left-1/2 top-[calc(var(--trip-top)+12px)] z-[5] flex
                 -translate-x-1/2 items-center gap-2 rounded-full py-1.5 pl-3.5 pr-1.5
                 text-xs font-bold">
      {summary} from you
      <button
        className="grid size-6 place-items-center rounded-full text-muted hover:bg-raised2
                   hover:text-ink"
        onClick={onClose}
        aria-label="Stop measuring">
        <Icon n="x" s={12} />
      </button>
    </div>
  )
}
