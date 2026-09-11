import { useMemo, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import { chosenIn } from '../../../photo-select-core'
import { GalleryBar, PlacePicker, SelectBar, usePhotoSelection, type Filing } from '../../photos'
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
  /* Filing several at once. Absent for anybody who cannot edit the trip, and
     the way in goes with it — there is no point offering a selection whose
     only action is one you are not allowed to take. */
  onMovePhotos?: (ids: Id[], filing: Filing) => Promise<boolean | void> | boolean | void
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
  onMovePhotos,
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

  /* Choosing several. The same reading order the viewer pages through, so a
     shift-click reaches exactly what is between the two things clicked and
     "All" means what is on the screen rather than what is in the trip. */
  const choosing = usePhotoSelection(reading)
  const [picking, setPicking] = useState(false)
  const [moving, setMoving] = useState(false)

  const file = async (filing: Filing) => {
    if (!onMovePhotos) return
    setMoving(true)
    try {
      const done = await onMovePhotos(
        choosing.photos.map(photo => photo.id),
        filing,
      )
      /* Closed only on a move that happened. One that was refused — no
         signal, a stop somebody else deleted — leaves the picker where it is,
         beside the toast saying why, rather than putting it away as though
         something had been done. The pictures stay chosen either way: a move
         re-groups the gallery under them, so the selection is what says where
         they went, and getting it wrong costs one more tap. */
      if (done !== false) setPicking(false)
    } finally {
      setMoving(false)
    }
  }

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
      <GalleryBar
        mode={mode}
        onMode={setMode}
        names={names}
        faces={faces}
        photoBy={photoBy}
        onPhotoBy={onPhotoBy}
        count={shown.length}
        onSelect={onMovePhotos && !choosing.on ? choosing.begin : undefined}
        onAddPhotos={onAddPhotos}
        onClose={onClose}
      />
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
              /* A row rather than one button, because the heading rolls the
                 card up and the tick beside it takes the whole card — and a
                 button inside a button is neither valid nor clickable. The
                 heading keeps the class: it is what the card IS. */
              <div
                key={row.key}
                className="group flex w-full items-center gap-2 pb-2 pt-4 text-left"
                style={{ height: row.height }}>
                <button
                  className="pgrid-head flex min-w-0 shrink items-center gap-2 self-stretch text-left"
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
                </button>
                {choosing.on && onMovePhotos && (
                  /* A whole card in one tap, which is the case this feature
                     exists for: a stop's worth of pictures filed at the wrong
                     stop, corrected in two gestures rather than forty. */
                  <GroupTick
                    state={chosenIn(
                      { ids: choosing.chosen, anchor: null },
                      row.group.photos.map(photo => photo.id),
                    )}
                    title={row.group.title}
                    onClick={() => choosing.pressGroup(row.group.photos.map(photo => photo.id))}
                  />
                )}
                {/* Outside the heading, so the tick sits against the count it
                    belongs to rather than being pushed to the far side of a
                    desktop. The rule takes whatever is left. */}
                <span className="ml-1 h-px flex-1 bg-line" aria-hidden="true" />
              </div>
            ) : (
              <div
                key={row.key}
                className="grid gap-2"
                style={{
                  height: row.height,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}>
                {row.items.map(photo => {
                  const chosen = choosing.chosen.has(photo.id)
                  return (
                    <button
                      key={photo.id}
                      aria-label={photo.caption || (photo.kind === 'video' ? 'Video' : 'Photo')}
                      aria-pressed={choosing.on ? chosen : undefined}
                      {...(onMovePhotos ? choosing.holdProps(photo.id) : {})}
                      className={
                        'pgrid-photo group relative aspect-square overflow-hidden rounded-xl bg-raised ' +
                        /* A held tile must not also raise the system's own
                         "save image" sheet over the selection it just
                         started, and a dragged one must not select text. */
                        'select-none [-webkit-touch-callout:none] ' +
                        'transition-transform ' +
                        (chosen
                          ? 'scale-[.93] outline outline-2 -outline-offset-2 outline-accent '
                          : '') +
                        (!chosen && selected === photo.id
                          ? 'outline outline-2 -outline-offset-2 outline-accent'
                          : '')
                      }
                      onClick={event => {
                        const how = event.shiftKey
                          ? 'range'
                          : event.metaKey || event.ctrlKey
                            ? 'add'
                            : 'tap'
                        if (onMovePhotos && choosing.press(photo.id, how)) return
                        onSelect(
                          photoItem(photo, photo.stopId ? byStop.get(photo.stopId) : undefined),
                          reading,
                        )
                      }}>
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
                      {photo.caption && !choosing.on && (
                        <span
                          className="pointer-events-none absolute inset-x-0 bottom-0 truncate
                                   bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5
                                   text-[11px] text-white opacity-0 transition-opacity
                                   group-hover:opacity-100">
                          {photo.caption}
                        </span>
                      )}
                      {choosing.on && (
                        /* A tick in the corner, filled when chosen and an empty
                         ring when not: an unmarked tile in selection is a
                         tile you cannot tell is choosable. */
                        <span
                          className={
                            'pointer-events-none absolute right-1.5 top-1.5 grid size-5 place-items-center ' +
                            'rounded-full border-2 transition-colors ' +
                            (chosen
                              ? 'border-accent bg-accent text-accent-ink'
                              : 'border-white/80 bg-black/25 text-transparent')
                          }
                          aria-hidden="true">
                          <Icon n="check" s={11} w={3} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ),
          )}
          <div style={{ height: visible.bottomPad }} />
          {choosing.on && onMovePhotos && (
            <SelectBar
              count={choosing.count}
              total={reading.length}
              busy={moving}
              onMove={() => setPicking(true)}
              onAll={choosing.all}
              onDone={choosing.end}
            />
          )}
        </div>
      ) : (
        <p className="hint px-6 py-10 text-center">Nothing from {photoBy} on this trip.</p>
      )}
      {picking && onMovePhotos && (
        <PlacePicker
          stops={stops}
          photos={photos}
          moving={choosing.photos}
          busy={moving}
          onPick={file}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

/* How much of a card is chosen, as one tappable mark: filled for all of it,
   a dash for some, an empty ring for none. The dash matters — "some" drawn as
   "none" is a heading that appears to have done nothing when you tapped a
   picture under it. */
function GroupTick({
  state,
  title,
  onClick,
}: {
  state: 'none' | 'some' | 'all'
  title: string
  onClick: () => void
}) {
  return (
    <button
      className="grid size-7 flex-none place-items-center rounded-full hover:bg-raised2"
      onClick={onClick}
      aria-pressed={state === 'all'}
      title={state === 'all' ? `Deselect ${title}` : `Select all of ${title}`}
      aria-label={state === 'all' ? `Deselect ${title}` : `Select all of ${title}`}>
      <span
        className={
          'grid size-5 place-items-center rounded-full border-2 transition-colors ' +
          (state === 'none'
            ? 'border-line2 text-transparent'
            : 'border-accent bg-accent text-accent-ink')
        }>
        <Icon n={state === 'some' ? 'minus' : 'check'} s={11} w={3} />
      </span>
    </button>
  )
}
