import { cabinFor, parseSeat } from '../../../seatmap-core'
import type { Segment } from '../../../segments-core'
import Sheet from '../../../shared/ui/sheet'

/* The cabin, drawn from the booking: a schematic fuselage with every booked
   seat lit and initialled, the wing shaded so "over the wing" is visible, and
   exits marked where every airliner keeps them. Honest about what it is — a
   typical layout for the body type the seat letters imply, not this exact
   aircraft's chart, which is licensed art no one gets for free. */

const SEAT = 16
const GAP = 4
const AISLE = 14
const ROW_H = SEAT + GAP
const LEFT = 30 // row numbers live here
const PAD = 12
const NOSE = 56
const TAIL = 48

export default function SeatMap({ segment, onClose }: { segment: Segment; onClose: () => void }) {
  const booked = segment.passengers
    .map(person => ({ person, place: parseSeat(person.seat) }))
    .filter(entry => entry.place !== null)
  const plan = cabinFor(segment.passengers.map(person => person.seat))

  const columnX = new Map<string, number>()
  let x = LEFT + PAD
  for (const section of plan.sections) {
    for (const letter of section) {
      columnX.set(letter, x)
      x += SEAT + GAP
    }
    x += AISLE - GAP
  }
  const bodyRight = x - AISLE + GAP + PAD
  const width = bodyRight + 4
  const rowY = (row: number) => NOSE + (row - 1) * ROW_H
  const height = rowY(plan.rows) + SEAT + TAIL
  const midX = LEFT + (bodyRight - LEFT) / 2
  const wingTop = rowY(plan.wing[0])
  const wingBottom = rowY(plan.wing[1]) + SEAT
  const title = [segment.carrier, segment.number].filter(Boolean).join(' ')

  return (
    <Sheet title={`Seats — ${title || segment.toName}`} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {booked.map(({ person, place }) => (
          <span
            key={person.name}
            className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
            {person.name} · {place?.row}
            {place?.letter}
          </span>
        ))}
        {booked.length === 0 && (
          <span className="text-xs text-muted">No seat numbers on this leg yet.</span>
        )}
      </div>

      <div className="grid justify-center">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Cabin seat map">
          {/* wings first, under the fuselage */}
          <polygon
            points={`${LEFT},${wingTop + 20} ${LEFT - 26},${wingBottom + 30} ${LEFT - 26},${wingBottom + 44} ${LEFT},${wingBottom}`}
            fill="var(--c-raised)"
            stroke="var(--c-line)"
          />
          <polygon
            points={`${bodyRight},${wingTop + 20} ${bodyRight + 26},${wingBottom + 30} ${bodyRight + 26},${wingBottom + 44} ${bodyRight},${wingBottom}`}
            fill="var(--c-raised)"
            stroke="var(--c-line)"
          />
          {/* the fuselage: nose cone, straight body, tail taper */}
          <path
            d={
              `M ${LEFT} ${NOSE - 8} Q ${LEFT} ${8} ${midX} ${4} Q ${bodyRight} ${8} ${bodyRight} ${NOSE - 8} ` +
              `L ${bodyRight} ${height - TAIL + 10} Q ${bodyRight - 8} ${height - 6} ${midX} ${height - 4} ` +
              `Q ${LEFT + 8} ${height - 6} ${LEFT} ${height - TAIL + 10} Z`
            }
            fill="var(--c-panel-solid)"
            stroke="var(--c-line)"
            strokeWidth="1.5"
          />
          {/* the wing band across the cabin */}
          <rect
            x={LEFT}
            y={wingTop}
            width={bodyRight - LEFT}
            height={wingBottom - wingTop}
            fill="var(--c-raised)"
            opacity="0.5"
          />
          {/* exits: front pair, over the wing, rear pair */}
          {[NOSE - 2, wingTop - 6, wingBottom + 2, rowY(plan.rows) + SEAT + 6].map(y => (
            <g key={y}>
              <rect
                x={LEFT - 3}
                y={y}
                width={5}
                height={12}
                rx={2}
                fill="var(--c-accent)"
                opacity="0.65"
              />
              <rect
                x={bodyRight - 2}
                y={y}
                width={5}
                height={12}
                rx={2}
                fill="var(--c-accent)"
                opacity="0.65"
              />
            </g>
          ))}
          {/* seats */}
          {Array.from({ length: plan.rows }, (_, index) => {
            const row = index + 1
            const y = rowY(row)
            return (
              <g key={row}>
                {row % 5 === 0 && (
                  <text
                    x={LEFT - 8}
                    y={y + SEAT - 4}
                    textAnchor="end"
                    fontSize="9"
                    fill="var(--c-faint)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {row}
                  </text>
                )}
                {plan.sections.flat().map(letter => {
                  const mine = booked.find(
                    entry => entry.place?.row === row && entry.place.letter === letter,
                  )
                  return (
                    <g key={letter}>
                      <rect
                        x={columnX.get(letter)}
                        y={y}
                        width={SEAT}
                        height={SEAT}
                        rx={4}
                        fill={mine ? 'var(--c-accent)' : 'var(--c-raised)'}
                        stroke={mine ? 'var(--c-accent)' : 'var(--c-line)'}
                      />
                      {mine && (
                        <text
                          x={(columnX.get(letter) || 0) + SEAT / 2}
                          y={y + SEAT - 4.5}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="800"
                          fill="var(--c-accent-ink)">
                          {mine.person.name.trim().charAt(0).toUpperCase()}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>

      <p className="m-0 text-center text-[11px] leading-relaxed text-faint">
        Schematic of a typical {plan.kind === 'wide' ? 'wide-body' : 'narrow-body'} cabin — your
        seats are exact, rows and exits are representative rather than this aircraft’s chart.
      </p>
    </Sheet>
  )
}
