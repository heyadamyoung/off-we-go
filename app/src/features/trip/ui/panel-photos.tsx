import { useMemo, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import {
  kindInForce,
  narrowPhotos,
  nothingShown,
  tallyKinds,
  type MediaKind,
} from '../../../photo-filter-core'
import { chosenIn } from '../../../photo-select-core'
import {
  GalleryBar,
  GroupHeading,
  PlacePicker,
  SelectBar,
  usePhotoSelection,
  usePhotosDownload,
  type Filing,
} from '../../photos'
import type { GroupMode } from '../../../photo-groups-core'
import type { Id, Person, Stop, Toast, TripPhoto } from '../../../shared/model/types'
import usePhotoGroups from '../model/use-photo-groups'
import { photoItem, type TripItem } from '../model/trip-items'

/* The gallery. Its own file because it is its own screen: on anything wider
   than a phone it takes the whole of one, and a screen that owns its title,
   its controls and its way out does not belong inside the panel that used to
   hold it in a column. */

/** How far under the gallery's bar the grid's top edge sits: the band's
    height. The card named under the bar is the one whose rows are there. */
const BAR_EDGE = 48

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
  onMovePhotos?: (ids: Id[], filing: Filing) => Promise<boolean | undefined> | boolean | undefined
  /* Deleting several at once, from the same selection. */
  onDeletePhotos?: (ids: Id[]) => Promise<void> | void
  /** where a save says how it went; without one it says nothing */
  toast?: Toast
}

export default function PanelPhotos({
  photos,
  stops,
  people: roster,
  selected,
  photoBy,
  onPhotoBy,
  onSelect,
  onMovePhotos,
  onDeletePhotos,
  toast,
}: PhotosPanelProps) {
  /* Whose photographs these are, from the photographs rather than the roster:
     somebody who has not added anything is not a filter worth offering, and a
     name on a photograph whose owner has left the trip still needs a face. */
  const names = [...new Set(photos.map(photo => photo.by).filter(Boolean))]
  const faces = new Map((roster || []).map(person => [person.name, person]))
  const byStop = new Map(stops.map(stop => [stop.id, stop]))

  /* By place by default: the trip already knows where it went, and a wall of
     everything is the harder thing to read once there is a lot of it. */
  const [mode, setMode] = useState<GroupMode>('stop')

  /* Stills, films, or both. Counted over the whole trip rather than over what
     is on the screen, so the control does not appear and vanish as faces are
     tapped — and read back through the tally, so the last film being deleted
     cannot leave somebody staring at an empty grid with no button to undo it. */
  const [wanted, setWanted] = useState<MediaKind>('all')
  const tally = useMemo(() => tallyKinds(photos), [photos])
  const kind = kindInForce(tally, wanted)

  /* Memoised, because the grid below re-groups, re-measures and re-windows
     whenever it is handed a different array — and a filter that built a new
     one every render would have it do all three on every render. */
  const shown = useMemo(() => narrowPhotos(photos, { by: photoBy, kind }), [photos, photoBy, kind])
  const {
    ref: grid,
    columns,
    groups,
    rows,
    visible,
    scrolled,
    collapsed,
    toggle,
    allCollapsed,
    foldAll,
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
  /* Every chosen picture to the device, the way the viewer saves one. */
  const { downloadAll, saving } = usePhotosDownload(toast ?? (() => {}))

  /* The card whose pictures are under the bar right now, named there while
     its own title row is scrolled off above — with the chevron and the tick,
     so the card can be rolled up or taken whole from where the thumb is. */
  const stuck = useMemo(() => {
    /* Nothing until the grid has gone under the bar at all: at rest the bar
       is above the grid, not over it, and the first card's own row is there. */
    if (mode !== 'stop' || scrolled <= 0) return null
    const edge = scrolled + BAR_EDGE
    const row = rows.find(one => one.top + one.height > edge)
    if (!row || (row.kind === 'header' && row.top >= edge)) return null
    return row.group
  }, [mode, rows, scrolled])

  /* Asked once, in numbers: a bulk delete is the one thing here with no
     undo, and the confirm is what stands between a slip and forty pictures. */
  const remove = async () => {
    if (!onDeletePhotos || !choosing.count) return
    const count = choosing.count
    if (!window.confirm(`Delete ${count} ${count === 1 ? 'photo' : 'photos'} from the trip?`))
      return
    setMoving(true)
    try {
      await onDeletePhotos(choosing.photos.map(photo => photo.id))
      choosing.end()
    } finally {
      setMoving(false)
    }
  }

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
         something had been done. A move that happened is finished: the
         pictures are under their new card and nothing is left chosen, the
         way a delete leaves it. */
      if (done !== false) {
        setPicking(false)
        choosing.end()
      }
    } finally {
      setMoving(false)
    }
  }

  const tickFor = (group: (typeof groups)[number]) =>
    choosing.on && onMovePhotos
      ? {
          state: chosenIn(
            { ids: choosing.chosen, anchor: null },
            group.photos.map(photo => photo.id),
          ),
          onClick: () => choosing.pressGroup(group.photos.map(photo => photo.id)),
        }
      : undefined

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
        kind={kind}
        onKind={setWanted}
        tally={tally}
        names={names}
        faces={faces}
        photoBy={photoBy}
        onPhotoBy={onPhotoBy}
        count={shown.length}
        onSelect={onMovePhotos && !choosing.on ? choosing.begin : undefined}
        folded={allCollapsed}
        onFold={mode === 'stop' && groups.length > 1 ? foldAll : undefined}
        stuck={
          stuck && (
            <GroupHeading
              stuck
              title={stuck.title}
              count={stuck.photos.length}
              collapsed={collapsed.has(stuck.key)}
              onToggle={() => toggle(stuck.key)}
              tick={tickFor(stuck)}
            />
          )
        }
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
              <div key={row.key} style={{ height: row.height }}>
                <GroupHeading
                  title={row.group.title}
                  count={row.group.photos.length}
                  collapsed={collapsed.has(row.group.key)}
                  onToggle={() => toggle(row.group.key)}
                  tick={tickFor(row.group)}
                />
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
                      data-photo-id={photo.id}
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
                        (chosen ? 'scale-[.93]' : '')
                      }
                      /* Up and down is the page's; sideways is a sweep across
                         the tiles, choosing each one the finger crosses. */
                      style={{ touchAction: 'pan-y' }}
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
                      {(chosen || (!choosing.on && selected === photo.id)) && (
                        /* The ring is drawn over the picture rather than as an
                           outline: the focus outline the stylesheet gives every
                           button took the outline's place on the last tile
                           tapped, pushed it outside the tile, and the tile you
                           had just chosen was the one without a border. */
                        <span
                          className="pgrid-ring pointer-events-none absolute inset-0 rounded-xl border-2 border-accent"
                          aria-hidden="true"
                        />
                      )}
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
            <>
              {/* Room under the last row for the bar pinned to the bottom of
                  a phone, so the pictures at the end can scroll out from
                  under it. */}
              <div className="h-16 sm:hidden" aria-hidden="true" />
              <SelectBar
                count={choosing.count}
                total={reading.length}
                busy={moving || saving}
                onMove={() => setPicking(true)}
                onDelete={onDeletePhotos ? remove : undefined}
                onDownload={() => downloadAll(choosing.photos)}
                onAll={choosing.all}
                onDone={choosing.end}
              />
            </>
          )}
        </div>
      ) : (
        <p className="hint px-6 py-10 text-center">{nothingShown({ by: photoBy, kind })}</p>
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
