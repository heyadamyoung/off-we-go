import { memo, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { quietPhones } from '../../../live-freshness-core'
import type { PhoneMarker } from '../../../live-markers-core'
import type { Segment } from '../../../segments-core'
import Icon from '../../../shared/ui/icon'
import type { Attraction, Coordinates, Device } from '../../../shared/model/types'
import { MakeIt } from '../../transport'

/* The advisory storey: the make-it meter and the quiet-phone notices, floated
   in their own layer above the chrome row. Squeezed INTO the phone's one-line
   row they crushed the Now capsule to a bare dot, and pointer-events-none let
   taps on the banner fall through to the sparkle button beneath. Here they
   stack over the map, and the notice eats its own taps. */
export function Advisories({
  segments,
  markers,
  phones,
  now,
  sample,
}: {
  segments: Segment[]
  markers: PhoneMarker[]
  phones: Device[]
  now: number
  sample: boolean
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-[calc(var(--trip-1)+56px)] z-[4]
                 flex flex-col items-center gap-2">
      <MakeIt
        segments={segments}
        travellers={markers
          .filter(marker => !marker.stale)
          .map(marker => ({ name: marker.name, lng: marker.lng, lat: marker.lat }))}
        now={now}
      />
      {/* A phone that went dark without a pause — usually an app update eating
          the background watcher — is named, with the cure. A demo has no phone
          to wait for. */}
      {!sample &&
        quietPhones(phones, new Date(now)).map(phone => (
          <div
            key={phone.id}
            role="status"
            className="glass pointer-events-auto max-w-full rounded-2xl px-3.5 py-1.5 text-[11px]
                       text-muted">
            <b className="text-ink">{phone.name}</b> hasn’t shared for{' '}
            {phone.minutesQuiet >= 90
              ? `${Math.round(phone.minutesQuiet / 60)} h`
              : `${phone.minutesQuiet} min`}{' '}
            — opening Off We Go on that phone restarts sharing
          </div>
        ))}
    </div>
  )
}

/* The brand is the small caps line, not the badge: at header height the
   portal drawing collapsed into an orange blob and outshone the trip's own
   name — the words carry it. On a phone even the small caps go; the trip
   name is what the screen is about, and a long one truncates instead of
   running under the account menu. */
export const TripTitle = memo(function TripTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="font-display text-[11px] font-bold uppercase tracking-[.16em] text-faint max-sm:hidden">
          Off we go<span className="text-accent">.</span>
        </div>
        <h1
          className="font-display m-0 truncate text-[34px] font-extrabold leading-tight tracking-[-.02em]
                       max-sm:text-lg">
          {title}
        </h1>
        <div className="truncate text-sm text-muted max-sm:hidden">{sub}</div>
      </div>
    </header>
  )
})

/* Along the bottom of the map, one line: where the day sits, what is happening
   now, and the map's own controls. On a phone this is a real flex row, so
   nothing floats at its own height over the middle of the map; above 640px
   `contents` dissolves the row and each piece keeps the corner it was placed
   in. */
export function MapChrome({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-3 bottom-[var(--trip-1)] z-[4] flex items-center gap-2 sm:contents">
      {children}
    </div>
  )
}

/* The one thing on the screen that is happening right now. Clicking it takes
   the map back to the travellers, wherever the map had wandered to. */
export const NowCapsule = memo(function NowCapsule({
  text,
  meta,
  tone,
  onClick,
}: {
  text: string
  meta?: string
  tone: 'waiting' | 'heading' | 'approaching' | 'arrived' | 'complete'
  onClick: () => void
}) {
  const dot =
    tone === 'arrived' || tone === 'complete'
      ? 'bg-accent-bright shadow-[0_0_0_4px_var(--c-accent-soft),0_0_18px_var(--c-glow)]'
      : tone === 'waiting'
        ? 'bg-faint shadow-[0_0_0_4px_var(--c-line)]'
        : `bg-accent shadow-[0_0_0_4px_var(--c-accent-soft),0_0_18px_var(--c-glow)]${
            tone === 'approaching' ? ' animate-pulse' : ''
          }`
  return (
    <button
      className="glass absolute bottom-[var(--trip-1)] left-1/2 z-[4] flex
                       max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 overflow-hidden
                       whitespace-nowrap rounded-full py-2.5 pl-4 pr-5
                       max-sm:static max-sm:min-w-0 max-sm:flex-1 max-sm:translate-x-0
                       max-sm:gap-2 max-sm:py-2 max-sm:pl-3 max-sm:pr-3.5"
      aria-label={[text, meta].filter(Boolean).join('. ')}
      onClick={onClick}>
      <span className={`size-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="flex min-w-0 items-center gap-3">
        <b className="truncate text-base font-bold max-sm:text-xs" aria-live="polite">
          {text}
        </b>
        {meta && (
          <>
            <span className="h-4 w-px shrink-0 bg-line2 max-sm:hidden" />
            <span className="tnum truncate text-xs text-muted max-sm:hidden">{meta}</span>
          </>
        )}
      </span>
    </button>
  )
})

export const ScopeToggle = memo(function ScopeToggle({
  here,
  whole,
  onHere,
  onWhole,
  shifted,
}: {
  here: string
  whole: boolean
  onHere: () => void
  onWhole: () => void
  shifted: boolean
}) {
  const button = 'rounded-full px-3.5 py-1.5 text-xs font-bold text-muted'
  return (
    /* Hidden on a phone: the day chips an inch below are the same control with
       more of the trip in them, and the status beside it needs the room. */
    <div
      className={
        'glass absolute bottom-[var(--trip-1)] z-[4] flex flex-none rounded-full p-1 ' +
        'transition-[left] max-sm:hidden ' +
        (shifted ? 'left-[492px] max-lg:left-4' : 'left-4')
      }>
      <button className={button + (whole ? '' : ' bg-ink text-canvas')} onClick={onHere}>
        {here}
      </button>
      <button className={button + (whole ? ' bg-ink text-canvas' : '')} onClick={onWhole}>
        Whole trip
      </button>
    </div>
  )
})

export const MapControls = memo(function MapControls({
  following,
  onFollow,
  onZoom,
  onFit,
}: {
  following: boolean
  onFollow: () => void
  onZoom: (by: number) => void
  onFit: () => void
}) {
  /* 44px on a phone, the platform's touch floor — a hit-slop shadow would be
     clipped by the pill's own overflow, so the buttons are simply that size. */
  const button =
    'wc grid size-10 place-items-center border-b border-line text-ink last:border-b-0 ' +
    'hover:bg-raised2 max-sm:size-11 max-sm:border-b-0 max-sm:border-r max-sm:last:border-r-0'
  return (
    <div
      className="wctl glass absolute bottom-[var(--trip-1)] right-4 z-[4] flex flex-col
                    overflow-hidden rounded-xl
                    max-sm:static max-sm:flex-none max-sm:flex-row max-sm:rounded-full">
      <button
        className={button + (following ? ' on bg-accent text-accent-ink' : '')}
        title="Follow the travellers"
        onClick={onFollow}>
        <Icon n="locate" s={17} />
      </button>
      <button className={button + ' max-sm:hidden'} title="Zoom in" onClick={() => onZoom(1)}>
        <Icon n="plus" s={17} />
      </button>
      <button className={button + ' max-sm:hidden'} title="Zoom out" onClick={() => onZoom(-1)}>
        <Icon n="minus" s={17} />
      </button>
      <button className={button} title="Fit the whole trip" onClick={onFit}>
        <Icon n="expand" s={16} />
      </button>
    </div>
  )
})

export const PlaceHint = memo(function PlaceHint({
  what,
  onCancel,
}: {
  what: string
  onCancel: () => void
}) {
  return (
    <div
      className="glass absolute left-1/2 top-6 z-[8] flex -translate-x-1/2 items-center gap-3
                    whitespace-nowrap rounded-full py-2 pl-4 pr-2 text-xs">
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
export function EditHint({
  routeDraft,
  setRouteDraft,
  saveRoute,
  searchPlaces,
  places,
  setPlaces,
  route,
}: {
  routeDraft: Coordinates[] | null
  setRouteDraft: Dispatch<SetStateAction<Coordinates[] | null>>
  saveRoute: () => void
  searchPlaces: () => void
  places: Attraction[]
  setPlaces: (places: Attraction[]) => void
  route: Coordinates[]
}) {
  return (
    <div
      className="edithint glass absolute bottom-[var(--trip-1)] left-1/2 z-[8] flex -translate-x-1/2 items-center gap-2
                    whitespace-nowrap rounded-full px-4 py-2 text-xs max-md:hidden">
      <b className="text-[11px] font-extrabold uppercase tracking-[.06em] text-accent">
        {routeDraft ? 'Route' : 'Edit mode'}
      </b>
      {routeDraft ? (
        <>
          <span className="text-muted">
            Click to extend the line · {routeDraft.length} point{routeDraft.length === 1 ? '' : 's'}
          </span>
          <button
            className="mini"
            disabled={!routeDraft.length}
            onClick={() => setRouteDraft(current => (current || []).slice(0, -1))}>
            Undo
          </button>
          <button className="mini" onClick={() => setRouteDraft([])}>
            Clear
          </button>
          <button className="mini" onClick={() => setRouteDraft(null)}>
            Cancel
          </button>
          <button className="mini mini-accent" onClick={saveRoute}>
            Save route
          </button>
        </>
      ) : (
        <>
          <span className="text-muted">Click the map to add a stop, or drag a pin to move it.</span>
          <button className="mini" onClick={searchPlaces}>
            Find places
          </button>
          {places.length > 0 && (
            <button className="mini" onClick={() => setPlaces([])}>
              Hide {places.length}
            </button>
          )}
          <button className="mini" onClick={() => setRouteDraft(route.slice())}>
            Edit route
          </button>
        </>
      )}
    </div>
  )
}
