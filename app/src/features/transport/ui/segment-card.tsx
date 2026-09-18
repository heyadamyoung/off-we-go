import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  DEADLINE_LABELS,
  delayLabel,
  segmentName,
  localTime,
  MODE_GLYPH,
  nextDeadline,
  segmentFace,
  type Segment,
  type SegmentDeadlines,
} from '../../../segments-core'
import { flightHeadline, flightSource } from '../../../flight-day-core'
import { papersOfSegment, type Paper } from '../../../papers-core'
import { parseSeat } from '../../../seatmap-core'
import PaperRow from '../../../shared/ui/paper-row'
import FlightPhases from './flight-phases'
import FlightTrail from './flight-trail'
import SeatMap from './seat-map'
import TicketColumns from './ticket-columns'

/* One leg, wearing the face the clock chooses. future: a quiet line.
   eve: the ticket — where, when, the columns the board fills in. day: the
   ticket with the answer on top of it, the phases, and the airport's word.
   past: a line in the journal. Nobody configures this; the hour does. Opened
   from its folded line in the chain, a future or past leg shows its ticket
   too — that is what the tap asked for. */

const STRIP_ORDER: Array<keyof SegmentDeadlines> = [
  'checkinClosesAt',
  'bagsCloseAt',
  'boardingAt',
  'doorsAt',
]

const TONE: Record<string, string> = {
  ok: 'text-ok',
  tight: 'text-accent',
  late: 'text-tight',
  done: 'text-ok',
  quiet: 'text-muted',
}

export default function SegmentCard({
  segment,
  now,
  tripId,
  canEdit,
  onEdit,
  onShowGate,
  onAttach,
  onOpenPaper,
  expanded = false,
}: {
  segment: Segment
  now: number
  /** the ticket whatever the face: the leg was opened from its folded line */
  expanded?: boolean
  /** the trip the leg is on, for the airport's trail; the card works without */
  tripId?: string
  canEdit: boolean
  onEdit?: (segment: Segment) => void
  onShowGate?: (segment: Segment) => void
  onAttach?: (segment: Segment, file: File) => void
  /** the paper itself, full screen — the only thing a document tap ever does */
  onOpenPaper?: (paper: Paper) => void
}) {
  const face = segmentFace(segment, now)
  const moved = delayLabel(segment)
  const glyph = MODE_GLYPH[segment.mode]
  const title = segmentName({
    carrier: segment.carrier,
    number: segment.number,
    mode: segment.mode,
  })
  const upcoming = nextDeadline(segment, now)
  const [seats, setSeats] = useState(false)
  const [trail, setTrail] = useState(false)
  const hasSeatMap = segment.mode === 'flight' && segment.passengers.some(p => parseSeat(p.seat))
  const papers = useMemo(() => papersOfSegment(segment), [segment])
  const picker = useRef<HTMLInputElement>(null)
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onAttach?.(segment, file)
  }

  if (!expanded && (face === 'future' || face === 'past')) {
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

  /* The answer, in words, on the day: built from the board's word, the delta
     and the next hard thing. On the eve the same line reads quietly under
     the columns when a board has spoken, because "is it still on" is the
     evening's question too. */
  const headline = flightHeadline(segment, now)
  const source = flightSource(segment, now)

  return (
    <div
      className="ticket overflow-hidden rounded-xl border border-line bg-raised2"
      data-face={face}
      data-tone={headline.tone}>
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[.12em] text-faint">
          {glyph} {segment.mode}
          {segment.status !== 'scheduled' && (
            <span className="ml-2 text-tight">{segment.status}</span>
          )}
          {/* By how much, next to the fact of it. "Delayed" on its own is the
              start of a question rather than an answer. */}
          {moved && <span className="ml-1.5 text-tight">{moved}</span>}
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

      {face === 'day' && (
        <div
          className={`tkhead px-3 pt-1 text-[15px] font-extrabold leading-snug ${TONE[headline.tone]}`}>
          {headline.text}
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-1.5">
        <div>
          <div className="text-lg font-extrabold tracking-[-.01em]">
            {segment.fromCode || segment.fromName}
          </div>
          {/* The old time struck through beside the new one, the way a changed
              gate has always been drawn. Without it the countdown quietly
              re-based and nothing said the plan had moved, so a traveller
              could not tell a delay from having misremembered. */}
          <div className="font-mono text-[11.5px] text-muted">
            {localTime(segment.departsAt, segment.departTz)}
            {segment.departsWas && (
              <s className="ml-1.5 text-faint">{localTime(segment.departsWas, segment.departTz)}</s>
            )}
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

      {/* The columns are the ticket: TERMINAL, GATE, CHECK-IN, the walk, the
          queue, the belt — headings always, a dash until the board says. */}
      <TicketColumns segment={segment} />

      {face === 'day' ? (
        <FlightPhases segment={segment} now={now} />
      ) : (
        segment.deadlines && (
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
        )
      )}

      {seats && <SeatMap segment={segment} onClose={() => setSeats(false)} />}
      <div className="flex flex-wrap gap-1.5 px-3 pt-2 text-[11px]">
        {segment.passengers.map(person => (
          <span key={person.name} className="rounded-md border border-line bg-canvas px-2 py-0.5">
            {person.name}
            {person.seat && <b className="ml-1">{person.seat}</b>}
          </span>
        ))}
        {hasSeatMap && (
          <button
            className="rounded-md border border-accent/40 bg-canvas px-2 py-0.5 font-bold
                       text-accent hover:bg-accent-soft"
            onClick={() => setSeats(true)}>
            Where we sit
          </button>
        )}
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

      {/* The papers, on the card, as papers. They used to be drawn twice — a
          row of paperclip chips that opened the file in another tab, and a
          Papers button onto a sheet of text inputs whose chevron did the same
          — so the leg had two doors to the same document and neither of them
          was in this app. One door now, and it opens here. */}
      {papers.length > 0 && onOpenPaper && (
        <div className="ppl px-1.5 pb-0 pt-2">
          {papers.map(paper => (
            <PaperRow key={paper.id} paper={paper} showFor={false} onOpen={onOpenPaper} />
          ))}
        </div>
      )}

      {/* Which board, how old, in its own words; a quiet board is called
          quiet rather than shown as fresh. On the eve it also carries the
          answer, in words, that the day puts on top. */}
      {source && (
        <div className="tksource px-3 pt-1.5 text-[11px] text-muted" data-quiet={source.quiet}>
          {face === 'eve' && <b className={TONE[headline.tone]}>{headline.text} · </b>}
          {source.name}
          {source.age && ` · ${source.age}`}
          {source.said && ` · ${source.said}`}
          {source.quiet && ' · has not answered since, showing what it last said'}
        </div>
      )}

      {segment.statusNote && (
        <div className="px-3 pt-1.5 text-[11px] text-tight">✦ {segment.statusNote}</div>
      )}

      {trail && tripId && <FlightTrail tripId={tripId} segment={segment} />}

      {/* Buttons that wrap as buttons: on a phone four of them do not fit one
          row, and a row that squeezed them wrapped each one's words into a
          tall block instead. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {segment.mode === 'flight' && segment.fromLng != null && onShowGate && (
          <button
            className="whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-ink"
            onClick={() => onShowGate(segment)}>
            Show gate on the map
          </button>
        )}
        {face === 'day' && segment.flight && tripId && (
          <button
            className="whitespace-nowrap rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-bold"
            aria-expanded={trail}
            onClick={() => setTrail(open => !open)}>
            {trail ? 'Hide the trail' : 'What the airport said'}
          </button>
        )}
        {canEdit && onAttach && (
          <>
            <input
              ref={picker}
              type="file"
              accept="image/*,application/pdf"
              hidden
              onChange={pick}
            />
            <button
              className="whitespace-nowrap rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-bold"
              onClick={() => picker.current?.click()}>
              Add a paper
            </button>
          </>
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
