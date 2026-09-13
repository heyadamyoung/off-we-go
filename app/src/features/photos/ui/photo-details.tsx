import HoldToDelete from '../../../shared/ui/hold-delete'
import { placeProvenance } from '../../../photo-place-core'
import type { Id, Stop, TripPhoto } from '../../../shared/model/types'

interface PhotoDetailsProps {
  photo: TripPhoto
  stops: Stop[]
  onClose: () => void
  onChange: (id: Id, fields: Partial<TripPhoto>) => void
  onDelete: (id: Id) => void
}

/* Editing a photograph's or a film's facts is deliberate, so it lives behind
   the pencil in the chrome rather than loose in the reading flow: labelled
   fields, and the one destructive act at the very end of the deliberate
   context — never beside a select where a stray thumb finds it. */
export default function PhotoDetails({
  photo,
  stops,
  onClose,
  onChange,
  onDelete,
}: PhotoDetailsProps) {
  const video = photo.kind === 'video'
  const placed = placeProvenance(photo)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is the pointer way out; the card's Done is the keyboard way
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above — Escape closes the whole viewer by design
    <div
      className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-black/60 p-5
                 pb-[calc(1.25rem+var(--keyboard,0px))]"
      onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only fences clicks off the scrim */}
      <div
        className="flex w-full max-w-[min(420px,calc(100vw-2.5rem))] flex-col gap-3
                   rounded-2xl border border-line bg-solid p-4 shadow-panel"
        role="dialog"
        aria-label={video ? 'Video details' : 'Photo details'}
        onClick={event => event.stopPropagation()}>
        <b className="text-sm font-extrabold">{video ? 'Video details' : 'Photo details'}</b>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-muted">
          Caption
          <input
            className="rounded-lg border border-line bg-raised px-3 py-2 text-sm font-normal
                       text-ink outline-none focus:border-accent"
            value={photo.caption || ''}
            placeholder={video ? 'What is happening here?' : 'What is this a picture of?'}
            onChange={e => onChange(photo.id, { caption: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-muted">
          Taken at
          <select
            className="rounded-lg border border-line bg-raised px-3 py-2 text-sm font-normal
                       text-ink outline-none focus:border-accent"
            value={photo.stopId || ''}
            onChange={e => onChange(photo.id, { stopId: e.target.value || null })}>
            <option value="">Not at a stop</option>
            {stops.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {placed && (
          /* Where the pin came from. The app has always known and never said,
             so a picture sitting at the airport instead of the castle read as
             a bug — and the two ways a picture can arrive without its own
             coordinates are different problems, only one of which anybody can
             do anything about. */
          <div className="flex flex-col gap-1 rounded-lg bg-raised px-3 py-2">
            <span className="text-[11px] font-bold text-muted">Location</span>
            <span className="text-[13px] text-ink">
              {placed.label}
              {!placed.exact && <span className="ml-1.5 text-[11px] text-faint">approximate</span>}
            </span>
            {placed.detail && (
              <span className="text-[11px] leading-snug text-faint">{placed.detail}</span>
            )}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between border-t border-line pt-3">
          <HoldToDelete
            what={video ? 'this video' : 'this photo'}
            onDelete={() => {
              onClose()
              onDelete(photo.id)
            }}
          />
          <button
            className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-accent-ink"
            onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
