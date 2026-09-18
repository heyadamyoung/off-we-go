import { flightPhases } from '../../../flight-day-core'
import type { Segment } from '../../../segments-core'

/* The day as phases: check-in, bags, to the gate, boarding, doors, then
   leaving and landing — each done with a tick, now in colour with its time,
   or later with its time. The deadlines are the app's; the board's own
   go-to-gate time joins them when it gives one, and leaving and landing are
   the board's to call, never the clock's. */

export default function FlightPhases({ segment, now }: { segment: Segment; now: number }) {
  const phases = flightPhases(segment, now)
  if (!phases.length) return null
  return (
    <div className="tkphases mx-3 mt-2.5 grid grid-cols-4 gap-y-2 border-t border-dashed border-line pt-2 pb-1">
      {phases.map(phase => (
        <div key={phase.key} className="tkphase text-center" data-state={phase.state}>
          <div className="text-[9px] font-bold uppercase tracking-[.06em] text-faint">
            {phase.label}
          </div>
          <div
            className={
              'font-mono text-xs ' +
              (phase.state === 'done'
                ? 'text-ok'
                : phase.state === 'now'
                  ? 'font-bold text-accent'
                  : 'text-ink')
            }>
            {phase.clock || '—'}
          </div>
        </div>
      ))}
    </div>
  )
}
