import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { flightScreen, type ScreenEnd } from '../../../flight-screen-core'
import { papersOfSegment, type Paper } from '../../../papers-core'
import { MODE_GLYPH, type Segment } from '../../../segments-core'
import { parseSeat } from '../../../seatmap-core'
import Icon from '../../../shared/ui/icon'
import PaperRow from '../../../shared/ui/paper-row'
import SeatMap from './seat-map'

/* The leg's own screen, over everything: what an airline's app shows when
   you open a flight, for every leg on the trip whatever the carrier. The
   ticket on the Travel tab stays as it is; a tap on it comes here, where
   the same facts have a whole screen — the two ends large, the board as a
   board, the day as a list with a note under each step, the people, the
   bags, the papers. Escape and the arrow both go back to the tab. */

const TONE: Record<string, string> = {
  ok: 'text-ok',
  tight: 'text-accent',
  late: 'text-tight',
  done: 'text-ok',
  quiet: 'text-muted',
}

const STEP_DOT: Record<string, string> = {
  done: 'bg-ok border-ok',
  now: 'bg-accent border-accent',
  later: 'bg-canvas border-line2',
}

function End({ end, align }: { end: ScreenEnd; align: 'left' | 'right' }) {
  const side = align === 'right' ? 'text-right items-end' : 'text-left items-start'
  return (
    <div className={`fsend flex min-w-0 flex-col ${side}`}>
      <div className="text-[34px] font-extrabold leading-none tracking-[-.03em]">{end.code}</div>
      <div className="mt-1 truncate text-xs text-muted">{end.name}</div>
      <div className="mt-2 font-mono text-lg font-bold leading-none">
        {end.time || '—'}
        {end.was && <s className="ml-1.5 text-xs font-normal text-faint">{end.was}</s>}
      </div>
      {end.day && <div className="mt-1 text-[11px] text-faint">{end.day}</div>}
    </div>
  )
}

export default function FlightScreen({
  segment,
  now,
  canEdit,
  onClose,
  onEdit,
  onShowGate,
  onOpenPaper,
}: {
  segment: Segment
  now: number
  canEdit: boolean
  onClose: () => void
  onEdit?: (segment: Segment) => void
  onShowGate?: (segment: Segment) => void
  onOpenPaper?: (paper: Paper) => void
}) {
  const model = useMemo(() => flightScreen(segment, now), [segment, now])
  const papers = useMemo(() => papersOfSegment(segment), [segment])
  const [seats, setSeats] = useState(false)
  const titleId = useId()
  const hasSeatMap = segment.mode === 'flight' && segment.passengers.some(p => parseSeat(p.seat))
  const showGate = segment.mode === 'flight' && segment.fromLng != null && !!onShowGate

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  /* Through a portal onto the body: rendered where the tap was, inside the
     panel, the screen inherited the panel's stacking context and the trip's
     top bar drew over its own back button. */
  return createPortal(
    <div
      className="flightscreen fixed inset-0 z-[150] flex flex-col bg-canvas text-ink"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-tone={model.status.tone}>
      <div
        className="flex flex-none items-center gap-2 border-b border-line px-3 pb-2.5
                      pt-[calc(.625rem+env(safe-area-inset-top,0px))]">
        <button
          className="hitslop grid size-9 place-items-center rounded-lg text-muted hover:bg-raised2 hover:text-ink"
          onClick={onClose}
          aria-label="Back to the Travel tab">
          <Icon n="chevl" s={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="m-0 truncate text-base font-extrabold tracking-[-.01em]">
            <span aria-hidden="true">{MODE_GLYPH[segment.mode]} </span>
            {model.title}
          </h2>
          <div className="truncate text-[11px] text-muted">{model.date}</div>
        </div>
        {canEdit && onEdit && (
          <button
            className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11px] font-bold"
            onClick={() => onEdit(segment)}>
            Edit
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div
          className="mx-auto flex w-full max-w-[600px] flex-col gap-4 px-4 pt-4
                        pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
          <div
            className={`fsstatus text-[17px] font-extrabold leading-snug ${TONE[model.status.tone]}`}>
            {model.status.text}
          </div>

          <div className="fsroute grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-line bg-raised2 p-4">
            <End end={model.from} align="left" />
            <div className="flex flex-col items-center gap-1 text-center text-[11px] text-faint">
              <Icon n="plane" s={18} className="text-muted" />
              {model.duration && <span className="font-mono">{model.duration}</span>}
              {model.aircraft && <span className="fscraft max-w-[110px]">{model.aircraft}</span>}
            </div>
            <End end={model.to} align="right" />
          </div>

          {model.board.length > 0 && (
            <section className="fsboard rounded-2xl border border-line bg-raised2 p-4">
              <h3 className="m-0 mb-3 text-[11px] font-extrabold uppercase tracking-[.1em] text-faint">
                At the airport
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {model.board.map(column => (
                  <div key={column.key} className="fscol min-w-0" data-key={column.key}>
                    <div className="text-[10px] font-bold uppercase tracking-[.06em] text-faint">
                      {column.label}
                    </div>
                    <div
                      className={
                        'text-base font-extrabold leading-tight ' +
                        (column.value
                          ? column.key === 'gate'
                            ? 'text-accent'
                            : 'text-ink'
                          : 'text-faint')
                      }>
                      {column.value || '—'}
                      {column.was && (
                        <s className="ml-1.5 text-xs font-normal text-faint">{column.was}</s>
                      )}
                    </div>
                    {!column.value && column.hint && (
                      <div className="text-[11px] text-faint">{column.hint}</div>
                    )}
                  </div>
                ))}
              </div>
              {showGate && (
                <button
                  className="btn btn-accent mt-4 w-full justify-center"
                  onClick={() => {
                    onClose()
                    onShowGate?.(segment)
                  }}>
                  Show the gate on the map
                </button>
              )}
            </section>
          )}

          {model.steps.length > 0 && (
            <section className="fssteps rounded-2xl border border-line bg-raised2 p-4">
              <h3 className="m-0 mb-3 text-[11px] font-extrabold uppercase tracking-[.1em] text-faint">
                The day
              </h3>
              <ol className="m-0 list-none p-0">
                {model.steps.map((step, index) => (
                  <li
                    key={step.key}
                    className="fsstep relative flex gap-3 pb-4 last:pb-0"
                    data-state={step.state}>
                    {index < model.steps.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute left-[7px] top-4 h-full w-px bg-line"
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className={`relative mt-1 size-[15px] flex-none rounded-full border-2 ${STEP_DOT[step.state]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <b
                          className={
                            'text-sm ' +
                            (step.state === 'now'
                              ? 'text-accent'
                              : step.state === 'done'
                                ? 'text-muted'
                                : 'text-ink')
                          }>
                          {step.label}
                        </b>
                        <span
                          className={
                            'font-mono text-sm ' +
                            (step.state === 'done'
                              ? 'text-ok'
                              : step.state === 'now'
                                ? 'font-bold text-accent'
                                : 'text-ink')
                          }>
                          {step.clock || '—'}
                        </span>
                      </div>
                      {step.note && <div className="text-xs text-muted">{step.note}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {(model.people.length > 0 || model.bags) && (
            <section className="fspeople rounded-2xl border border-line bg-raised2 p-4">
              <h3 className="m-0 mb-3 text-[11px] font-extrabold uppercase tracking-[.1em] text-faint">
                Who and what
              </h3>
              {model.people.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {model.people.map(person => (
                    <span
                      key={person.name}
                      className="rounded-md border border-line bg-canvas px-2 py-1">
                      {person.name}
                      {person.seat && <b className="ml-1">{person.seat}</b>}
                    </span>
                  ))}
                </div>
              )}
              {model.bags && <div className="mt-2 text-xs text-muted">{model.bags}</div>}
              {hasSeatMap && (
                <button
                  className="btn btn-ghost mt-3"
                  onClick={() => setSeats(true)}
                  aria-expanded={seats}>
                  Where we sit
                </button>
              )}
              {seats && <SeatMap segment={segment} onClose={() => setSeats(false)} />}
            </section>
          )}

          {papers.length > 0 && onOpenPaper && (
            <section className="fspapers rounded-2xl border border-line bg-raised2 p-2.5">
              <h3 className="m-0 mb-1 px-1.5 pt-1 text-[11px] font-extrabold uppercase tracking-[.1em] text-faint">
                Papers
              </h3>
              <div className="ppl">
                {papers.map(paper => (
                  <PaperRow key={paper.id} paper={paper} showFor={false} onOpen={onOpenPaper} />
                ))}
              </div>
            </section>
          )}

          {(model.ref || model.cost || model.source || model.note) && (
            <section className="fsmeta flex flex-col gap-1.5 px-1 text-xs text-muted">
              {model.note && <div className="text-tight">✦ {model.note}</div>}
              {model.ref && (
                <div>
                  Booking reference{' '}
                  <button
                    className="rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink"
                    title="Copy the booking reference"
                    onClick={() => navigator.clipboard?.writeText(model.ref || '').catch(() => {})}>
                    {model.ref}
                  </button>
                </div>
              )}
              {model.cost && <div>Cost {model.cost}</div>}
              {model.source && (
                <div className="fssource" data-quiet={model.source.quiet}>
                  {model.source.name}
                  {model.source.age && ` · ${model.source.age}`}
                  {model.source.quiet && ' · has not answered since, showing what it last said'}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
