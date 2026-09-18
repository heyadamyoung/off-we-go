import { ticketColumns } from '../../../flight-day-core'
import type { Segment } from '../../../segments-core'

/* The ticket's columns: TERMINAL, GATE, CHECK-IN and the rest as headings
   with the value under each, the way a boarding pass prints them and a
   traveller looks for them. Always the same headings for the mode; a dash
   under the ones the board has not filled in yet, so nothing moves when it
   does. The gate is the one a family reads from across a hall, so it is the
   one in colour; a gate that moved keeps the old one struck through. */

export default function TicketColumns({ segment }: { segment: Segment }) {
  const columns = ticketColumns(segment)
  if (!columns.length) return null
  return (
    <div className="tkcols mx-3 mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-dashed border-line pt-2.5">
      {columns.map(column => (
        <div key={column.key} className="tkcol min-w-0" data-key={column.key}>
          <div className="text-[9px] font-bold uppercase tracking-[.06em] text-faint">
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
            {column.was && (
              <s className="ml-1.5 text-[11px] font-normal text-faint">{column.was}</s>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
