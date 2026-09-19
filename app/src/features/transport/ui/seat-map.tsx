import { useEffect, useRef, useState } from 'react'
import { loadCabin, loadSegmentPosition } from '../../../backend-segments'
import { aircraftFamily } from '../../../cabin-core'
import { type AirlineCabin, airlineCodeOf } from '../../../cabin-library-core'
import { cabinFor, cabinGeometry, classOf, parseSeat, SEAT } from '../../../seatmap-core'
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

/* The flying window, as the server keeps it: the transponder knows the
   aircraft from the gate to a while after it was due down. */
const FLYING_BEFORE_MS = 30 * 60_000
const FLYING_AFTER_MS = 2 * 60 * 60_000

/* Which aircraft, when neither the booking nor a board has said: through the
   flying window the transponder is asked, once, when the sheet opens. The
   watch writes the same answer onto the leg for everybody in a while; this
   is for the family looking now. */
function useHeardType(tripId: string | undefined, segment: Segment): string | null {
  const [type, setType] = useState<string | null>(null)
  const known = !!(segment.aircraft || segment.flight?.aircraft)
  useEffect(() => {
    if (!tripId || known) return
    const now = Date.now()
    const departs = Date.parse(segment.departsAt)
    const arrives = segment.arrivesAt ? Date.parse(segment.arrivesAt) : departs
    if (!(now >= departs - FLYING_BEFORE_MS && now <= arrives + FLYING_AFTER_MS)) return
    let alive = true
    loadSegmentPosition(tripId, segment.id)
      .then(found => {
        if (alive && found.aircraft?.type) setType(found.aircraft.type)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [tripId, known, segment.id, segment.departsAt, segment.arrivesAt])
  return type
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
  const aircraft = segment.aircraft || segment.flight?.aircraft || heard
  const library = useAirlineCabin(segment, aircraft)
  const booked = segment.passengers
    .map(person => ({ person, place: parseSeat(person.seat) }))
    .filter(entry => entry.place !== null)
  const plan = cabinFor(
    segment.passengers.map(person => person.seat),
    aircraft,
    library,
  )
  const g = cabinGeometry(plan)
  const midX = g.left + (g.right - g.left) / 2
  const title = [segment.carrier, segment.number].filter(Boolean).join(' ')
  /* The sheet opens on the seats, not on the nose: a wide-body is forty-odd
     rows tall and the family's row was off the bottom of every phone. */
  const frontRow = Math.min(...booked.map(entry => entry.place?.row ?? Number.POSITIVE_INFINITY))
  const mine = useRef<SVGGElement>(null)
  useEffect(() => {
    mine.current?.scrollIntoView({ block: 'center' })
  }, [])
  const across = (plan.cabins || [{ sections: plan.sections }])
    .map(cabin => cabin.sections.map(section => section.length).join('–'))
    .join(' · ')

  return (
    <Sheet title={`Seats — ${title || segment.toName}`} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {booked.map(({ person, place }) => (
          <span
            key={person.name}
            className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
            {person.name} · {place?.row}
            {place?.letter}
            {place && classOf(plan, place.row) && (
              <span className="font-normal opacity-80"> · {classOf(plan, place.row)}</span>
            )}
          </span>
        ))}
        {booked.length === 0 && (
          <span className="text-xs text-muted">No seat numbers on this leg yet.</span>
        )}
      </div>
      {plan.aircraft && (
        <p className="tkcraft m-0 text-center text-xs font-bold">
          {plan.aircraft}
          <span className="font-normal text-muted">
            {' · '}
            {across} across
          </span>
        </p>
      )}

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
          data-library={plan.cabins ? 'airline' : plan.aircraft ? 'type' : 'letters'}>
          {/* wings first, under the fuselage */}
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
          {/* the fuselage: nose cone, straight body, tail taper */}
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
          {/* the wing band across the cabin */}
          <rect
            x={g.left}
            y={g.wing.top}
            width={g.right - g.left}
            height={g.wing.bottom - g.wing.top}
            fill="var(--c-raised)"
            opacity="0.5"
          />
          {/* the doors, both walls */}
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
          {/* the classes, each named above its first row */}
          {g.bands.map(band => (
            <text
              key={band.name + band.y}
              className="cabinband"
              x={midX}
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

      <p className="tknote m-0 text-center text-[11px] leading-relaxed text-faint">
        {plan.cabins
          ? `${plan.aircraft} as the airline configures it — your seats are exact; the classes, doors and wing are representative of the type rather than this aircraft’s own chart.`
          : plan.aircraft
            ? `Schematic of a typical ${plan.aircraft} cabin — your seats are exact; the rows and exits are representative rather than this aircraft’s own chart.`
            : `Schematic of a typical ${plan.kind === 'wide' ? 'wide-body' : 'narrow-body'} cabin — your seats are exact, rows and exits are representative rather than this aircraft’s chart. Put the aircraft on the leg and the cabin is drawn for it.`}
      </p>
    </Sheet>
  )
}
