import Icon from '../../../shared/ui/icon'
import LevelPicker from './level-picker'
import type { AirportIndoor } from '../model/use-airport-indoor'

/* Everything terminal-map mode puts on screen besides the map itself: the
   floor picker, and one capsule — the walk on the day of a flight (where
   next, with the board's word on it and the way there), or the gate somebody
   tapped. Nothing that only tells you what to click. */
const STAGE_ICON: Record<string, string> = { bagdrop: 'bag', security: 'shield', gate: 'plane' }

const capsule =
  'glass absolute left-1/2 top-[calc(var(--trip-top)+14px)] z-[6] flex ' +
  'max-w-[calc(100%-7rem)] -translate-x-1/2 items-center gap-2.5 whitespace-nowrap ' +
  'overflow-hidden rounded-full text-xs'

const button = 'rounded-full bg-raised2 px-3 py-1.5 text-xs font-bold'

export default function IndoorChrome({ indoor }: { indoor: AirportIndoor }) {
  const { walk, target, routeText } = indoor
  const stage = walk.stage
  // A tapped gate has the line until it is cleared; the walk's words stay.
  const tapped =
    !!target && (!walk.target || target.lng !== walk.target.lng || target.lat !== walk.target.lat)
  return (
    <>
      {indoor.active && (
        <LevelPicker
          key={indoor.stop?.id}
          levels={indoor.levels}
          level={indoor.level}
          loading={indoor.loading}
          onLevel={indoor.setLevel}
        />
      )}
      {tapped && routeText ? (
        <div className={capsule + ' py-2 pl-4 pr-2'}>
          <Icon n="walk" s={14} />
          <b className="font-bold">Gate {target.ref}</b>
          <span className="truncate text-muted">{routeText}</span>
          <button className={button} onClick={indoor.clearRoute}>
            Clear
          </button>
        </div>
      ) : stage ? (
        <div
          className={capsule + ' walkcap py-1.5 pl-3.5 ' + (walk.last ? 'pr-4' : 'pr-1.5')}
          data-stage={stage.kind}
          data-reached={walk.reached ? 'true' : undefined}
          role="status">
          <Icon n={STAGE_ICON[stage.kind]} s={15} />
          <div className="flex min-w-0 flex-col leading-tight">
            <div className="truncate">
              <b className="font-bold">
                {walk.reached
                  ? `At ${stage.title.replace(/^./, c => c.toLowerCase())}`
                  : stage.title}
              </b>
              {stage.detail && <span className="text-muted"> · {stage.detail}</span>}
            </div>
            {!walk.reached && walk.target && routeText && (
              <span className="truncate text-[11px] text-muted">{routeText}</span>
            )}
          </div>
          {!walk.last && (
            <button className={button} onClick={walk.next}>
              Next
            </button>
          )}
        </div>
      ) : null}
    </>
  )
}
