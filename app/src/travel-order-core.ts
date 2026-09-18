import type { Segment } from './segments-core'

/* The Travel tab's order. A travel day is read from where you are in it:
   the leg that matters now on top — the one you are on, or the next to
   leave — and everything else folded to a line, the legs still to come in
   the order they leave, then the ones behind you. A leg is behind you once
   it has arrived, by the board's word when there is one and the timetable
   when there is not; a cancelled flight has not arrived, and stays on top
   until its hour has passed, because it is the thing to deal with. Pure,
   so the order is tested without a screen. */

export interface TravelLayout {
  /** the leg that matters now: in progress, or the next to leave */
  active: Segment | null
  /** the legs still to come after it, in the order they leave */
  later: Segment[]
  /** the legs behind them, in the order they left */
  earlier: Segment[]
}

const when = (value: string | null | undefined) => {
  const at = Date.parse(value || '')
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY
}

/** In the order they leave; a leg with no readable departure goes last. */
export const byDeparture = (segments: readonly Segment[]): Segment[] =>
  [...segments].sort((a, b) => when(a.departsAt) - when(b.departsAt))

/** Whether a leg is behind the traveller: marked done, or arrived. */
export function legOver(segment: Segment, now: number): boolean {
  if (segment.status === 'done') return true
  const ends = when(segment.flight?.actualArrival || segment.arrivesAt || segment.departsAt)
  return ends <= now
}

export function travelLayout(segments: readonly Segment[], now: number): TravelLayout {
  const ordered = byDeparture(segments)
  const index = ordered.findIndex(leg => !legOver(leg, now))
  if (index < 0) return { active: null, later: [], earlier: ordered }
  return {
    active: ordered[index],
    later: ordered.slice(index + 1),
    earlier: ordered.slice(0, index),
  }
}

/** The day a leg leaves, where it leaves: `Sat 20 Sep`. */
export function legDay(iso: string | null | undefined, tz?: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return ''
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: tz || undefined }).format(
      new Date(iso),
    )
  } catch {
    return new Intl.DateTimeFormat('en-GB', options).format(new Date(iso))
  }
}
