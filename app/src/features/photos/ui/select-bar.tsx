import Icon from '../../../shared/ui/icon'

/* What you can do to the photographs you have chosen.

   It appears when something is chosen and not before, which is the whole
   trick: a gallery with a permanent toolbar is a gallery with less gallery in
   it. Anchored to the bottom of the list rather than the top, because that is
   where a thumb already is on the phone this is mostly used from — and the
   count sits at the far end from the actions so a fast tap on "Move" is never
   a slow read of "17".

   On a phone it is pinned to the bottom edge of the screen, over the grid,
   with the home bar's inset under it; at a desk it is sticky inside the
   gallery's own scroller. Sticky on a phone put it at the scroller's
   padding edge, a strip above the bottom with pictures showing under it. */

interface SelectBarProps {
  count: number
  total: number
  onMove: () => void
  /** Absent when nothing here may be deleted. */
  onDelete?: () => void
  onAll: () => void
  onDone: () => void
  busy?: boolean
}

export default function SelectBar({
  count,
  total,
  onMove,
  onDelete,
  onAll,
  onDone,
  busy,
}: SelectBarProps) {
  const every = count >= total && total > 0
  return (
    <div
      className="pointer-events-none z-[3] max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:px-3
                 max-sm:pb-[calc(.5rem+env(safe-area-inset-bottom,0px))]
                 sm:sticky sm:bottom-0 sm:-mx-6 sm:mt-2 sm:px-6 sm:pb-2">
      <div
        /* Capped and centred. Spread across a desktop the count sat at one
           edge and the buttons at the other, a foot apart; on a phone it is
           the full width either way, so this is the same control on both. */
        className="pointer-events-auto mx-auto flex max-w-[520px] items-center gap-2 rounded-2xl
                   border border-line bg-strong px-3 py-2.5 shadow-panel backdrop-blur-xl"
        role="toolbar"
        aria-label="What to do with the chosen photos">
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-bold tabular-nums"
          aria-live="polite">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
        <button className="mini whitespace-nowrap" onClick={onAll} disabled={busy}>
          {every ? 'None' : 'All'}
        </button>
        {onDelete && (
          <button
            className="mini whitespace-nowrap text-danger"
            onClick={onDelete}
            disabled={busy || !count}
            aria-label="Delete the chosen photos">
            Delete
          </button>
        )}
        <button
          className="mini mini-accent inline-flex items-center gap-1 whitespace-nowrap"
          onClick={onMove}
          disabled={busy || !count}>
          <Icon n="move" s={13} />
          {busy ? 'Moving…' : 'Move'}
        </button>
        <button
          className="grid size-8 flex-none place-items-center rounded-full text-muted
                     hover:bg-raised2 hover:text-ink"
          onClick={onDone}
          disabled={busy}
          title="Done selecting"
          aria-label="Done selecting">
          <Icon n="x" s={16} />
        </button>
      </div>
    </div>
  )
}
