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
