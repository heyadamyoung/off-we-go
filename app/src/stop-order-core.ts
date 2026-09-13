/* The order an itinerary reads in.

   One module because two used to answer it separately — the strip drew a day
   one way and the rule deciding what comes next walked it another — and two
   answers to "what is after this" is how the app came to say UP NEXT about a
   place eighty-seven kilometres behind somebody.

The itinerary in the order the trip happens, which is the order a
     traveller reads it in — the timeline, the day bar and the strip along the
     bottom all order by day, and the numbering only settles ties within one.

     This used to go by the numbering alone, and the numbering is the order
     stops were typed. Nobody plans a trip in order: the flight out gets
     remembered halfway through writing up the museums and the flight home
     gets typed last of all. So the cursor walked a different trip from the one
     on the screen — parked on something three days out while the stop in front
     of them was never considered, moving between them in an order that looks
     like nothing at all. Anything undated goes last, as it does everywhere
     else: it is not a point in the trip, so it cannot hold a place in it.

   Pure, and it stays that way: nothing here knows about a map, a phone or a
   screen. It is a rule about rows, which is what lets it be the same rule in
   both places. */

import { dayNumber } from './live-schedule-core'
import { startMinutes, type StopTime } from './stop-time-core'

export interface OrderableStop extends StopTime {
  id: string
  day?: string | null
  /** the itinerary's own order, which is what the carry below walks along */
  seq?: number
}

/**
 * The minute of the day to order each stop by, carried forward across the
 * stops that name no hour.
 *
 * The obvious rule — timed stops in time order, untimed ones after them — is
 * wrong on the commonest day there is. Breakfast, the museum at half nine,
 * lunch, the castle at half three: two of those name an hour and two never
 * will, and sending the two that do not to the end reads as Museum, Castle,
 * Breakfast, Lunch. Nobody's morning.
 *
 * So the hour is carried. A stop with no time happens after whatever it was
 * placed after, which is what its place in the itinerary was already saying,
 * and the sequence number goes back to doing the one job it is good at:
 * holding a position among things the clock cannot separate.
 *
 * Anything before the first timed stop of a day carries nothing and comes back
 * `null`, which sorts to the front of that day — where it was put. The carry
 * resets at midnight, because yesterday's last hour says nothing about this
 * morning, and an undated stop is never carried into at all.
 *
 * The start is what is carried, never the end: what follows a stop follows the
 * thing, and the thing began when it began. Carrying the end would put a long
 * morning after a short one that started later.
 */
export function orderingMinutes(stops: readonly OrderableStop[]): Map<string, number | null> {
  const byDay = new Map<string, OrderableStop[]>()
  const order = new Map<string, number | null>()
  for (const stop of stops || []) {
    const day = String(stop?.day ?? '').trim()
    /* No day, no neighbours: an undated stop is its own pile everywhere else
       and must not pick up an hour from a day it is not on. */
    if (!day) {
      order.set(stop.id, startMinutes(stop))
      continue
    }
    const held = byDay.get(day)
    if (held) held.push(stop)
    else byDay.set(day, [stop])
  }

  for (const day of byDay.values()) {
    /* Walked in the itinerary's own order rather than the order the rows
       arrived in — the walk is what carries the hour, so reading it out of
       sequence would carry it from the wrong stop. */
    const walk = [...day].sort(
      (a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER),
    )
    let carried: number | null = null
    for (const stop of walk) {
      const own = startMinutes(stop)
      if (own !== null) carried = own
      order.set(stop.id, own ?? carried)
    }
  }
  return order
}

export interface ScheduledStop extends OrderableStop {
  day?: string | null
}

/**
 * A trip's stops in the order the itinerary reads: by day, then by the hour
 * each one happens at, then by the order somebody arranged them in.
 *
 * The hour used to come last of the three and never got a say. It is what is
 * written on the card; the sequence number is invisible, trip-wide, and was
 * defaulted to zero by two of the three ways a stop could be created — which
 * is the front of the whole trip, and is why a castle added on the Sunday
 * afternoon sat ahead of everything from that Sunday morning.
 *
 * Anything undated goes last, as it does everywhere else: it is not a point in
 * the trip, so it cannot hold a place in it.
 */
export function scheduleOrder<S extends ScheduledStop>(stops: readonly S[]): S[] {
  const ordering = orderingMinutes(stops)
  return [...stops].sort((a, b) => {
    const dayA = dayNumber(a.day)
    const dayB = dayNumber(b.day)
    if (dayA !== dayB) {
      if (dayA === null) return 1
      if (dayB === null) return -1
      return dayA - dayB
    }
    const fromA = ordering.get(a.id) ?? null
    const fromB = ordering.get(b.id) ?? null
    if (fromA !== fromB) {
      /* Nothing at all means nothing this day has named yet, which is the
         front of the day rather than the back of it. Undated stops never reach
         here — they are sorted away by the day comparison above. */
      if (fromA === null) return -1
      if (fromB === null) return 1
      return fromA - fromB
    }
    /* Then the itinerary's own order, which still settles what the clock says
       nothing about: a half-planned day, or two things booked for one hour. */
    const seqA = a.seq ?? Number.MAX_SAFE_INTEGER
    const seqB = b.seq ?? Number.MAX_SAFE_INTEGER
    return seqA === seqB ? 0 : seqA - seqB
  })
}
