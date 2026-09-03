import Icon from '../../../shared/ui/icon'
import LevelPicker from './level-picker'
import type { AirportIndoor } from '../model/use-airport-indoor'

/* Everything terminal-map mode puts on screen besides the map itself: the
   floor picker, a one-line invitation to click a gate, and — once one is
   clicked — the walk: gate, distance, and where to change floors. */
export default function IndoorChrome({ indoor }: { indoor: AirportIndoor }) {
  const capsule =
    'glass absolute left-1/2 top-[calc(var(--trip-top)+14px)] z-[6] flex ' +
    'max-w-[calc(100%-7rem)] -translate-x-1/2 items-center gap-3 whitespace-nowrap ' +
    'overflow-hidden rounded-full text-[13px]'
  return (
    <>
      <LevelPicker
        levels={indoor.levels}
        level={indoor.level}
        loading={indoor.loading}
        onLevel={indoor.setLevel}
        onClose={indoor.closeAll}
      />
      {indoor.target && indoor.routeText ? (
        <div className={capsule + ' py-2 pl-4 pr-2'}>
          <Icon n="walk" s={14} />
          <b className="font-bold">Gate {indoor.target.ref}</b>
          <span className="truncate text-muted">{indoor.routeText}</span>
          <button
            className="rounded-full bg-raised2 px-3 py-1.5 text-xs font-bold"
            onClick={indoor.clearRoute}>
            Clear
          </button>
        </div>
      ) : !indoor.loading && indoor.hasGates ? (
        <div className={capsule + ' px-4 py-2 text-muted'}>
          <Icon n="walk" s={14} />
          Click a gate for walking directions
        </div>
      ) : null}
    </>
  )
}
