import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Brandmark } from '../../../shared/ui/brand'
import Icon from '../../../shared/ui/icon'
import type { TripView } from '../../../trip-search-core'

export const VIEWS: Array<[TripView, string, string]> = [
  ['map', 'Map', 'map'],
  ['timeline', 'Timeline', 'list'],
  ['photos', 'Photos', 'grid'],
  ['sights', 'Sights nearby', 'star'],
  ['people', 'People', 'people'],
]

/* The mark sits beside the title block rather than above it: stacked, it had to
   shrink to the height of a line of small caps, which is exactly the size at
   which this particular drawing stops being readable. On a phone the mark keeps
   the branding but the trip name is what the screen is about, so the small caps
   and the subtitle go and a long name truncates instead of running under the
   account menu. */
export const TripTitle = memo(function TripTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
      <Brandmark size={62} className="max-sm:h-10 max-sm:w-auto" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-[11px] font-bold uppercase tracking-[.16em] text-faint max-sm:hidden">
          Off We Go
        </div>
        <h1 className="m-0 truncate text-[34px] font-extrabold leading-tight tracking-[-.02em]
                       max-sm:text-[19px]">{title}</h1>
        <div className="truncate text-sm text-muted max-sm:hidden">{sub}</div>
      </div>
    </header>
  )
})

interface ClusterProps {
  view: TripView
  onView: (view: TripView) => void
  canEdit: boolean
  editing: boolean
  placing: boolean
  following: boolean
  theme: string
  attractions: boolean
  onAttractions: () => void
  onSettings: () => void
  onPlace: () => void
  onFollow: () => void
  onAdd: () => void
  onTheme: () => void
  onEdit: () => void
}

export const TripCluster = memo(function TripCluster(props: ClusterProps) {
  const night = props.theme !== 'light'
  const actions: Array<[string, string, string, boolean, () => void]> = [
    ['settings', 'Trip settings', 'cog', false, props.onSettings],
    ['pin', 'Place a pin', 'pinplus', props.placing, props.onPlace],
    ['attractions', props.attractions ? 'Hide attractions' : 'Show attractions', 'museum',
      props.attractions, props.onAttractions],
    ['live', 'Follow live position', 'locate', props.following, props.onFollow],
    ['add', 'Add photos', 'camera', false, props.onAdd],
    ['theme', night ? 'Day map' : 'Night map', night ? 'sun' : 'moon', false, props.onTheme],
  ]
  if (props.canEdit) {
    actions.unshift(['edit', props.editing ? 'Done editing' : 'Edit the itinerary', 'pencil',
      props.editing, props.onEdit])
  }
  const { strip, more, measure } = useScrollEdges()
  // The edit button appears and disappears with the trip's permissions, which
  // changes how much there is to scroll.
  useEffect(measure, [measure, actions.length])
  /* A dozen buttons do not fit across a phone, and dropping any of them takes a
     capability off the small screen entirely — so the strip scrolls, views
     first because they are the ones people reach for. A button sliced in half
     at the edge reads as a bug rather than an invitation, so the side with more
     on it fades out under a chevron, and the fade follows the scroll: both
     edges mid-strip, neither once there is nothing further that way. */
  return (
    <div className="glass relative flex min-w-0 items-center rounded-xl p-1
                    max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none
                    max-sm:backdrop-blur-none">
      <div ref={strip} className="flex min-w-0 items-center gap-0.5 max-sm:overflow-x-auto
                      max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
        {VIEWS.map(([key, label, icon]) => (
          <button key={key} data-tip={label} aria-label={label} title={key}
                  className={'tb' + (props.view === key ? ' active' : '')}
                  onClick={() => props.onView(key)}>
            <Icon n={icon} s={18} />
          </button>
        ))}
        <span className="mx-1 h-5 w-px flex-none bg-line2" />
        {actions.map(([key, label, icon, on, run]) => (
          <button key={key} data-tip={label} aria-label={label}
                  className={'tb' + (on ? ' on' : '')} onClick={run}>
            <Icon n={icon} s={18} />
          </button>
        ))}
      </div>
      {more.left && <MoreThisWay side="left" />}
      {more.right && <MoreThisWay side="right" />}
    </div>
  )
})

/* Which way there is more to see, kept in step with the strip rather than
   assumed: the answer changes with the width of the phone, whether the edit
   button is there at all, and where the strip has been scrolled to. */
function useScrollEdges() {
  const strip = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = strip.current
    if (!el) return
    const slack = el.scrollWidth - el.clientWidth
    setMore({
      left: el.scrollLeft > 2,
      right: slack > 2 && el.scrollLeft < slack - 2,
    })
  }, [])

  useEffect(() => {
    const el = strip.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const resize = new ResizeObserver(measure)
    resize.observe(el)
    return () => { el.removeEventListener('scroll', measure); resize.disconnect() }
  }, [measure])

  return { strip, more, measure }
}

/* The button at the edge is what says the strip scrolls, so it is not hidden —
   it is faded into the bar it sits on, under an arrow pointing the way. A
   transparency mask would have dissolved the button against the map instead. */
function MoreThisWay({ side }: { side: 'left' | 'right' }) {
  const left = side === 'left'
  return (
    <span aria-hidden="true"
          className={'pointer-events-none absolute inset-y-0 z-[1] flex w-11 items-center text-muted sm:hidden ' +
            (left
              ? 'left-0 justify-start bg-gradient-to-r from-strong via-strong to-transparent'
              : 'right-0 justify-end bg-gradient-to-l from-strong via-strong to-transparent')}>
      <Icon n={left ? 'chevl' : 'chevron'} s={15} />
    </span>
  )
}

/* The one thing on the screen that is happening right now. Clicking it takes
   the map back to the travellers, wherever the map had wandered to. */
export const NowCapsule = memo(function NowCapsule(
  { text, meta, tone, onClick }: {
    text: string
    meta?: string
    tone: 'waiting' | 'heading' | 'approaching' | 'arrived' | 'complete'
    onClick: () => void
  },
) {
  const dot = tone === 'arrived' || tone === 'complete'
    ? 'bg-trail shadow-[0_0_0_4px_var(--c-accent-soft),0_0_18px_var(--c-glow)]'
    : tone === 'waiting'
      ? 'bg-faint shadow-[0_0_0_4px_var(--c-line)]'
      : `bg-accent shadow-[0_0_0_4px_var(--c-accent-soft),0_0_18px_var(--c-glow)]${
        tone === 'approaching' ? ' animate-pulse' : ''}`
  return (
    <button className="glass absolute bottom-[var(--trip-2)] left-1/2 z-[4] flex max-w-[calc(100%-7.5rem)] sm:max-w-[calc(100%-2rem)]
                       -translate-x-1/2 items-center gap-3.5 overflow-hidden whitespace-nowrap
                       rounded-full py-2.5 pl-4 pr-5 sm:bottom-[var(--trip-1)]"
            aria-label={[text, meta].filter(Boolean).join('. ')} onClick={onClick}>
      <span className={`size-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="flex min-w-0 items-center gap-3.5 max-sm:flex-col max-sm:items-start max-sm:gap-0.5">
        <b className="truncate text-[15px] font-bold" aria-live="polite">{text}</b>
        {meta && <>
          <span className="h-4 w-px shrink-0 bg-line2 max-sm:hidden" />
          <span className="tnum truncate text-[13px] text-muted">{meta}</span>
        </>}
      </span>
    </button>
  )
})

export const ScopeToggle = memo(function ScopeToggle(
  { here, whole, onHere, onWhole, shifted }:
  { here: string; whole: boolean; onHere: () => void; onWhole: () => void; shifted: boolean },
) {
  const button = 'rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-muted'
  return (
    <div className={'glass absolute bottom-[var(--trip-1)] z-[4] flex rounded-full p-1 transition-[left] ' +
      (shifted ? 'left-[492px] max-lg:left-4' : 'left-4')}>
      <button className={button + (whole ? '' : ' bg-ink text-canvas')} onClick={onHere}>{here}</button>
      <button className={button + (whole ? ' bg-ink text-canvas' : '')} onClick={onWhole}>Whole trip</button>
    </div>
  )
})

export const MapControls = memo(function MapControls(
  { following, onFollow, onZoom, onFit }:
  { following: boolean; onFollow: () => void; onZoom: (by: number) => void; onFit: () => void },
) {
  const button = 'wc grid size-10 place-items-center border-b border-line text-ink last:border-b-0 hover:bg-raised2'
  return (
    <div className="wctl glass absolute bottom-[var(--trip-1)] right-4 z-[4] flex flex-col
                    overflow-hidden rounded-xl">
      <button className={button + (following ? ' on bg-accent text-accent-ink' : '')}
              title="Follow the travellers" onClick={onFollow}><Icon n="locate" s={17} /></button>
      <button className={button + ' max-sm:hidden'} title="Zoom in"
              onClick={() => onZoom(1)}><Icon n="plus" s={17} /></button>
      <button className={button + ' max-sm:hidden'} title="Zoom out"
              onClick={() => onZoom(-1)}><Icon n="minus" s={17} /></button>
      <button className={button} title="Fit the whole trip" onClick={onFit}><Icon n="expand" s={16} /></button>
    </div>
  )
})

export const PlaceHint = memo(function PlaceHint(
  { what, onCancel }: { what: string; onCancel: () => void },
) {
  return (
    <div className="glass absolute left-1/2 top-6 z-[8] flex -translate-x-1/2 items-center gap-3
                    whitespace-nowrap rounded-full py-2 pl-4 pr-2 text-[13px]">
      <Icon n="pinplus" s={14} />
      <span className="text-muted">{what} · Esc cancels</span>
      <button className="rounded-full bg-raised2 px-3 py-1.5 text-xs font-bold" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
})

/* What edit mode is for, and the way out of it. Hidden on a narrow screen:
   there is no room for a sentence beside a map that small. */
export function EditHint({ routeDraft, setRouteDraft, saveRoute, searchPlaces, places, setPlaces, route }) {
  return (
    <div className="edithint glass absolute bottom-[var(--trip-1)] left-1/2 z-[8] flex -translate-x-1/2 items-center gap-2.5
                    whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] max-md:hidden">
      <b className="text-[11px] font-extrabold uppercase tracking-[.06em] text-accent">
        {routeDraft ? 'Route' : 'Edit mode'}
      </b>
      {routeDraft ? (
        <>
          <span className="text-muted">
            Click to extend the line · {routeDraft.length} point{routeDraft.length === 1 ? '' : 's'}
          </span>
          <button className="mini" disabled={!routeDraft.length}
                  onClick={() => setRouteDraft(current => current.slice(0, -1))}>Undo</button>
          <button className="mini" onClick={() => setRouteDraft([])}>Clear</button>
          <button className="mini" onClick={() => setRouteDraft(null)}>Cancel</button>
          <button className="mini mini-accent" onClick={saveRoute}>Save route</button>
        </>
      ) : (
        <>
          <span className="text-muted">Click the map to add a stop, or drag a pin to move it.</span>
          <button className="mini" onClick={searchPlaces}>Find places</button>
          {places.length > 0 && (
            <button className="mini" onClick={() => setPlaces([])}>Hide {places.length}</button>
          )}
          <button className="mini" onClick={() => setRouteDraft(route.slice())}>Edit route</button>
        </>
      )}
    </div>
  )
}
