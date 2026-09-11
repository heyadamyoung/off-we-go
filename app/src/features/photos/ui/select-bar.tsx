import Icon from '../../../shared/ui/icon'

/* What you can do to the photographs you have chosen.

   It appears when something is chosen and not before, which is the whole
   trick: a gallery with a permanent toolbar is a gallery with less gallery in
   it. Anchored to the bottom of the list rather than the top, because that is
   where a thumb already is on the phone this is mostly used from — and the
   count sits at the far end from the actions so a fast tap on "Move" is never
   a slow read of "17".

   It is sticky inside the gallery's own scroller, so it clears the home bar
   without knowing there is one: the sheet around it already carries that
   inset, and adding a second would be a bar floating on nothing. */

interface SelectBarProps {
  count: number
  total: number
  onMove: () => void
  onAll: () => void
  onDone: () => void
  busy?: boolean
}

export default function SelectBar({ count, total, onMove, onAll, onDone, busy }: SelectBarProps) {
  const every = count >= total && total > 0
  return (
    <div className="pointer-events-none sticky bottom-0 z-[3] -mx-4 mt-2 px-4 pb-2 sm:-mx-6 sm:px-6">
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-line
                   bg-strong px-3 py-2.5 shadow-panel backdrop-blur-xl"
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
