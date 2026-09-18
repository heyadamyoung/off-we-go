import { useState } from 'react'
import Icon from '../../../shared/ui/icon'

/* The floors of the terminal, folded to the one showing: a small pill at the
   top right with the floor's number on it, which opens into the column of
   floors (top floor at the top, the way a lift panel reads) when tapped and
   folds again once one is chosen. A terminal with one floor has nothing to
   choose, and shows nothing. Nothing here closes the terminal — the camera
   does that, by leaving. */
export default function LevelPicker({
  levels,
  level,
  loading,
  onLevel,
}: {
  levels: number[]
  level: number
  loading: boolean
  onLevel: (level: number) => void
}) {
  const [open, setOpen] = useState(false)
  const box = 'glass absolute right-4 top-[calc(var(--trip-top)+14px)] z-[6] w-9 rounded-lg'
  if (loading) {
    return (
      <div
        className={box + ' grid h-8 animate-pulse place-items-center text-muted'}
        title="Loading the terminal map">
        <Icon n="clock" s={13} />
      </div>
    )
  }
  if (levels.length < 2) return null
  if (!open) {
    return (
      <button
        className={box + ' flex h-8 items-center justify-center gap-0.5 text-[11px] font-bold'}
        title="Choose a floor"
        aria-label={`Floor ${level} — choose a floor`}
        aria-expanded={false}
        onClick={() => setOpen(true)}>
        {level}
        <Icon n="chevd" s={10} className="text-muted" />
      </button>
    )
  }
  return (
    <div className={box + ' flex flex-col overflow-hidden text-[11px] font-bold'}>
      {[...levels]
        .sort((a, b) => b - a)
        .map(value => (
          <button
            key={value}
            className={
              'h-8 border-b border-line last:border-b-0 ' +
              (value === level
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:bg-raised2 hover:text-ink')
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
