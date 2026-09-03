import {
  DEADLINE_LABELS,
  localTime,
  MODE_GLYPH,
  nextDeadline,
  segmentFace,
  type Segment,
  type SegmentDeadlines,
} from '../../../segments-core'

/* One leg, wearing the face the clock chooses. future: a quiet line.
   eve: packing truth. day: the countdown, gate in amber. past: a line in
   the journal. Nobody configures this; the hour does. */

const STRIP_ORDER: Array<keyof SegmentDeadlines> = [
  'checkinClosesAt',
  'bagsCloseAt',
  'boardingAt',
  'doorsAt',
]

export default function SegmentCard({
  segment,
  now,
  canEdit,
  onEdit,
  onShowGate,
  onAttach,
}: {
  segment: Segment
  now: number
  canEdit: boolean
  onEdit?: (segment: Segment) => void
  onShowGate?: (segment: Segment) => void
  onAttach?: (segment: Segment) => void
}) {
  const face = segmentFace(segment, now)
  const glyph = MODE_GLYPH[segment.mode]
  const title = [segment.carrier, segment.number].filter(Boolean).join(' ') || segment.mode
  const upcoming = nextDeadline(segment, now)

  if (face === 'future' || face === 'past') {
    return (
      <div
        className={
          'flex items-baseline gap-2 py-1 text-xs ' + (face === 'past' ? 'opacity-55' : '')
        }>
        <span aria-hidden="true">{glyph}</span>
        <span className="font-semibold">{title}</span>
        <span className="text-muted">
          {segment.fromCode || segment.fromName} → {segment.toCode || segment.toName}
        </span>
        <span className="ml-auto font-mono text-[11px] text-faint">
          {localTime(segment.departsAt, segment.departTz)}
        </span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-raised2">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[.12em] text-faint">
          {glyph} {segment.mode}
          {segment.status !== 'scheduled' && (
            <span className="ml-2 text-tight">{segment.status}</span>
          )}
        </span>
        {segment.ref && (
          <button
            className="hitslop rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px]"
            title="Copy the booking reference"
            onClick={() => navigator.clipboard?.writeText(segment.ref || '').catch(() => {})}>
            {segment.ref}
          </button>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-1.5">
        <div>
          <div className="text-lg font-extrabold tracking-[-.01em]">
            {segment.fromCode || segment.fromName}
          </div>
          <div className="font-mono text-[11.5px] text-muted">
            {localTime(segment.departsAt, segment.departTz)}
            {segment.departTz ? '' : ''}
          </div>
        </div>
        <div className="text-center text-[11px] leading-tight text-faint">
          {segment.carrier}
          <div className="text-xs font-bold text-ink">{segment.number}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold tracking-[-.01em]">
            {segment.toCode || segment.toName}
          </div>
          <div className="font-mono text-[11.5px] text-muted">
            {localTime(segment.arrivesAt, segment.arriveTz)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-3 pt-2 text-[11px]">
        {segment.gate && (
          <span className="rounded-md border border-line bg-canvas px-2 py-0.5">
            Gate <b className="text-accent">{segment.gate}</b>
            {segment.gateWas && <s className="ml-1 text-faint">{segment.gateWas}</s>}
          </span>
        )}
        {segment.platform && (
          <span className="rounded-md border border-line bg-canvas px-2 py-0.5">
            Platform <b className="text-accent">{segment.platform}</b>
          </span>
        )}
        {segment.terminal && (
          <span className="rounded-md border border-line bg-canvas px-2 py-0.5">
            T{segment.terminal}
          </span>
        )}
        {segment.passengers.map(person => (
          <span key={person.name} className="rounded-md border border-line bg-canvas px-2 py-0.5">
            {person.name}
            {person.seat && <b className="ml-1">{person.seat}</b>}
          </span>
        ))}
        {face === 'eve' && segment.bags?.checked && (
          <span className="rounded-md border border-line bg-canvas px-2 py-0.5">
            Checked <b>{segment.bags.checked}</b>
          </span>
        )}
        {face === 'eve' && segment.bags?.carryOn && (
          <span className="rounded-md border border-line bg-canvas px-2 py-0.5">
            Carry-on <b>{segment.bags.carryOn}</b>
          </span>
        )}
      </div>

      {segment.deadlines && (
        <div className="mx-3 mt-2.5 flex justify-between border-t border-dashed border-line pt-2 pb-1">
          {STRIP_ORDER.filter(key => segment.deadlines?.[key]).map(key => {
            const at = segment.deadlines?.[key] as string
            const passed = new Date(at).getTime() <= now
            const isNext = upcoming?.key === key
            return (
              <div key={key} className="flex-1 text-center">
                <div className="text-[9px] font-bold uppercase tracking-[.06em] text-faint">
                  {DEADLINE_LABELS[key]}
                </div>
                <div
                  className={
                    'font-mono text-xs ' +
                    (passed ? 'text-ok' : isNext ? 'font-bold text-accent' : 'text-ink')
                  }>
                  {passed ? '✓' : localTime(at, segment.departTz)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(segment.documents?.length || 0) > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-1.5 text-[11px]">
          {segment.documents?.map(doc => (
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

      {segment.statusNote && (
        <div className="px-3 pt-1.5 text-[11px] text-tight">✦ {segment.statusNote}</div>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5">
        {segment.mode === 'flight' && segment.fromLng != null && onShowGate && (
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-ink"
            onClick={() => onShowGate(segment)}>
            Show gate on the map
          </button>
        )}
        {canEdit && onAttach && (
          <button
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-bold"
            onClick={() => onAttach(segment)}>
            Attach document
          </button>
        )}
        {canEdit && onEdit && (
          <button
            className="ml-auto rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-bold"
            onClick={() => onEdit(segment)}>
            Edit
          </button>
        )}
        {segment.costAmount != null && (
          <span className="ml-auto font-mono text-[10.5px] text-faint">
            {segment.costAmount} {segment.costCurrency}
          </span>
        )}
      </div>
    </div>
  )
}
