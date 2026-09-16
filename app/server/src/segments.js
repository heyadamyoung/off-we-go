/* Per-mode deadline templates: type one departure time, get the day's whole
   countdown. Minutes before departure, resolved to ISO stamps at write time
   so a stored segment is self-contained and every edit is explicit.

   The client keeps a matching table in src/segments-core.ts for editor
   prefill and notifications — keep the two in step, like the Overpass query
   pair. */

const OFFSETS = {
  flight: {
    checkinOpensAt: 1440,
    checkinClosesAt: 60,
    bagsCloseAt: 45,
    boardingAt: 40,
    doorsAt: 15,
  },
  train: { boardingAt: 20, doorsAt: 2 },
  bus: { boardingAt: 15, doorsAt: 5 },
  ferry: { checkinClosesAt: 60, boardingAt: 30, doorsAt: 10 },
  drive: {},
}

export const SEGMENT_MODES = Object.keys(OFFSETS)

export function deriveDeadlines(mode, departsAt) {
  const depart = new Date(departsAt).getTime()
  if (!Number.isFinite(depart)) return null
  const offsets = OFFSETS[mode] || {}
  const out = {}
  for (const [key, minutes] of Object.entries(offsets)) {
    out[key] = new Date(depart - minutes * 60_000).toISOString()
  }
  return Object.keys(out).length ? out : null
}

/* When the departure moves, the whole day moves with it.
 *
 * The deadlines above are worked out once, at write time, and were then never
 * looked at again. So a flight put back ninety minutes kept boarding, bags and
 * doors where they would have been — and every countdown on the card, every
 * notification on a phone and the meter that tells a family whether they will
 * make it were all counting down to a moment that had stopped existing.
 * Confidently wrong on the one screen in this app with consequences, which is
 * worse than saying nothing at all.
 *
 * The second rule is the one that matters. A deadline nobody has touched is
 * derived again. A deadline somebody typed is SHIFTED by the same amount: a
 * traveller who wrote their own boarding time meant it, and a delay is a
 * reason to move their answer, never to throw it away.
 */

const at = value => {
  const when = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(when) ? when : null
}

/* Statuses the clock has no business overruling. Cancelled is cancelled
   whatever the departure did, and a flight already flown is not re-labelled
   by somebody correcting its time afterwards. */
const SETTLED = new Set(['cancelled', 'done'])

/**
 * What a moved departure does to the rest of a segment, or null when nothing
 * moved.
 *
 * @param {{mode: string, departs_at: *, arrives_at?: *, deadlines?: object|null, status?: string, departs_was?: *}} row
 * @param {{departsAt?: *, arrivesAt?: *, status?: string}} changes
 * @returns {{deadlines: object|null, departsWas: string, status: string, arrivesAt?: string}|null}
 */
export function rescheduled(row, changes = {}) {
  const was = at(row?.departs_at)
  const now = changes.departsAt === undefined ? was : at(changes.departsAt)
  if (was === null || now === null || now === was) return null
  const shift = now - was

  /* Derived, or somebody's own? Compared against what the template WOULD have
     said for the old departure, which is the only way to tell the two apart
     without storing a flag nobody would remember to set. */
  const before = deriveDeadlines(row.mode, new Date(was).toISOString()) || {}
  const after = deriveDeadlines(row.mode, new Date(now).toISOString()) || {}
  const held = row.deadlines || null
  let deadlines = null
  if (held) {
    deadlines = {}
    for (const [key, value] of Object.entries(held)) {
      const stamp = at(value)
      if (stamp === null) continue
      const derived = value === before[key] ? after[key] : null
      deadlines[key] = derived || new Date(stamp + shift).toISOString()
    }
  }

  /* Put back twice is one delay of the sum, to everybody except an airline:
     the card must still say what the ticket said, not what the last delay
     said. */
  const departsWas = row.departs_was || new Date(was).toISOString()

  const settled = SETTLED.has(row.status)
  const status = changes.status ?? (settled ? row.status : shift > 0 ? 'delayed' : 'changed')

  const moved = { deadlines, departsWas, status }
  /* A delayed flight lands late. Left where it was, a two-and-a-half hour
     flight reads as an hour and the connection after it reads as comfortable.
     Only when the caller has not said — they know better than this does. */
  if (changes.arrivesAt === undefined) {
    const lands = at(row.arrives_at)
    if (lands !== null) moved.arrivesAt = new Date(lands + shift).toISOString()
  }
  return moved
}
