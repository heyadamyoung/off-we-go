import { useState } from 'react'
import {
  deriveDeadlines,
  SEGMENT_MODES,
  type Segment,
  type SegmentPassenger,
} from '../../../segments-core'
import type { Person } from '../../../shared/model/types'

/* The typing fallback. The agent builds most legs from booking emails; this
   sheet exists for the cash-bought ferry ticket. One departure time births
   the countdown — the derived deadlines are shown, not asked for. */

const empty = (people: Person[]): Partial<Segment> => ({
  mode: 'train',
  fromName: '',
  toName: '',
  departsAt: '',
  passengers: people.map(person => ({ personId: String(person.id || ''), name: person.name })),
})

const toLocal = (iso?: string | null) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function SegmentEditor({
  segment,
  people,
  startsOn,
  endsOn,
  onSave,
  onDelete,
  onClose,
}: {
  segment: Segment | null
  people: Person[]
  /* The trip's declared range fences the pickers — travel belongs to the
     days the trip owns. Typed edge cases (a red-eye landing past midnight)
     still save: the fence guides the calendar, it does not jail the keyboard. */
  startsOn?: string | null
  endsOn?: string | null
  onSave: (draft: Partial<Segment> & { id?: string }) => Promise<boolean>
  onDelete?: (segmentId: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Partial<Segment>>(segment ? { ...segment } : empty(people))
  const [busy, setBusy] = useState(false)
  const field = (key: keyof Segment) => (value: unknown) =>
    setDraft(current => ({ ...current, [key]: value }))

  const setSeat = (index: number, seat: string) =>
    setDraft(current => {
      const passengers = [...((current.passengers as SegmentPassenger[]) || [])]
      passengers[index] = { ...passengers[index], seat }
      return { ...current, passengers }
    })

  const save = async () => {
    if (!draft.fromName || !draft.toName || !draft.departsAt) return
    setBusy(true)
    const departsAt = new Date(draft.departsAt).toISOString()
    const done = await onSave({
      ...draft,
      departsAt,
      arrivesAt: draft.arrivesAt ? new Date(draft.arrivesAt).toISOString() : null,
      deadlines:
        draft.deadlines ?? deriveDeadlines((draft.mode || 'train') as Segment['mode'], departsAt),
    })
    setBusy(false)
    if (done) onClose()
  }

  const input = 'w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink'
  const label = 'text-[10px] font-bold uppercase tracking-[.08em] text-faint'

  return (
    <div className="sheet rise absolute inset-x-4 top-[var(--trip-top)] z-[8] max-h-[80%] overflow-y-auto rounded-2xl p-4 sm:left-auto sm:w-[420px]">
      <div className="mb-3 flex items-center justify-between">
        <b className="text-base">{segment ? 'Edit the leg' : 'Add a leg'}</b>
        <button className="mini" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          {SEGMENT_MODES.map(mode => (
            <button
              key={mode}
              className={
                'rounded-lg border px-2.5 py-1 text-xs font-bold ' +
                (draft.mode === mode
                  ? 'border-transparent bg-accent text-accent-ink'
                  : 'border-line bg-canvas text-muted')
              }
              onClick={() => field('mode')(mode)}>
              {mode}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className={label}>From</div>
            <input
              className={input}
              value={draft.fromName || ''}
              onChange={e => field('fromName')(e.target.value)}
            />
          </div>
          <div>
            <div className={label}>To</div>
            <input
              className={input}
              value={draft.toName || ''}
              onChange={e => field('toName')(e.target.value)}
            />
          </div>
          <div>
            <div className={label}>Departs</div>
            <input
              className={input}
              type="datetime-local"
              min={startsOn ? `${startsOn}T00:00` : undefined}
              max={endsOn ? `${endsOn}T23:59` : undefined}
              value={toLocal(draft.departsAt)}
              onChange={e => field('departsAt')(e.target.value)}
            />
          </div>
          <div>
            <div className={label}>Arrives</div>
            <input
              className={input}
              type="datetime-local"
              min={startsOn ? `${startsOn}T00:00` : undefined}
              max={endsOn ? `${endsOn}T23:59` : undefined}
              value={toLocal(draft.arrivesAt)}
              onChange={e => field('arrivesAt')(e.target.value)}
            />
          </div>
          <div>
            <div className={label}>Carrier</div>
            <input
              className={input}
              value={draft.carrier || ''}
              onChange={e => field('carrier')(e.target.value)}
            />
          </div>
          <div>
            <div className={label}>Number</div>
            <input
              className={input}
              value={draft.number || ''}
              onChange={e => field('number')(e.target.value)}
            />
          </div>
          <div>
            <div className={label}>Booking ref</div>
            <input
              className={input}
              value={draft.ref || ''}
              onChange={e => field('ref')(e.target.value)}
            />
          </div>
          <div>
            <div className={label}>{draft.mode === 'train' ? 'Platform' : 'Gate'}</div>
            <input
              className={input}
              value={(draft.mode === 'train' ? draft.platform : draft.gate) || ''}
              onChange={e => field(draft.mode === 'train' ? 'platform' : 'gate')(e.target.value)}
            />
          </div>
        </div>
        <div>
          <div className={label}>Seats</div>
          <div className="mt-1 flex flex-col gap-1.5">
            {((draft.passengers as SegmentPassenger[]) || []).map((person, index) => (
              <div key={person.name} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate">{person.name}</span>
                <input
                  className={input + ' max-w-28'}
                  placeholder="seat"
                  value={person.seat || ''}
                  onChange={e => setSeat(index, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className={label}>Cost</div>
            <input
              className={input}
              inputMode="decimal"
              value={draft.costAmount ?? ''}
              onChange={e =>
                field('costAmount')(e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </div>
          <div>
            <div className={label}>Currency</div>
            <input
              className={input}
              maxLength={3}
              value={draft.costCurrency || ''}
              onChange={e => field('costCurrency')(e.target.value.toUpperCase())}
            />
          </div>
        </div>
        <div className="mt-1 flex gap-2">
          <button
            className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-accent-ink disabled:opacity-50"
            disabled={busy || !draft.fromName || !draft.toName || !draft.departsAt}
            onClick={save}>
            {segment ? 'Save the leg' : 'Add the leg'}
          </button>
          {segment && onDelete && (
            <button
              className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs font-bold text-tight"
              onClick={() => {
                onDelete(segment.id)
                onClose()
              }}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
