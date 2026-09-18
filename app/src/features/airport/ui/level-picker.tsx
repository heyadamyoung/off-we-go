import { useState } from 'react'
import Icon from '../../../shared/ui/icon'

/* The floors of the terminal, folded to the one showing: a square at the top
   right with the floor's number on it and a chevron under the number, which
   opens into the column of floors (top floor at the top, the way a lift
   panel reads) when tapped and folds again once one is chosen. On a phone it
   sits under the capsule's row when there is one, so the two never fight for
   the width; at a desk there is room beside it. A terminal with one floor
   has nothing to choose, and shows nothing. Nothing here closes the
   terminal — the camera does that, by leaving. */
export default function LevelPicker({
  levels,
  level,
  loading,
  onLevel,
  below = false,
}: {
  levels: number[]
  level: number
  loading: boolean
  onLevel: (level: number) => void
  /** a capsule is on the row: on a phone, sit under it */
  below?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box =
    'glass absolute right-4 z-[6] w-11 rounded-xl ' +
    (below
      ? 'max-sm:top-[calc(var(--trip-top)+68px)] sm:top-[calc(var(--trip-top)+14px)]'
      : 'top-[calc(var(--trip-top)+14px)]')
  if (loading) {
    return (
      <div
        className={box + ' grid h-11 animate-pulse place-items-center text-muted'}
        title="Loading the terminal map">
        <Icon n="clock" s={15} />
      </div>
    )
  }
  if (levels.length < 2) return null
  if (!open) {
    return (
      <button
        className={
          box +
          ' flex h-11 flex-col items-center justify-center gap-0.5 leading-none text-ink hover:bg-raised2'
        }
        title="Choose a floor"
        aria-label={`Floor ${level} — choose a floor`}
        aria-expanded={false}
        onClick={() => setOpen(true)}>
        <span className="text-[15px] font-extrabold">{level}</span>
        <Icon n="chevd" s={10} className="text-muted" />
      </button>
    )
  }
  return (
    <div className={box + ' flex flex-col overflow-hidden text-[15px] font-extrabold'}>
      {[...levels]
        .sort((a, b) => b - a)
        .map(value => (
          <button
            key={value}
            className={
              'h-11 border-b border-line last:border-b-0 ' +
              (value === level ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-raised2')
            }
            title={'Floor ' + value}
            aria-label={'Floor ' + value}
            aria-pressed={value === level}
            onClick={() => {
              onLevel(value)
              setOpen(false)
            }}>
            {value}
          </button>
        ))}
    </div>
  )
}
