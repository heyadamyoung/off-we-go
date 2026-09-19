import { Fragment, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { aircraftName } from '../../../cabin-core'
import { flightSource } from '../../../flight-day-core'
import { flightTimeLeft } from '../../../flight-left-core'
import { papersOfSegment, type Paper } from '../../../papers-core'
import { parseSeat } from '../../../seatmap-core'
import {
  DEADLINE_LABELS,
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
import TicketDoor from './ticket-door'

/* One leg, wearing the face the clock chooses. future: a quiet line.
   eve: the ticket — where, when, the columns the board has filled in. day:
   the ticket with the answer on top of it, the phases, and the airport's
   word. past: a line in the journal. Nobody configures this; the hour does.
   Opened from its folded line in the chain, a future or past leg shows its
   ticket too — that is what the tap asked for.

   What is on the card is what is known, laid out so that it reads the same
   on a 360-pixel phone and in a 440-pixel panel: a headline that wraps only
   between its phrases, never inside "2 h 57"; phases dealt in equal rows;
   buttons in two columns on a phone, so none of them is ever alone on a
   line; the cost and the board's name on one quiet line. */

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
/* On a phone every button fills its half of the row and an odd last one
   fills the row; from a tablet up they sit in a row at their own width. */
const actions =
  'tkactions grid grid-cols-2 gap-2 px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center ' +
  '[&>:last-child:nth-child(odd)]:col-span-2'
/* A label wraps inside its half of a narrow phone rather than running out
   of its button; at a desk every label fits on one line. */
const button =
  'rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs font-bold leading-snug sm:whitespace-nowrap sm:px-3 sm:py-1.5'

/* "On time · gate D43 · check-in closes in 2 h 57" as phrases: a line breaks
   between them, never in the middle of a time. */
function Headline({ text, className }: { text: string; className: string }) {
  const pieces = text.split(' · ')
  /* The separator sits between the phrases as ordinary text, so its spaces
     are where a line may break; inside a nowrap span they would not be. */
  return (
    <div className={className}>
      {pieces.map((piece, index) => (
        <Fragment key={piece}>
          {index > 0 && <span className="text-faint"> · </span>}
          <span className="whitespace-nowrap">{piece}</span>
        </Fragment>
      ))}
    </div>
  )
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
  onOpen,
  expanded = false,
}: {
  segment: Segment
  now: number
  /** the ticket whatever the face: the leg was opened from its folded line */
  expanded?: boolean
  /** the leg's own screen — a tap on the route, or the Full details button */
  onOpen?: (segment: Segment) => void
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

  /* How long there is, on the day: to the next thing, then to leaving, then
     to the ground. Only what the ticket cannot say — a landing time is in
     the far end's clock, and nobody in the air wants to do that sum. */
  const headline = flightTimeLeft(segment, now)
  const source = flightSource(segment, now)
  /* Which aircraft, as the booking, the board or the transponder named it;
     the seat map draws that cabin. */
  const named = aircraftName(segment.aircraft || segment.flight?.aircraft)
  const usual = named ? null : aircraftName(segment.flight?.usualAircraft)
  const aircraft = named || (usual ? `${usual} · usually` : null)
  /* The watch's own sentence is already the headline and the columns; it is
     drawn only when somebody typed a note of their own. */
  const note =
    segment.statusNote && segment.statusNote !== segment.flight?.note ? segment.statusNote : null
  const bags = segment.bags?.checked || segment.bags?.carryOn ? segment.bags : null
  const cost =
    segment.costAmount != null ? `${segment.costAmount} ${segment.costCurrency || ''}`.trim() : null
  const showGate = segment.mode === 'flight' && segment.fromLng != null && !!onShowGate

  return (
    <div
      className="ticket overflow-hidden rounded-xl border border-line bg-raised2"
      data-face={face}
      data-tone={headline.tone}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <span className="min-w-0 text-[10px] font-bold uppercase leading-snug tracking-[.12em] text-faint">
          {glyph} {segment.mode}
          {/* Only the words the ticket has no other way to say. A delay is
              the old time struck through beside the new one, and saying
              "delayed 25 min later" above that said it three times. */}
          {segment.status === 'cancelled' && <span className="ml-2 text-tight">cancelled</span>}
          {segment.status !== 'cancelled' && segment.flight?.status === 'diverted' && (
            <span className="ml-2 text-tight">diverted</span>
          )}
        </span>
        <span className="flex flex-none items-center gap-1.5">
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
        <Headline
          text={headline.text}
          className={`tkhead px-3 pt-1 text-[15px] font-extrabold leading-snug ${TONE[headline.tone]}`}
        />
      )}

      {/* The route is the door to the leg's own screen: a tap on where it
          goes opens the airline-app view of it, with the same facts and a
          whole screen to say them in. */}
      <TicketDoor
        open={onOpen ? () => onOpen(segment) : undefined}
        label={`Open ${title}`}
        className="grid w-full grid-cols-[1fr_auto_1fr] items-start gap-2 px-3 pt-1.5 text-left">
        <div className="min-w-0">
          <div className="text-lg font-extrabold leading-tight tracking-[-.01em]">
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
        <div className="min-w-0 pt-1 text-center text-[11px] leading-tight text-faint">
          {segment.carrier}
          <div className="text-xs font-bold text-ink">{segment.number}</div>
          {aircraft && <div className="tkcraft mt-0.5 text-[10px]">{aircraft}</div>}
          {/* The door's handle: the route is a button, and this says so. */}
          {onOpen && <div className="tkmore mt-1 text-[10px] font-bold text-accent">Details ›</div>}
        </div>
        <div className="min-w-0 text-right">
          <div className="text-lg font-extrabold leading-tight tracking-[-.01em]">
            {segment.toCode || segment.toName}
          </div>
          <div className="font-mono text-[11.5px] text-muted">
            {localTime(segment.arrivesAt, segment.arriveTz)}
          </div>
        </div>
      </TicketDoor>

      {/* The columns are the ticket: TERMINAL, GATE, CHECK-IN, the walk, the
          queue, BAGGAGE CLAIM — what is known, and a dash under the gate
          until it is. */}
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
                <div key={key} className="min-w-0 flex-1 text-center">
                  <div className="truncate text-[9px] font-bold uppercase tracking-[.06em] text-faint">
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

      {seats && <SeatMap segment={segment} tripId={tripId} onClose={() => setSeats(false)} />}
      {segment.passengers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 text-[11px]">
          {segment.passengers.map(person => (
            <span key={person.name} className={chip}>
              {person.name}
              {person.seat && <b className="ml-1">{person.seat}</b>}
            </span>
          ))}
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

      {/* Which board, how old, and what the leg cost, on one quiet line; a
          quiet board is called quiet rather than shown as fresh. On the eve
          the line also carries the answer, in words, that the day puts on
          top. The board's own status word is not repeated — the headline
          already said it in ours. */}
      {(source || cost) && (
        <div className="flex items-baseline justify-between gap-3 px-3 pt-1.5 text-[11px] text-muted">
          {source ? (
            <span className="tksource min-w-0" data-quiet={source.quiet}>
              {face === 'eve' && <b className={TONE[headline.tone]}>{headline.text} · </b>}
              {source.name}
              {source.age && ` · ${source.age}`}
              {source.quiet && ' · has not answered since, showing what it last said'}
            </span>
          ) : (
            <span />
          )}
          {cost && (
            <span className="tkcost flex-none font-mono text-[10.5px] text-faint">{cost}</span>
          )}
        </div>
      )}

      {note && <div className="tknote px-3 pt-1.5 text-[11px] text-tight">✦ {note}</div>}

      {trail && tripId && <FlightTrail tripId={tripId} segment={segment} />}

      {canEdit && onAttach && (
        <input ref={picker} type="file" accept="image/*,application/pdf" hidden onChange={pick} />
      )}
      <div className={actions}>
        {showGate && (
          <button
            className="rounded-lg border border-transparent bg-accent px-2.5 py-2 text-xs font-bold leading-snug text-accent-ink sm:whitespace-nowrap sm:px-3 sm:py-1.5"
            onClick={() => onShowGate?.(segment)}>
            Show gate on the map
          </button>
        )}
        {hasSeatMap && (
          <button className={button} onClick={() => setSeats(true)}>
            Where we sit
          </button>
        )}
        {face === 'day' && segment.flight && tripId && (
          <button className={button} aria-expanded={trail} onClick={() => setTrail(open => !open)}>
            {trail ? 'Hide the trail' : 'What the airport said'}
          </button>
        )}
        {canEdit && onAttach && (
          <button className={button} onClick={() => picker.current?.click()}>
            Add a paper
          </button>
        )}
      </div>
    </div>
  )
}
