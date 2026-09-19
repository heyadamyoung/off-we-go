import { type ReactNode, useState } from 'react'
import type { Paper } from '../../../papers-core'
import {
  connectionGap,
  localTime,
  MODE_GLYPH,
  segmentName,
  type Segment,
} from '../../../segments-core'
import { byDeparture, legDay, travelLayout } from '../../../travel-order-core'
import Icon from '../../../shared/ui/icon'
import FlightScreen from './flight-screen'
import SegmentCard from './segment-card'

/* The travel day read from where you are in it: the leg that matters now on
   top, as its ticket; the legs still to come folded to a line each, in the
   order they leave, with the gap before each judging itself; then, under
   "Earlier", the ones behind you. A folded leg opens to its ticket on a tap
   and folds again on another. The chain is the design thesis — competitors
   silo the modes; travel days are sequences of getting-there. */

interface ChainProps {
  /** the trip the legs are on, for the airport's trail behind a ticket */
  tripId?: string
  segments: Segment[]
  now: number
  canEdit: boolean
  onEdit: (segment: Segment) => void
  /** taken by the Travel panel's header action; the chain itself never adds */
  onAdd: () => void
  onShowGate: (segment: Segment) => void
  onAttach: (segment: Segment, file: File) => void
  onOpenPaper?: (paper: Paper) => void
}

const VERDICT = { roomy: 'roomy', tight: 'tight', short: 'too short' } as const

function Gap({ gap }: { gap: ReturnType<typeof connectionGap> | null }) {
  if (!gap || gap.minutes <= 0 || gap.minutes >= 12 * 60) return null
  const hours = Math.floor(gap.minutes / 60)
  return (
    <div className="pl-2 text-[11px] text-muted">
      ↳ {hours ? `${hours} h ` : ''}
      {gap.minutes % 60} m to change —{' '}
      <b className={gap.verdict === 'short' ? 'text-tight' : ''}>{VERDICT[gap.verdict]}</b>
    </div>
  )
}

/* Two lines for a leg that is not the one that matters now: what it is and
   when it leaves, then where it goes — and the ticket under it once tapped.
   One line held "Air Canada Rouge AC1924 · YQR → YYZ · Thu 3 Sept · 14:15"
   only by wrapping the name and cutting the route to "YQR …" on a phone. */
function LegFold({
  leg,
  open,
  onToggle,
  children,
}: {
  leg: Segment
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const name = segmentName({ carrier: leg.carrier, number: leg.number, mode: leg.mode })
  const where = `${leg.fromCode || leg.fromName} → ${leg.toCode || leg.toName}`
  return (
    <div
      className="legfold overflow-hidden rounded-xl border border-line bg-raised2"
      data-leg={leg.id}
      data-open={open}>
      <button
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-0.5 px-3 py-2.5 text-left text-xs hover:bg-raised"
        aria-expanded={open}
        onClick={onToggle}>
        <span aria-hidden="true">{MODE_GLYPH[leg.mode]}</span>
        <b className="legname min-w-0 truncate font-semibold">{name}</b>
        <span className="whitespace-nowrap font-mono text-[11px] text-faint">
          {legDay(leg.departsAt, leg.departTz)} · {localTime(leg.departsAt, leg.departTz)}
        </span>
        <Icon n={open ? 'chevd' : 'chev'} s={12} className="text-muted" />
        <span className="legroute col-start-2 col-end-4 min-w-0 truncate text-muted">{where}</span>
      </button>
      {open && (
        <div className="border-t border-line [&>.ticket]:rounded-none [&>.ticket]:border-0">
          {children}
        </div>
      )}
    </div>
  )
}

export default function SegmentChain(props: ChainProps) {
  const { segments, now } = props
  const [open, setOpen] = useState<Record<string, boolean>>({})
  /* The leg whose own screen is up, by id: the legs refresh under it every
     minute, and the screen reads the fresh one. */
  const [shown, setShown] = useState<string | null>(null)
  const shownLeg = shown ? segments.find(leg => leg.id === shown) : undefined
  if (!segments.length) return null
  const { active, later, earlier } = travelLayout(segments, now)
  const ordered = byDeparture(segments)
  const gapBefore = (leg: Segment) => {
    const previous = ordered[ordered.indexOf(leg) - 1]
    return previous ? connectionGap(previous, leg) : null
  }
  const card = (leg: Segment, expanded = false) => (
    <SegmentCard
      segment={leg}
      expanded={expanded}
      now={now}
      tripId={props.tripId}
      canEdit={props.canEdit}
      onEdit={props.onEdit}
      onShowGate={props.onShowGate}
      onAttach={props.onAttach}
      onOpenPaper={props.onOpenPaper}
      onOpen={leg => setShown(leg.id)}
    />
  )
  const fold = (leg: Segment) => (
    <LegFold
      key={leg.id}
      leg={leg}
      open={!!open[leg.id]}
      onToggle={() => setOpen(current => ({ ...current, [leg.id]: !current[leg.id] }))}>
      {card(leg, true)}
    </LegFold>
  )

  return (
    <section className="mb-4 flex flex-col gap-2">
      {shownLeg && (
        <FlightScreen
          segment={shownLeg}
          now={now}
          canEdit={props.canEdit}
          onClose={() => setShown(null)}
          onEdit={props.onEdit}
          onShowGate={props.onShowGate}
          onOpenPaper={props.onOpenPaper}
        />
      )}
      {active && card(active)}
      {later.map(leg => (
        <div key={leg.id} className="flex flex-col gap-2">
          <Gap gap={gapBefore(leg)} />
          {fold(leg)}
        </div>
      ))}
      {earlier.length > 0 && (
        <>
          <div className="mt-2 px-1 text-[10px] font-bold uppercase tracking-[.12em] text-faint">
            Earlier
          </div>
          {earlier.map(leg => fold(leg))}
        </>
      )}
    </section>
  )
}
