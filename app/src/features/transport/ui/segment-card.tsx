import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { aircraftName } from '../../../cabin-core'
import { arrivalLine, flightHeadline, flightSource } from '../../../flight-day-core'
import { papersOfSegment, type Paper } from '../../../papers-core'
import { parseSeat } from '../../../seatmap-core'
import {
  DEADLINE_LABELS,
  delayLabel,
  localTime,
  MODE_GLYPH,
  nextDeadline,
  segmentFace,
  segmentName,
  type Segment,
  type SegmentDeadlines,
} from '../../../segments-core'
import PaperRow from '../../../shared/ui/paper-row'
import FlightPhases from './flight-phases'
import FlightTrail from './flight-trail'
import SeatMap from './seat-map'
import TicketColumns from './ticket-columns'

/* One leg, wearing the face the clock chooses. future: a quiet line.
   eve: the ticket — where, when, the columns the board has filled in. day:
   the ticket with the answer on top of it, the phases, and the airport's
   word. past: a line in the journal. Nobody configures this; the hour does.
   Opened from its folded line in the chain, a future or past leg shows its
   ticket too — that is what the tap asked for.

   What is on the card is what is known. A dash under a heading the board
   has not filled in, a stand number, the board's own sentence repeated
   under a headline that already said it, and its raw status code at the
   end of the line: each was one more thing to read past on the way to the
   gate, and together they read as a card that was broken. */

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

const chip = 'rounded-md border border-line bg-canvas px-2 py-0.5'
const button =
  'whitespace-nowrap rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-bold'

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
  /* Which aircraft, as the booking, the board or the transponder named it;
     the seat map draws that cabin. */
  const aircraft = aircraftName(segment.aircraft || segment.flight?.aircraft)
  const far = arrivalLine(segment)
  /* The watch's own sentence is already the headline and the columns; it is
     drawn only when somebody typed a note of their own. */
  const note =
    segment.statusNote && segment.statusNote !== segment.flight?.note ? segment.statusNote : null
  const bags = segment.bags?.checked || segment.bags?.carryOn ? segment.bags : null

  return (
    <div
      className="ticket overflow-hidden rounded-xl border border-line bg-raised2"
      data-face={face}
      data-tone={headline.tone}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[.12em] text-faint">
          {glyph} {segment.mode}
          {segment.status !== 'scheduled' && (
            <span className="ml-2 text-tight">{segment.status}</span>
          )}
          {/* By how much, next to the fact of it. "Delayed" on its own is the
              start of a question rather than an answer. */}
          {moved && <span className="ml-1.5 text-tight">{moved}</span>}
        </span>
        <span className="flex items-center gap-1.5">
          {segment.ref && (
            <button
              className="hitslop rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px]"
              title="Copy the booking reference"
              onClick={() => navigator.clipboard?.writeText(segment.ref || '').catch(() => {})}>
              {segment.ref}
            </button>
          )}
          {/* Editing is housekeeping, not the day's business: a small word
              in the corner, not a third button in the row you act from. */}
          {canEdit && onEdit && (
            <button
              className="hitslop rounded-md border border-line bg-canvas px-2 py-0.5 text-[11px] font-bold"
              onClick={() => onEdit(segment)}>
              Edit
            </button>
          )}
        </span>
      </div>

      {face === 'day' && (
        <div
          className={`tkhead px-3 pt-1 text-[15px] font-extrabold leading-snug ${TONE[headline.tone]}`}>
          {headline.text}
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-3 pt-1.5">
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
        <div className="pt-1 text-center text-[11px] leading-tight text-faint">
          {segment.carrier}
          <div className="text-xs font-bold text-ink">{segment.number}</div>
          {aircraft && <div className="tkcraft mt-0.5 text-[10px]">{aircraft}</div>}
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold tracking-[-.01em]">
            {segment.toCode || segment.toName}
          </div>
          <div className="font-mono text-[11.5px] text-muted">
            {localTime(segment.arrivesAt, segment.arriveTz)}
          </div>
          {/* The far end's word, under the far end: the belt is where the
              bags come out at the airport you land at, not a column among
              the leaving. */}
          {far && <div className="tkfar text-[10.5px] leading-tight text-muted">{far}</div>}
        </div>
      </div>

      {/* The columns are the ticket: TERMINAL, GATE, CHECK-IN, the walk, the
          queue — what is known, and a dash under the gate until it is. */}
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
      {(segment.passengers.length > 0 || hasSeatMap) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 text-[11px]">
          {segment.passengers.map(person => (
            <span key={person.name} className={chip}>
              {person.name}
              {person.seat && <b className="ml-1">{person.seat}</b>}
            </span>
          ))}
          {hasSeatMap && (
            <button
              className="ml-auto whitespace-nowrap rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11px] font-bold"
              onClick={() => setSeats(true)}>
              Where we sit
            </button>
          )}
        </div>
      )}
      {/* The allowance, as a line rather than two chips: what the booking
          said, read once the evening before while the bags are packed. */}
      {face === 'eve' && bags && (
        <div className="tkbags px-3 pt-1.5 text-[11px] text-muted">
          {bags.checked && (
            <span>
              Checked <b className="text-ink">{bags.checked}</b>
            </span>
          )}
          {bags.checked && bags.carryOn && ' · '}
          {bags.carryOn && (
            <span>
              Carry-on <b className="text-ink">{bags.carryOn}</b>
            </span>
          )}
        </div>
      )}

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

      {/* Which board, how old; a quiet board is called quiet rather than
          shown as fresh. On the eve it also carries the answer, in words,
          that the day puts on top. The board's own status word is not
          repeated after it — the headline already said it in ours. */}
      {source && (
        <div className="tksource px-3 pt-1.5 text-[11px] text-muted" data-quiet={source.quiet}>
          {face === 'eve' && <b className={TONE[headline.tone]}>{headline.text} · </b>}
          {source.name}
          {source.age && ` · ${source.age}`}
          {source.quiet && ' · has not answered since, showing what it last said'}
        </div>
      )}

      {note && <div className="tknote px-3 pt-1.5 text-[11px] text-tight">✦ {note}</div>}

      {trail && tripId && <FlightTrail tripId={tripId} segment={segment} />}

      {/* Buttons that wrap as buttons: on a phone three of them do not fit
          one row, and a row that squeezed them wrapped each one's words into
          a tall block instead. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {segment.mode === 'flight' && segment.fromLng != null && onShowGate && (
          <button
            className="whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-ink"
            onClick={() => onShowGate(segment)}>
            Show gate on the map
          </button>
        )}
        {face === 'day' && segment.flight && tripId && (
          <button className={button} aria-expanded={trail} onClick={() => setTrail(open => !open)}>
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
            <button className={button} onClick={() => picker.current?.click()}>
              Add a paper
            </button>
          </>
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
