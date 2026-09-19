import Icon from '../../../shared/ui/icon'
import LevelPicker from './level-picker'
import type { AirportIndoor } from '../model/use-airport-indoor'

/* Everything terminal-map mode puts on screen besides the map itself: the
   floor picker, and one capsule — the walk on the day of a flight (where
   next, with the board's word on it and the way there), or the gate somebody
   tapped. Nothing that only tells you what to click.

   The floor picker and a tapped gate's line follow the camera: zoomed away,
   the walk keeps its floor plan, but a picker for floors nobody can see was
   sitting over the map of the whole continent. The walk's own capsule stays
   wherever the camera is, because "Security · 6 min queue · 320 m walk" is
   what to do next — until the walk has reached its last stage, when it has
   nothing left to say that the pill at the bottom does not, and says
   nothing. */
const STAGE_ICON: Record<string, string> = { bagdrop: 'bag', security: 'shield', gate: 'plane' }

/* The same row as the floor picker and the same height; on a phone the
   whole width less the margins, because the picker sits under it there. */
const capsule =
  'glass absolute left-1/2 top-[calc(var(--trip-top)+14px)] z-[6] flex min-h-11 ' +
  'max-w-[calc(100%-8.5rem)] -translate-x-1/2 items-center gap-2.5 whitespace-nowrap ' +
  'overflow-hidden rounded-full text-xs max-sm:max-w-[calc(100%-2rem)]'

const button = 'rounded-full bg-raised2 px-3 py-1.5 text-xs font-bold'

export default function IndoorChrome({ indoor }: { indoor: AirportIndoor }) {
  const { walk, target, routeText } = indoor
  const stage = walk.stage
  // A tapped gate has the line until it is cleared; the walk's words stay.
  const tapped =
    indoor.inView &&
    !!target &&
    (!walk.target || target.lng !== walk.target.lng || target.lat !== walk.target.lat)
  const finished = !!stage && walk.last && walk.reached
  const capsuleUp = (tapped && !!routeText) || (!!stage && !finished)
  return (
    <>
      {indoor.active && indoor.inView && (
        <LevelPicker
          key={indoor.stop?.id}
          levels={indoor.levels}
          level={indoor.level}
          loading={indoor.loading}
          onLevel={indoor.setLevel}
          below={capsuleUp}
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
      ) : stage && !finished ? (
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
