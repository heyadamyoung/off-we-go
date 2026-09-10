import { useMemo, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import type { GroupMode } from '../../../photo-groups-core'
import type { Id, Person, Stop, TripPhoto } from '../../../shared/model/types'
import usePhotoGroups from '../model/use-photo-groups'
import { photoItem, type TripItem } from '../model/trip-items'

/* The gallery. Its own file because it is its own screen: on anything wider
   than a phone it takes the whole of one, and a screen that owns its title,
   its controls and its way out does not belong inside the panel that used to
   hold it in a column. */

export interface PhotosPanelProps {
  photos: TripPhoto[]
  stops: Stop[]
  people?: Person[]
  selected?: Id | null
  photoBy: string | null
  onPhotoBy: (name: string | null) => void
  onSelect: (item: TripItem, ordered?: TripPhoto[]) => void
  onClose: () => void
  onAddPhotos?: () => void
}

export default function PanelPhotos({
  photos,
  stops,
  people: roster,
  selected,
  photoBy,
  onPhotoBy,
  onSelect,
  onClose,
  onAddPhotos,
}: PhotosPanelProps) {
  /* Whose photographs these are, from the photographs rather than the roster:
     somebody who has not added anything is not a filter worth offering, and a
     name on a photograph whose owner has left the trip still needs a face. */
  const names = [...new Set(photos.map(photo => photo.by).filter(Boolean))]
  const faces = new Map((roster || []).map(person => [person.name, person]))
  const shown = photoBy ? photos.filter(photo => photo.by === photoBy) : photos
  const byStop = new Map(stops.map(stop => [stop.id, stop]))

  /* By place by default: the trip already knows where it went, and a wall of
     everything is the harder thing to read once there is a lot of it. */
  const [mode, setMode] = useState<GroupMode>('stop')
  const {
    ref: grid,
    columns,
    groups,
    rows,
    visible,
    collapsed,
    toggle,
  } = usePhotoGroups(shown, stops, mode)

  /* The gallery's own reading order, top to bottom — which is what the viewer
     pages through when a photograph is opened from here. It used to page
     through the bottom strip instead: a different order, filtered to one day,
     so the picture after the one you tapped was rarely the one under it, and
     from another day there was nothing to swipe to at all.

     A collapsed group is not in it. Those photographs are not on the screen,
     and swiping into pictures you cannot see is its own kind of lost. */
  const reading = useMemo(
    () => groups.filter(group => !collapsed.has(group.key)).flatMap(group => group.photos),
    [groups, collapsed],
  )

  if (!photos.length) {
    return (
      <div className="grid place-items-center px-6 py-16 text-center">
        <p className="max-w-[38ch] text-sm text-muted">
          Nothing here yet. Everything anyone adds to this trip shows up here, grouped by where it
          was taken.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Everything the gallery needs in one band: what it is, how it is
          arranged, whose it is, how much there is, and the way out. Two rows
          of chrome over a wall of photographs is one row too many. */}
      <div
        className="sticky top-0 z-[2] flex items-center gap-2 border-b border-line bg-strong
                   px-3 py-2.5 backdrop-blur-xl sm:gap-3 sm:px-6">
        {/* The name goes first where there is room for it. On a phone the
            screen is the answer to what this is, and the width is better spent
            on the controls. */}
        <h2 className="m-0 mr-1 text-[15px] font-extrabold tracking-[-.02em] max-sm:hidden">
          Photos
        </h2>

        {/* One line, always. Where the controls outgrow a phone they slide
            rather than wrapping: a second band of chrome costs every screen
            below it, and this one costs nothing until it is used. */}
        <div className="gallery-controls flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <fieldset className="segbar" aria-label="How to arrange">
            <button aria-pressed={mode === 'stop'} onClick={() => setMode('stop')}>
              By place
            </button>
            <button aria-pressed={mode === 'date'} onClick={() => setMode('date')}>
              By date
            </button>
          </fieldset>
          {names.length > 1 && (
            /* Faces rather than names. Four names in pills is most of a phone's
               width spent spelling out something a 26px circle says at a
               glance, and the row has to stay one row. Tapping the one already
               chosen puts everyone back, and the way out is spelled out beside
               it while it is needed rather than parked there for ever. */
            <fieldset className="flex flex-none items-center gap-1" aria-label="Whose photographs">
              {names.map(name => {
                const mine = photoBy === name
                const person = faces.get(name)
                return (
                  <button
                    key={name}
                    aria-pressed={mine}
                    /* Distinct from the reset beside it on purpose: two
                       controls that both announce themselves as "everyone" is
                       one control too many to a screen reader. */
                    title={mine ? `Only ${name} — tap to clear` : `Only ${name}`}
                    aria-label={mine ? `Only ${name}, tap to clear` : `Show only ${name}`}
                    onClick={() => onPhotoBy(mine ? null : name)}
                    className={
                      'avatar size-[26px] text-[10px] transition-opacity ' +
                      (mine
                        ? 'opacity-100 ring-2 ring-accent'
                        : photoBy
                          ? 'opacity-40 hover:opacity-80'
                          : 'opacity-90 hover:opacity-100')
                    }>
                    <Face name={name} src={person?.avatar} />
                  </button>
                )
              })}
              {photoBy && (
                <button className="mini ml-0.5 whitespace-nowrap" onClick={() => onPhotoBy(null)}>
                  Everyone
                </button>
              )}
            </fieldset>
          )}
        </div>

        <div className="flex flex-none items-center gap-1.5 sm:gap-2">
          <span className="text-[11px] tabular-nums text-muted max-sm:hidden">
            {shown.length} {shown.length === 1 ? 'item' : 'items'}
          </span>
          {onAddPhotos && (
            /* A plus, because everywhere else a plus is how you add one more of
               whatever you are looking at. The word was costing sixty pixels
               of a row that has to hold everything. */
            <button
              className="grid size-8 place-items-center rounded-full bg-accent text-accent-ink
                         transition-[filter] hover:brightness-110"
              onClick={onAddPhotos}
              title="Add photos or videos"
              aria-label="Add photos or videos">
              <Icon n="plus" s={16} w={2} />
            </button>
          )}
          <button
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-raised2 hover:text-ink"
            onClick={onClose}
            title="Back to map"
            aria-label="Back to map">
            <Icon n="x" s={16} />
          </button>
        </div>
      </div>

      {shown.length ? (
        /* Only the rows anybody can see are in the document. The two spacers
           stand in for the rest, so the scrollbar is honest and nothing jumps
           — and a trip can hold as many photographs as it likes without the
           grid being the reason it cannot. Headers are rows like any other,
           which is what lets a card collapse without any of this changing. */
        <div className="px-4 pt-1 sm:px-6" ref={grid}>
          <div style={{ height: visible.topPad }} />
          {rows.slice(visible.start, visible.end).map(row =>
            row.kind === 'header' ? (
              <button
                key={row.key}
                className="pgrid-head group flex w-full items-center gap-2 pb-2 pt-4 text-left"
                style={{ height: row.height }}
                aria-expanded={!collapsed.has(row.group.key)}
                onClick={() => toggle(row.group.key)}>
                <Icon
                  n="chev"
                  s={14}
                  className={
                    'flex-none text-muted transition-transform ' +
                    (collapsed.has(row.group.key) ? '' : 'rotate-90')
                  }
                />
                <span className="truncate text-[13px] font-bold tracking-[-.01em]">
                  {row.group.title}
                </span>
                <span className="text-[11px] tabular-nums text-muted">
                  {row.group.photos.length}
                </span>
                <span className="ml-2 h-px flex-1 bg-line" aria-hidden="true" />
              </button>
            ) : (
              <div
                key={row.key}
                className="grid gap-2"
                style={{
                  height: row.height,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}>
                {row.items.map(photo => (
                  <button
                    key={photo.id}
                    aria-label={photo.caption || (photo.kind === 'video' ? 'Video' : 'Photo')}
                    className={
                      'pgrid-photo group relative aspect-square overflow-hidden rounded-xl bg-raised ' +
                      (selected === photo.id
                        ? 'outline outline-2 -outline-offset-2 outline-accent'
                        : '')
                    }
                    onClick={() =>
                      onSelect(
                        photoItem(photo, photo.stopId ? byStop.get(photo.stopId) : undefined),
                        reading,
                      )
                    }>
                    <MediaThumb
                      item={photo}
                      w={480}
                      h={480}
                      /* The window put this here, so there is nothing left for
                         the browser to be lazy about. Being lazy twice is how
                         a tile gets built and destroyed without ever loading,
                         and shows its shimmer again on the way back. */
                      now
                      className="size-full object-cover transition-transform duration-200
                                 group-hover:scale-[1.03]"
                    />
                    {photo.caption && (
                      <span
                        className="pointer-events-none absolute inset-x-0 bottom-0 truncate
                                   bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5
                                   text-[11px] text-white opacity-0 transition-opacity
                                   group-hover:opacity-100">
                        {photo.caption}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ),
          )}
          <div style={{ height: visible.bottomPad }} />
        </div>
      ) : (
        <p className="hint px-6 py-10 text-center">Nothing from {photoBy} on this trip.</p>
      )}
    </>
  )
}

/* A face, or the initial of one. A portrait that will not load is the ordinary
   case rather than the odd one — somebody signed up without a picture, an
   avatar host is having a bad afternoon — and the browser's broken-image glyph
   in a 26px circle is worse than the letter it was covering up. */
function Face({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false)
  const letter = (name || '?')[0].toUpperCase()
  if (!src || failed) return <span className="avatar-letter">{letter}</span>
  return <img src={src} alt="" onError={() => setFailed(true)} />
}
