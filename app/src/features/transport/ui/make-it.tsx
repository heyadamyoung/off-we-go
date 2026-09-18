import { localTime, makeIt, segmentFace, segmentName, type Segment } from '../../../segments-core'

/* The make-it meter: the next departure against everyone's live position.
   Only rendered on a travel day, only when the leg has coordinates and
   somebody has a fix — the capsule that answers the only question a family
   asks in an airport. The walk from the door to the gate, when the airport's
   board says how long it is, is counted against everybody; whoever is still
   away is told when to leave. */

export default function MakeIt({
  segments,
  travellers,
  now,
}: {
  segments: Segment[]
  travellers: Array<{ name: string; lng: number; lat: number }>
  now: number
}) {
  const next = segments.find(
    segment => segmentFace(segment, now) === 'day' && new Date(segment.departsAt).getTime() > now,
  )
  if (!next || !travellers.length) return null
  const verdicts = makeIt(next, travellers, now, { walkMinutes: next.flight?.walkMinutes ?? 0 })
  if (!verdicts || verdicts.minutesLeft > 6 * 60 || verdicts.minutesLeft < -30) return null

  /* "KL 677", not "KLM KL 677": the number carries the airline, and the
     ticket and the pill already say it once. */
  const said = segmentName({ carrier: next.carrier, number: next.number })
  const label = said === 'Journey' ? next.toName : said
  const hours = Math.floor(Math.abs(verdicts.minutesLeft) / 60)
  const minutes = Math.abs(verdicts.minutesLeft) % 60
  const clock = `${hours ? `${hours} h ` : ''}${minutes} m`
  const stateWord = { here: 'here', ok: 'on pace', tight: 'tight', late: 'too far out' }

  return (
    <div className="glass pointer-events-none rounded-2xl border border-accent/35 px-3.5 py-2.5 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <b className="text-[13px]">
          {label} — {verdicts.hardLabel} in
        </b>
        <span className="font-mono text-accent">{clock}</span>
      </div>
      {verdicts.walkMinutes > 0 && (
        <div className="mt-0.5 text-[11px] text-muted">
          {verdicts.walkMinutes} min from the door to the gate, counted
        </div>
      )}
      <div className="mt-1.5 flex flex-col gap-1">
        {verdicts.people.map(person => (
          <div key={person.name} className="flex items-center gap-2 text-muted">
            <span
              className={
                'h-1.5 w-1.5 flex-none rounded-full ' +
                (person.state === 'late'
                  ? 'bg-tight'
                  : person.state === 'tight'
                    ? 'bg-accent'
                    : 'bg-ok')
              }
            />
            <b className="text-ink">{person.name}</b>
            {person.state === 'here'
              ? 'here'
              : `${person.minutesAway} min away · ${stateWord[person.state]}`}
            {person.leaveBy && (
              <span className="mkleave ml-auto font-mono text-[11px] text-faint">
                leave by {localTime(person.leaveBy, next.departTz)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
