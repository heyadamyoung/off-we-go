import { useEffect, useMemo, useRef, useState } from 'react'
import { dayLabelOf } from '../../../day-label-core'
import {
  allPinned,
  canDecideByLocation,
  placeChoices,
  roughly,
  type PlaceChoice,
} from '../../../place-choices-core'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import type { Stop, TripPhoto } from '../../../shared/model/types'

/* Where do these belong?

   A dropdown would have taken an hour and been useless: twenty rows of bare
   names, no idea which is the one in the photograph. So it is a list of the
   trip — the day, a picture already filed there to recognise it by, how much
   is there, and how far it is from wherever these ones were taken.

   A bottom sheet on a phone, because that is where a thumb is, and a centred
   dialog on anything with a mouse. One component: the difference is where it
   is anchored and which corners are round, and having two would be two places
   to fix the next thing.

   The arithmetic is in place-choices-core. This draws it. */

export interface Filing {
  stopId?: string | null
  stopPinned?: boolean
}

interface PlacePickerProps {
  stops: Stop[]
  /** Every photograph on the trip, for the counts and the faces. */
  photos: TripPhoto[]
  /** The ones being filed. */
  moving: TripPhoto[]
  onPick: (filing: Filing) => void
  onClose: () => void
  busy?: boolean
}

/** Above this many stops, scanning beats scrolling and a search box earns its row. */
const WORTH_SEARCHING = 6

export default function PlacePicker({
  stops,
  photos,
  moving,
  onPick,
  onClose,
  busy,
}: PlacePickerProps) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)

  /* A mouse can start typing straight away; a thumb cannot, because the
     keyboard that would open covers the list it was opened to search. */
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) search.current?.focus()
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        /* Claimed, so the trip's Escape ladder behind this does not also step
           back — closing this and the screen under it on one keypress. */
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  const choices = useMemo(
    () => placeChoices(stops, photos, moving, query),
    [stops, photos, moving, query],
  )
  const byLocation = canDecideByLocation(moving)
  const pinned = allPinned(moving)
  const count = moving.length
  const searchable = stops.length > WORTH_SEARCHING

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is the pointer way out; Escape is wired on window above
    // biome-ignore lint/a11y/useKeyWithClickEvents: the scrim is the pointer way out; Escape is wired on window above
    <div
      /* On a phone this sits on the bottom edge and the sheet carries the home
         bar itself, which is what a bottom sheet is; on anything wider it is
         centred and the padding carries the bezel on every side. The keyboard
         lifts it either way, or the search box it opened for would be under
         the thing that opened it. */
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60
                 backdrop-blur-[6px] sm:items-center
                 pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]
                 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[var(--keyboard,0px)]
                 sm:px-5 sm:pb-[calc(1.25rem+var(--keyboard,0px)+env(safe-area-inset-bottom,0px))]"
      onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only fences clicks off the scrim; it is not an interaction */}
      <div
        className="modal rise flex max-h-full w-full max-w-[520px] flex-col overflow-hidden
                   rounded-t-2xl border border-b-0 border-line bg-solid shadow-panel
                   sm:max-h-[min(100%,640px)] sm:rounded-2xl sm:border-b"
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${count} ${count === 1 ? 'item' : 'items'}`}
        onClick={event => event.stopPropagation()}>
        {/* The grab handle a phone expects on the top edge of a sheet. It is
            not a control — the scrim and Escape are the ways out — so it says
            nothing to a screen reader. */}
        <div className="grid flex-none place-items-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-line" />
        </div>

        <div className="flex flex-none items-center gap-3 px-[18px] pb-3 pt-3.5 sm:pt-4">
          <Stack photos={moving} />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[17px] font-extrabold tracking-[-.01em]">
              Move {count} {count === 1 ? 'item' : 'items'}
            </b>
            <span className="text-[11px] text-muted">
              {pinned ? 'Filed by hand' : 'Filed by where they were taken'}
            </span>
          </div>
          <button
            className="grid size-8 flex-none place-items-center rounded-lg text-muted
                       hover:bg-raised2 hover:text-ink"
            onClick={onClose}
            aria-label="Close">
            <Icon n="x" s={16} />
          </button>
        </div>

        {searchable && (
          <label className="field relative flex-none px-[18px] pb-2">
            <Icon
              n="search"
              s={14}
              className="pointer-events-none absolute left-[30px] top-1/2 z-[1] -translate-y-1/2 text-muted"
            />
            <input
              ref={search}
              className="!pl-8"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Find a place"
              aria-label="Find a place"
              /* Not autofocused: on a phone that is a keyboard covering the
                 list before anybody has looked at it. */
            />
          </label>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2.5 pb-1">
          {choices.length === 0 && (
            <p className="hint px-3 py-8 text-center">
              {stops.length
                ? `Nothing on this trip matches “${query}”.`
                : 'This trip has no itinerary yet — add a stop and it will show up here.'}
            </p>
          )}
          {choices.map(choice => (
            <PlaceRow
              key={choice.stop.id}
              choice={choice}
              busy={busy}
              onPick={() => onPick({ stopId: choice.stop.id })}
            />
          ))}
        </div>

        {/* The two answers that are not a place. Below the list and railed off
            from it, because they are what you reach for when none of the above
            is right — not another stop to scroll past. */}
        <div
          className="flex-none border-t border-line px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]
                     pt-1.5 sm:pb-2">
          <PlainRow
            icon="minus"
            title="Not at any place"
            detail="Keep them out of the itinerary on purpose"
            busy={busy}
            onPick={() => onPick({ stopId: null })}
          />
          {byLocation && (
            <PlainRow
              icon="locate"
              title="Decide by where they were taken"
              detail="Hand them back to the map, and let distance file them"
              busy={busy}
              onPick={() => onPick({ stopPinned: false })}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* What is being moved, as a little stack of corners. Five is enough to say
   "those ones" — beyond that it is a count, which the title already gives. */
function Stack({ photos }: { photos: TripPhoto[] }) {
  const few = photos.slice(0, 4)
  if (!few.length) return null
  return (
    <span
      className="relative flex flex-none"
      /* A 40px tile every 13px, so the box is as wide as the last one's far
         edge. Guessed at 28 it was twelve pixels short and the title beside
         it lost its first letter. */
      style={{ width: 40 + (few.length - 1) * 13, height: 40 }}
      aria-hidden="true">
      {few.map((photo, index) => (
        <span
          key={photo.id}
          /* Ringed in the sheet's own colour so overlapping corners read as
             separate pictures. Written as a style because `border-solid` is a
             border STYLE in Tailwind, whatever the token is called. */
          className="absolute top-0 size-10 overflow-hidden rounded-lg bg-raised"
          style={{
            left: index * 13,
            zIndex: index,
            boxShadow: '0 0 0 2px var(--c-panel-solid)',
          }}>
          <MediaThumb item={photo} w={96} h={96} now className="size-full object-cover" />
        </span>
      ))}
    </span>
  )
}

function PlaceRow({
  choice,
  busy,
  onPick,
}: {
  choice: PlaceChoice
  busy?: boolean
  onPick: () => void
}) {
  const { stop, count, thumb, metres, current } = choice
  const day = (stop.day && dayLabelOf(stop.day)) || stop.day || ''
  const near = roughly(metres)
  const detail = [day, count ? `${count} ${count === 1 ? 'item' : 'items'}` : '', near]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      className={
        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ' +
        'hover:bg-raised2 disabled:opacity-50 ' +
        (current ? 'bg-raised' : '')
      }
      disabled={busy}
      aria-current={current || undefined}
      onClick={onPick}>
      <span className="grid size-11 flex-none place-items-center overflow-hidden rounded-lg bg-raised text-muted">
        {thumb ? (
          <MediaThumb item={thumb} w={96} h={96} now className="size-full object-cover" />
        ) : (
          <Icon n={(stop.icon as never) || 'pin'} s={16} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold tracking-[-.01em]">{stop.name}</span>
        {detail && <span className="block truncate text-[11px] text-muted">{detail}</span>}
      </span>
      {current && <Icon n="check" s={16} className="flex-none text-accent" />}
    </button>
  )
}

function PlainRow({
  icon,
  title,
  detail,
  busy,
  onPick,
}: {
  icon: string
  title: string
  detail: string
  busy?: boolean
  onPick: () => void
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left
                 transition-colors hover:bg-raised2 disabled:opacity-50"
      disabled={busy}
      onClick={onPick}>
      <span className="grid size-11 flex-none place-items-center rounded-lg bg-raised text-muted">
        <Icon n={icon as never} s={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold tracking-[-.01em]">{title}</span>
        <span className="block truncate text-[11px] text-muted">{detail}</span>
      </span>
    </button>
  )
}
