import { useEffect, useRef, useState } from 'react'
import { loadCabin, loadSegmentPosition } from '../../../backend-segments'
import { aircraftFamily, aircraftName } from '../../../cabin-core'
import { type AirlineCabin, airlineCodeOf, seatsFit } from '../../../cabin-library-core'
import {
  cabinFor,
  cabinGeometry,
  classOf,
  isCabinPlan,
  type NoCabin,
  parseSeat,
  SEAT,
} from '../../../seatmap-core'
import type { Segment } from '../../../segments-core'
import Sheet from '../../../shared/ui/sheet'

/* The cabin, drawn from the booking: a schematic fuselage with every booked
   seat lit and initialled, the wing shaded so "over the wing" is visible, and
   exits marked. When the server has the airline's own configuration for the
   type, the cabin is that one: business at two across up front, premium
   economy behind it, economy from row 12, the doors where the airline puts
   them, the wing under the rows it is under. When only the aircraft is
   named, the cabin is that type's cross-section and about its length.
   Honest about the rest: representative, not this registration's chart. */

/* Which aircraft, when neither the booking nor a board has said: the sky is
   asked, once, when the sheet opens. Through the flying window the
   transponder names this leg's own aircraft; before it, whatever answers to
   the callsign is the number's earlier rotation, and its type is what this
   leg will usually fly — said as that. The watch writes the same answers
   onto the leg for everybody in a while; this is for the family looking now. */
interface Heard {
  type: string | null
  usual: boolean
  /** what became of the ask, when it named no type: the sheet says so */
  reason: string | null
  callsign: string | null
}

function useHeardType(tripId: string | undefined, segment: Segment): Heard {
  const [heard, setHeard] = useState<Heard>({
    type: null,
    usual: false,
    reason: null,
    callsign: null,
  })
  const known = !!(segment.aircraft || segment.flight?.aircraft)
  useEffect(() => {
    if (!tripId || known) return
    let alive = true
    loadSegmentPosition(tripId, segment.id)
      .then(found => {
        if (!alive) return
        const callsign = found.callsign
        if (found.aircraft?.type)
          setHeard({ type: found.aircraft.type, usual: false, reason: null, callsign })
        else if (found.usual) setHeard({ type: found.usual, usual: true, reason: null, callsign })
        else if (found.aircraft) setHeard({ type: null, usual: false, reason: 'no-type', callsign })
        else setHeard({ type: null, usual: false, reason: found.reason, callsign })
      })
      .catch(() => {
        if (alive) setHeard({ type: null, usual: false, reason: 'unavailable', callsign: null })
      })
    return () => {
      alive = false
    }
  }, [tripId, known, segment.id])
  return heard
}

/* Why the cabin is a guess, in words that say what to do: the sky was
   asked, and this is what came back. */
function askOutcome(heard: Heard): string | null {
  const who = heard.callsign || 'this flight'
  switch (heard.reason) {
    case 'not-heard':
      return `Nobody on the transponder networks is hearing ${who} right now, so which aircraft it is has not been said yet.`
    case 'unavailable':
      return `The transponder networks could not be reached to ask which aircraft ${who} is.`
    case 'no-type':
      return `${who} is being heard, but the networks do not know the airframe's type.`
    case 'not-flying':
      return `Which aircraft is not known yet: the transponder says from the gate, and this number has not been heard flying lately.`
    case 'no-callsign':
      return 'The flight number names no airline the transponder networks know, so the sky was not asked.'
    case 'sample':
      return null
    default:
      return null
  }
}

/* The airline's configuration for this leg, when the server has one. */
function useAirlineCabin(segment: Segment, aircraft: string | null): AirlineCabin | null {
  const [cabin, setCabin] = useState<AirlineCabin | null>(null)
  const airline = airlineCodeOf(segment)
  const family = aircraftFamily(aircraft)?.code ?? null
  useEffect(() => {
    let alive = true
    loadCabin(airline, family).then(found => {
      if (alive) setCabin(found)
    })
    return () => {
      alive = false
    }
  }, [airline, family])
  return cabin
}

/* Why nothing is drawn, in words that say what is true and what to do. */
function whyNoCabin(
  reason: NoCabin,
  {
    title,
    named,
    usual,
    library,
    booked,
  }: {
    title: string
    named: string | null
    usual: string | null
    library: AirlineCabin | null
    booked: Array<{
      person: { seat?: string | null }
      place: { row: number; letter: string } | null
    }>
  },
): string {
  const seats = booked
    .map(entry => entry.person.seat)
    .filter(Boolean)
    .join(', ')
  switch (reason) {
    case 'no-aircraft':
      return usual
        ? `${title} flew ${aircraftName(usual) ? `an ${aircraftName(usual)}` : usual} the last time it was heard, but nobody has named today’s aircraft yet, and a cabin is drawn only for the aircraft you are on. It is confirmed from the gate; or put it on the leg under Edit.`
        : `Nobody has named the aircraft for ${title} yet, and a cabin is drawn only for the aircraft you are on. It is confirmed from the gate; or put it on the leg under Edit.`
    case 'unknown-type':
      return `The aircraft was named as “${named}”, which is not on file yet, so no cabin is drawn for it.`
    case 'seats-not-on-chart': {
      const missing = booked
        .filter(entry => entry.place && !seatsFit([entry.place], library as AirlineCabin))
        .map(entry => `${entry.place?.row}${entry.place?.letter}`)
        .join(', ')
      return `The airline’s ${library?.name} has no seat ${missing || seats}. The chart, the aircraft or the booking is wrong, and nothing is drawn rather than the wrong thing.`
    }
    case 'seats-not-on-type':
      return `A ${aircraftName(named) || named} has no seat lettered the way ${seats} is. The aircraft or the booking is wrong, and nothing is drawn rather than the wrong thing.`
  }
}

export default function SeatMap({
  segment,
  tripId,
  onClose,
}: {
  segment: Segment
  /** the trip the leg is on, so the sky can be asked which aircraft; the map works without */
  tripId?: string
  onClose: () => void
}) {
  const heard = useHeardType(tripId, segment)
  /* Only the aircraft named for this leg is drawn. What the number usually
     flies is said, never drawn: a cabin is drawn for the aircraft you are
     on, or not at all. */
  const named = segment.aircraft || segment.flight?.aircraft || (!heard.usual && heard.type) || null
  const usual = named ? null : segment.flight?.usualAircraft || heard.type || null
  const library = useAirlineCabin(segment, named)
  const booked = segment.passengers
    .map(person => ({ person, place: parseSeat(person.seat) }))
    .filter(entry => entry.place !== null)
  const plan = cabinFor(
    segment.passengers.map(person => person.seat),
    named,
    library,
  )
  const drawn = isCabinPlan(plan) ? plan : null
  const g = drawn ? cabinGeometry(drawn) : null
  const title = [segment.carrier, segment.number].filter(Boolean).join(' ')
  /* The sheet opens on the seats, not on the nose: a wide-body is forty-odd
     rows tall and the family's row was off the bottom of every phone. */
  const frontRow = Math.min(...booked.map(entry => entry.place?.row ?? Number.POSITIVE_INFINITY))
  const mine = useRef<SVGGElement>(null)
  useEffect(() => {
    mine.current?.scrollIntoView({ block: 'center' })
  }, [])
  const across = drawn
    ? (drawn.cabins || [{ sections: drawn.sections }])
        .map(cabin => cabin.sections.map(section => section.length).join('–'))
        .join(' · ')
    : ''

  return (
    <Sheet title={`Seats — ${title || segment.toName}`} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {booked.map(({ person, place }) => (
          <span
            key={person.name}
            className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
            {person.name} · {place?.row}
            {place?.letter}
            {place && drawn && classOf(drawn, place.row) && (
              <span className="font-normal opacity-80"> · {classOf(drawn, place.row)}</span>
            )}
          </span>
        ))}
        {booked.length === 0 && (
          <span className="text-xs text-muted">No seat numbers on this leg yet.</span>
        )}
      </div>
      {drawn && (
        <p className="tkcraft m-0 text-center text-xs font-bold">
          {drawn.aircraft}
          <span className="font-normal text-muted">
            {' · '}
            {across} across
          </span>
        </p>
      )}

      {drawn && g && (
        <div className="grid justify-center">
          <svg
            width={g.width}
            height={g.height}
            viewBox={`0 0 ${g.width} ${g.height}`}
            /* Its own size where there is room, and never wider than the sheet:
               a wide-body's three banks are wider than a small phone. */
            style={{ maxWidth: '100%', height: 'auto' }}
            role="img"
            aria-label="Cabin seat map"
            data-library={drawn.cabins ? 'airline' : 'type'}>
            <Fuselage g={g} />
            {/* the classes, each named above its first row */}
            {g.bands.map(band => (
              <text
                key={band.name + band.y}
                className="cabinband"
                x={g.left + (g.right - g.left) / 2}
                y={band.y + 12}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                letterSpacing="0.08em"
                fill="var(--c-muted)">
                {band.name.toUpperCase()}
              </text>
            ))}
            {/* seats */}
            {g.rows.map(({ row, y, seats }) => (
              <g key={row} ref={row === frontRow ? mine : undefined}>
                {(row % 5 === 0 || row === 1) && (
                  <text
                    x={g.left - 8}
                    y={y + SEAT - 4}
                    textAnchor="end"
                    fontSize="9"
                    fill="var(--c-faint)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {row}
                  </text>
                )}
                {seats.map(seat => {
                  const held = booked.find(
                    entry => entry.place?.row === row && entry.place.letter === seat.letter,
                  )
                  return (
                    <g key={seat.letter}>
                      <rect
                        x={seat.x}
                        y={y}
                        width={seat.w}
                        height={SEAT}
                        rx={4}
                        fill={held ? 'var(--c-accent)' : 'var(--c-raised)'}
                        stroke={held ? 'var(--c-accent)' : 'var(--c-line)'}
                      />
                      {held && (
                        <text
                          x={seat.x + seat.w / 2}
                          y={y + SEAT - 4.5}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="800"
                          fill="var(--c-accent-ink)">
                          {held.person.name.trim().charAt(0).toUpperCase()}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            ))}
          </svg>
        </div>
      )}

      {drawn ? (
        <p className="tknote m-0 text-center text-[11px] leading-relaxed text-faint">
          {drawn.cabins
            ? `${drawn.aircraft} as the airline configures it — your seats are exact; the classes, doors and wing are representative of the type rather than this aircraft’s own chart.`
            : `Schematic of a typical ${drawn.aircraft} cabin — your seats are exact; the rows and exits are representative rather than this aircraft’s own chart.`}
        </p>
      ) : (
        <p
          className="tkwhy m-0 text-center text-[12px] leading-relaxed text-muted"
          data-reason={plan as NoCabin}>
          {whyNoCabin(plan as NoCabin, {
            title: title || 'this flight',
            named,
            usual,
            library,
            booked,
          })}
        </p>
      )}
      {!drawn && !named && askOutcome(heard) && (
        <p
          className="tkask m-0 text-center text-[11px] leading-relaxed text-faint"
          data-reason={heard.reason}>
          {askOutcome(heard)}
        </p>
      )}
    </Sheet>
  )
}

/* The airframe under the seats: wings first, then the fuselage — nose cone,
   straight body, tail taper — the wing band across the cabin, and the doors
   on both walls. */
function Fuselage({ g }: { g: ReturnType<typeof cabinGeometry> }) {
  const midX = g.left + (g.right - g.left) / 2
  return (
    <>
      <polygon
        points={`${g.left},${g.wing.top + 20} ${g.left - 26},${g.wing.bottom + 30} ${g.left - 26},${g.wing.bottom + 44} ${g.left},${g.wing.bottom}`}
        fill="var(--c-raised)"
        stroke="var(--c-line)"
      />
      <polygon
        points={`${g.right},${g.wing.top + 20} ${g.right + 26},${g.wing.bottom + 30} ${g.right + 26},${g.wing.bottom + 44} ${g.right},${g.wing.bottom}`}
        fill="var(--c-raised)"
        stroke="var(--c-line)"
      />
      <path
        d={
          `M ${g.left} 48 Q ${g.left} ${8} ${midX} ${4} Q ${g.right} ${8} ${g.right} 48 ` +
          `L ${g.right} ${g.height - 38} Q ${g.right - 8} ${g.height - 6} ${midX} ${g.height - 4} ` +
          `Q ${g.left + 8} ${g.height - 6} ${g.left} ${g.height - 38} Z`
        }
        fill="var(--c-panel-solid)"
        stroke="var(--c-line)"
        strokeWidth="1.5"
      />
      <rect
        x={g.left}
        y={g.wing.top}
        width={g.right - g.left}
        height={g.wing.bottom - g.wing.top}
        fill="var(--c-raised)"
        opacity="0.5"
      />
      {g.exits.map(y => (
        <g key={y}>
          <rect
            x={g.left - 3}
            y={y}
            width={5}
            height={12}
            rx={2}
            fill="var(--c-accent)"
            opacity="0.65"
          />
          <rect
            x={g.right - 2}
            y={y}
            width={5}
            height={12}
            rx={2}
            fill="var(--c-accent)"
            opacity="0.65"
          />
        </g>
      ))}
    </>
  )
}
