import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import type { TripItem } from '../model/trip-items'

interface DetailCardProps {
  item: TripItem
  shifted: boolean
  canEdit: boolean
  photoCount: number
  onClose: () => void
  onOpenPhotos: () => void
  onAddPhotos: () => void
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
  /** present only when the stop is an airport with an inside worth seeing */
  onIndoor?: () => void
}

/* The one selected stop, beside the map rather than over it. A photograph
   never lands here: selecting one opens the full-screen viewer instead. */
export default function DetailCard(props: DetailCardProps) {
  const { item } = props
  const stop = item.stop
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
         bar, and the body scrolls inside that. */
        'max-lg:max-h-[calc(100%_-_var(--trip-top)_-_var(--trip-1)_-_12px)] ' +
        'max-lg:w-auto ' +
        (props.shifted ? 'left-[492px] max-lg:left-4' : 'left-7')
      }>
      {/* The stop's picture is decoration behind a title and fills its space. */}
      <div className="relative h-[170px] flex-none overflow-hidden bg-canvas max-sm:h-[128px]">
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
      <div className="flex flex-col gap-2 overflow-y-auto px-[18px] pb-4 pt-3.5">
        <div
          className="flex items-center justify-between text-[11px] font-extrabold uppercase
                        tracking-[.12em] text-accent">
          {status}
          <span className="font-semibold normal-case tracking-normal text-faint">
            {[item.day, item.time].filter(Boolean).join(' · ')}
          </span>
        </div>
        <h3 className="m-0 text-xl font-extrabold leading-tight tracking-[-.02em]">{item.title}</h3>
        {stop?.note && <p className="m-0 text-xs leading-relaxed text-muted">{stop.note}</p>}
        {stop?.kind && <div className="text-xs text-muted">{stop.kind}</div>}

        {(stop?.documents?.length || 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {stop?.documents?.map(doc => (
              <a
                key={doc.id}
                className="rounded-md border border-line bg-canvas px-2 py-0.5 text-ink no-underline"
                href={doc.src}
                target="_blank"
                rel="noreferrer">
                📎 {doc.name}
              </a>
            ))}
          </div>
        )}

        <div className="mt-1 flex items-center gap-2">
          <button
            className="mini"
            onClick={props.photoCount ? props.onOpenPhotos : props.onAddPhotos}>
            <Icon n="camera" s={13} className="mr-1 inline -mt-0.5" />
            {props.photoCount
              ? `${props.photoCount} photo${props.photoCount === 1 ? '' : 's'}`
              : 'Add photos'}
          </button>
          {props.onIndoor && (
            <button className="mini" onClick={props.onIndoor}>
              <Icon n="plane" s={13} className="mr-1 inline -mt-0.5" />
              Terminal map
            </button>
          )}
          {props.canEdit && (
            <>
              <button
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2
                               hover:text-ink"
                onClick={props.onEdit}
                title="Edit this stop">
                <Icon n="pencil" s={14} />
              </button>
              <button
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2
                               hover:text-ink"
                onClick={props.onMove}
                title="Move this stop">
                <Icon n="move" s={14} />
              </button>
              <button
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2
                               hover:text-danger"
                onClick={props.onDelete}
                title="Remove this stop">
                <Icon n="trash" s={14} />
              </button>
            </>
          )}
          <span className="flex-1" />
          {stop && (
            <a
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2 hover:text-ink"
              title="Open in Google Maps"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}>
              <Icon n="map" s={14} />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
