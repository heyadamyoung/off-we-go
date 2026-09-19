import { dealRows, ticketColumns, type TicketColumn } from '../../../flight-day-core'
import type { Segment } from '../../../segments-core'

/* The ticket's columns: TERMINAL, GATE, CHECK-IN and the rest as headings
   with the value under each, the way a boarding pass prints them and a
   traveller looks for them — the ones that are known, and the gate whether
   or not it is, with a dash until the board names it. The gate is the one
   a family reads from across a hall, so it is the one in colour; a gate
   that moved keeps the old one struck through.

   Dealt like the phases under them: equal columns, centred, in rows of at
   most three that differ by at most one — never three and then one alone,
   and never three headings spread unevenly across a card because their
   words are different lengths. */

const ACROSS = 3

export default function TicketColumns({ segment }: { segment: Segment }) {
  const rows = dealRows(ticketColumns(segment), ACROSS)
  if (!rows.length) return null
  return (
    <div className="tkcols mx-3 mt-2.5 flex flex-col gap-y-2 border-t border-dashed border-line pt-2.5">
      {rows.map(row => (
        <div
          key={row.map(column => column.key).join('+')}
          className="tkrow grid gap-x-2"
          style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
          {row.map(column => (
            <Column key={column.key} column={column} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Column({ column }: { column: TicketColumn }) {
  return (
    <div className="tkcol min-w-0 text-center" data-key={column.key}>
      <div className="truncate text-[9px] font-bold uppercase tracking-[.06em] text-faint">
        {column.label}
      </div>
      {/* The check-in column carries two facts — the zone and the run of
          desks — and on a phone they do not fit one line, so each gets
          its own rather than the second being cut to "Des…". */}
      <div
        className={
          'text-[14px] font-extrabold leading-tight tracking-[-.01em] ' +
          (column.key === 'checkin' ? '' : 'truncate ') +
          (column.value ? (column.key === 'gate' ? 'text-accent' : 'text-ink') : 'text-faint')
        }
        title={column.value ? undefined : 'Not announced yet'}>
        {column.value
          ? column.key === 'checkin'
            ? column.value.split(' · ').map(line => (
                <div key={line} className="truncate">
                  {line}
                </div>
              ))
            : column.value
          : '—'}
        {column.was && <s className="ml-1.5 text-[11px] font-normal text-faint">{column.was}</s>}
        {!column.value && column.hint && (
          <span className="tkhint ml-1.5 text-[11px] font-normal text-faint">{column.hint}</span>
        )}
      </div>
    </div>
  )
}
