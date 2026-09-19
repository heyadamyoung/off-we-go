import Icon from '../../../shared/ui/icon'

/* A card's title row in the gallery: the chevron that rolls it up, its
   name, how many pictures it holds, the tick that takes all of them while
   choosing, and the rule that takes whatever width is left.

   Drawn twice: once as a row in the grid, where it scrolls with its card,
   and once pinned under the gallery's bar while the card's pictures are
   under it — so the card you are looking at is always named, and can be
   rolled up from where your thumb is rather than from wherever its row
   scrolled off to. A row rather than one button, because the heading rolls
   the card up and the tick beside it takes the whole card — and a button
   inside a button is neither valid nor clickable. */

export interface GroupHeadingProps {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  /** how much of the card is chosen, and the tap that takes all of it; absent outside choosing */
  tick?: { state: 'none' | 'some' | 'all'; onClick: () => void }
  /** pinned under the bar, rather than a row of the grid */
  stuck?: boolean
}

export default function GroupHeading({
  title,
  count,
  collapsed,
  onToggle,
  tick,
  stuck,
}: GroupHeadingProps) {
  return (
    <div
      className={
        (stuck ? 'pgrid-stuck px-4 pb-1.5 pt-1 sm:px-6 ' : 'pb-2 pt-4 ') +
        'group flex w-full items-center gap-2 text-left'
      }
      data-stuck={stuck || undefined}>
      <button
        className={
          (stuck ? 'pgrid-stuckhead' : 'pgrid-head') +
          ' flex min-w-0 shrink items-center gap-2 self-stretch text-left'
        }
        aria-expanded={!collapsed}
        onClick={onToggle}>
        <Icon
          n="chev"
          s={14}
          className={'flex-none text-muted transition-transform ' + (collapsed ? '' : 'rotate-90')}
        />
        <span className="truncate text-[13px] font-bold tracking-[-.01em]">{title}</span>
        <span className="text-[11px] tabular-nums text-muted">{count}</span>
      </button>
      {tick && (
        /* A whole card in one tap, which is the case this feature exists
           for: a stop's worth of pictures filed at the wrong stop, corrected
           in two gestures rather than forty. */
        <GroupTick state={tick.state} title={title} onClick={tick.onClick} />
      )}
      {/* Outside the heading, so the tick sits against the count it belongs
          to rather than being pushed to the far side of a desktop. */}
      <span className="ml-1 h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  )
}

/* How much of a card is chosen, as one tappable mark: filled for all of it,
   a dash for some, an empty ring for none. The dash matters — "some" drawn as
   "none" is a heading that appears to have done nothing when you tapped a
   picture under it. */
function GroupTick({
  state,
  title,
  onClick,
}: {
  state: 'none' | 'some' | 'all'
  title: string
  onClick: () => void
}) {
  return (
    <button
      className="grid size-7 flex-none place-items-center rounded-full hover:bg-raised2"
      onClick={onClick}
      aria-pressed={state === 'all'}
      title={state === 'all' ? `Deselect ${title}` : `Select all of ${title}`}
      aria-label={state === 'all' ? `Deselect ${title}` : `Select all of ${title}`}>
      <span
        className={
          'grid size-5 place-items-center rounded-full border-2 transition-colors ' +
          (state === 'none'
            ? 'border-line2 text-transparent'
            : 'border-accent bg-accent text-accent-ink')
        }>
        <Icon n={state === 'some' ? 'minus' : 'check'} s={11} w={3} />
      </span>
    </button>
  )
}
