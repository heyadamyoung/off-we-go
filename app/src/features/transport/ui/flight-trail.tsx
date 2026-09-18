import { useEffect, useState } from 'react'
import { loadSegmentFlight, type FlightTrailEvent } from '../../../backend'
import { boardName } from '../../../flight-day-core'
import { localTime, type Segment } from '../../../segments-core'

/* What the airport said, newest first, opened on demand. The ticket shows
   the board's latest word; this is the record behind it — every gate, delay
   and landing the watch wrote down, with the time it said so in the
   airport's own clock — so a wrong one can be understood afterwards. */

export default function FlightTrail({ tripId, segment }: { tripId: string; segment: Segment }) {
  const [events, setEvents] = useState<FlightTrailEvent[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    loadSegmentFlight(tripId, segment.id)
      .then(found => {
        if (alive) setEvents(found.events)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [tripId, segment.id])

  const quiet = (text: string) => (
    <p className="tktrail px-3 pt-1.5 text-[11px] text-muted">{text}</p>
  )
  if (failed) return quiet('The airport’s trail could not be reached.')
  if (!events) return quiet('Asking the airport…')
  if (!events.length) return quiet('Nothing from the airport yet.')
  return (
    <ul className="tktrail m-0 flex list-none flex-col gap-1 px-3 pt-1.5 text-[11px]">
      {events.map(event => (
        <li key={event.id} className="flex gap-2">
          <span className="tnum shrink-0 font-mono text-faint">
            {localTime(event.at, segment.departTz)}
          </span>
          <span className="min-w-0">
            {event.text}
            <span className="text-faint"> · {boardName(event.source)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
