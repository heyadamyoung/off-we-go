import Icon from '../../../shared/ui/icon'

/* The floors of the terminal, top floor at the top, the way a lift button
   panel reads. It anchors where the detail card does — just under the top bar
   — but on the right, clear of the card, the panel and the map controls. */
export default function LevelPicker({
  levels,
  level,
  loading,
  onLevel,
  onClose,
}: {
  levels: number[]
  level: number
  loading: boolean
  onLevel: (level: number) => void
  onClose: () => void
}) {
  return (
    <div
      className="glass absolute right-4 top-[calc(var(--trip-top)+14px)] z-[6] flex w-11
                    flex-col overflow-hidden rounded-xl">
      <button
        className="grid h-9 place-items-center border-b border-line text-muted
                         hover:bg-raised2 hover:text-ink"
        title="Close the terminal map"
        aria-label="Close the terminal map"
        onClick={onClose}>
        <Icon n="x" s={13} />
      </button>
      {loading && (
        <div
          className="grid h-9 animate-pulse place-items-center text-muted"
          title="Loading the terminal map">
          <Icon n="clock" s={14} />
        </div>
      )}
      {[...levels]
        .sort((a, b) => b - a)
        .map(value => (
          <button
            key={value}
            className={
              'h-9 border-b border-line text-xs font-bold last:border-b-0 ' +
              (value === level
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:bg-raised2 hover:text-ink')
            }
            title={'Floor ' + value}
            onClick={() => onLevel(value)}>
            {value}
          </button>
        ))}
    </div>
  )
}
