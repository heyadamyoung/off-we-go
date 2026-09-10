import { useState } from 'react'
import DocumentsSheet from '../../../shared/ui/documents-sheet'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import type { RouteToStop } from '../model/use-route-to-stop'
import type { StopDocTools } from '../model/use-stop-docs'
import type { TripItem } from '../model/trip-items'

interface DetailCardProps {
  item: TripItem
  shifted: boolean
  canEdit: boolean
  photoCount: number
  docs?: StopDocTools
  /** how far and how long, both gaits — drawn on the map too */
  stats?: RouteToStop | null
  onClose: () => void
  onOpenPhotos: () => void
  onAddPhotos: () => void
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
  /** present only when the stop is an airport with an inside worth seeing */
  onIndoor?: () => void
}

/* One rail button: a quiet glyph with a count riding its shoulder when there
   is something to count. Uniform on purpose — the old row mixed chip buttons
   with bare icons and wrapped into a heap under any real description. */
function Act({
  icon,
  label,
  count,
  danger,
  onClick,
}: {
  icon: string
  label: string
  count?: number
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={
        'relative grid h-9 min-w-9 flex-1 place-items-center rounded-lg text-muted ' +
        (danger ? 'hover:bg-raised2 hover:text-danger' : 'hover:bg-raised2 hover:text-ink')
      }
      onClick={onClick}
      title={label}
      aria-label={label}>
      <Icon n={icon} s={15} />
      {!!count && (
        <span
          className="tnum absolute right-1 top-0.5 rounded-full bg-accent px-1 text-[9px]
                     font-extrabold leading-[14px] text-accent-ink"
          aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  )
}

/* The one selected stop, beside the map rather than over it. A photograph
   never lands here: selecting one opens the full-screen viewer instead.

   Three storeys, only the middle one moves: the header states the facts —
   status, title, and a one-line strip of distance with both gaits' minutes —
   the description scrolls inside its own room, and the actions stand in one
   uniform row along the floor, always reachable, never scrolled away. */
export default function DetailCard(props: DetailCardProps) {
  const { item, stats } = props
  const stop = item.stop
  const [papers, setPapers] = useState(false)
  const paperCount = stop?.documents?.length || 0
  const status =
    item.status === 'done' ? 'Done' : item.status === 'now' ? 'Happening now' : 'Planned'

  return (
    <div
      className={
        'detailcard sheet rise absolute top-[var(--trip-top)] z-[7] flex w-[360px] flex-col ' +
        'overflow-hidden ' +
        'rounded-2xl transition-[left] max-lg:inset-x-4 max-lg:bottom-[var(--trip-1)] max-lg:top-auto ' +
        /* Anchored to the bottom, it grew upwards with its own text: a stop with
         a long note pushed its header — and the only way to close it — up
         behind the top bar. It gets the room between the chrome and the day
         bar, and the description scrolls inside that. */
        'max-lg:max-h-[calc(100%_-_var(--trip-top)_-_var(--trip-1)_-_12px)] ' +
        'max-lg:w-auto ' +
        (props.shifted ? 'left-[492px] max-lg:left-4' : 'left-7')
      }>
      {/* The stop's picture is decoration behind a title and fills its space. */}
      <div className="relative h-[170px] flex-none overflow-hidden bg-canvas max-sm:h-[120px]">
        {stop?.src ? (
          <Img item={stop} w={720} h={720} eager className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-faint opacity-50">
            <Icon n={stop?.icon || 'pin'} s={56} />
          </span>
        )}
        <button
          className="absolute right-2.5 top-2.5 grid size-[30px] place-items-center rounded-lg
                           bg-black/70 text-white"
          onClick={props.onClose}
          aria-label="Close">
          <Icon n="x" s={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-col px-[18px] pt-3">
        <div
          className="flex items-center justify-between text-[11px] font-extrabold uppercase
                        tracking-[.12em] text-accent">
          {status}
          <span className="font-semibold normal-case tracking-normal text-faint">
            {[item.day, item.time].filter(Boolean).join(' · ')}
          </span>
        </div>
        <h3 className="m-0 mt-1 text-lg font-extrabold leading-tight tracking-[-.02em]">
          {item.title}
        </h3>

        {/* Distance speaks once, quietly: the way itself is on the map. */}
        {stats && (stats.pending || stats.km) && (
          <div className="dstats tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] font-semibold text-muted">
            {stats.pending ? (
              <span className="animate-pulse">Measuring the way…</span>
            ) : (
              <>
                <span className="text-ink">{stats.km}</span>
                {stats.walkMin != null && (
                  <span className="flex items-center gap-1">
                    <Icon n="walk" s={12} />
                    {stats.walkMin} min
                  </span>
                )}
                {stats.driveMin != null && (
                  <span className="flex items-center gap-1">
                    <Icon n="car" s={12} />
                    {stats.driveMin} min
                  </span>
                )}
                {stats.direct && <span className="text-faint">direct</span>}
              </>
            )}
          </div>
        )}

        {(stop?.note || stop?.kind) && (
          <div className="dprose -mx-1 mt-2 min-h-0 flex-auto overflow-y-auto px-1 pb-1">
            {stop?.note && <p className="m-0 text-xs leading-relaxed text-muted">{stop.note}</p>}
            {stop?.kind && <div className="mt-1.5 text-xs text-faint">{stop.kind}</div>}
          </div>
        )}
      </div>

      {papers && stop && (
        <DocumentsSheet
          title={`Papers — ${stop.name}`}
          documents={stop.documents || []}
          canEdit={props.canEdit && !!props.docs}
          onClose={() => setPapers(false)}
          onAdd={props.docs ? file => props.docs?.attach(stop.id, file) : undefined}
          onEdit={props.docs?.edit}
          onRemove={props.docs?.remove}
        />
      )}

      {/* Wraps rather than overflowing: an airport stop somebody can edit
          carries seven of these, and seven 36px targets do not fit across a
          320px phone however tightly they are packed. A second line on the
          narrowest screens costs less than a button off the edge. */}
      <div
        className="mx-[18px] mb-2.5 mt-2 flex flex-none flex-wrap items-center gap-1
                   border-t border-line pt-2">
        <Act
          icon="camera"
          label={props.photoCount ? `${props.photoCount} photos` : 'Add photos or videos'}
          count={props.photoCount}
          onClick={props.photoCount ? props.onOpenPhotos : props.onAddPhotos}
        />
        {stop && (paperCount > 0 || (props.canEdit && props.docs)) && (
          <Act icon="note" label="Papers" count={paperCount} onClick={() => setPapers(true)} />
        )}
        {props.onIndoor && <Act icon="plane" label="Terminal map" onClick={props.onIndoor} />}
        {props.canEdit && (
          <>
            <Act icon="pencil" label="Edit this stop" onClick={props.onEdit} />
            <Act icon="move" label="Move this stop" onClick={props.onMove} />
            <Act icon="trash" label="Remove this stop" danger onClick={props.onDelete} />
          </>
        )}
        {stop && (
          <a
            className="grid h-9 min-w-9 flex-1 place-items-center rounded-lg text-muted
                       hover:bg-raised2 hover:text-ink"
            title="Open in Google Maps"
            aria-label="Open in Google Maps"
            target="_blank"
            rel="noopener noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}>
            <Icon n="map" s={15} />
          </a>
        )}
      </div>
    </div>
  )
}
