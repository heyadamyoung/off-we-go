import { bestArrival, bestDeparture, flightNumberOf } from '../flights/model.js'

/* The card a phone is shown for a leg, and what about it is worth a sound.
 *
 * A state, not an event. The watch raises thirteen kinds of event, several
 * of them every few minutes on a long flight; a phone told each one is a
 * phone put in a drawer. So the card is what the leg is now — "On time ·
 * gate D43 · boarding 11:40", "Landed 13:25 · baggage claim belt 2" — and a
 * phone is told again only when the card it was last shown reads
 * differently. Between the two cards, five things make a sound: a gate
 * named or moved, a delay of a quarter of an hour, a cancellation or a
 * diversion, boarding and its final call, and the landing. Everything
 * else replaces the card quietly. Who hears which: the people on the leg
 * hear the gate and the boarding; the people at home hear the landing;
 * everybody hears a delay or a cancellation.
 *
 * Pure: a leg, the board's last word and a clock in; the card out. */

/** The card opens this long before departure, as the Lock Screen card does. */
export const CARD_BEFORE_MS = 4 * 3600_000
/** A change is sent once it has stood this long: boards flap. */
export const HOLD_MS = 2 * 60_000
/** A departure that moved by this much, since the phone was last told, is worth a sound. */
export const DELAY_WAKES_MINUTES = 15
/** No phone is woken more often than this for one leg. */
export const WAKES_PER_LEG = 6
/** Somebody following from home is woken at most this often in a day. */
export const WAKES_PER_DAY_FOLLOWER = 3
/** With no word from a board, a leg is over this long after it was due down. */
export const LANDED_GRACE_MS = 20 * 60_000
/** The card says Landed for this long, then goes. */
export const HOLD_AFTER_LANDING_MS = 15 * 60_000
/** A cancellation stays on the lock screen this long past the departure it cancelled. */
export const CANCELLED_STAYS_MS = 60 * 60_000
/** A delay smaller than this is still "on time" to a card. */
const DELAY_SHOWS_MINUTES = 5

const LANDED = new Set(['landed', 'arrived'])

const at = iso => {
  const when = Date.parse(String(iso ?? ''))
  return Number.isFinite(when) ? when : null
}

const clock = (when, zone) => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone || 'UTC',
    }).format(new Date(when))
  } catch {
    return ''
  }
}

const spell = minutes =>
  minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`

/** "AC1115" as people say it: "AC 1115". */
export function flightName(leg) {
  const number = flightNumberOf(leg)
  if (number) return number.replace(/^([A-Z0-9]{2})(\d)/, '$1 $2')
  return String(leg?.number || '').trim() || 'Your flight'
}

/** The people on the leg, by first name, for the card of somebody at home. */
export function whoIsOn(leg) {
  const names = (leg?.passengers || [])
    .map(
      person =>
        String(person?.name || '')
          .trim()
          .split(/\s+/)[0],
    )
    .filter(Boolean)
  if (!names.length) return null
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * @param {object} leg  the segment, as the repository returns it
 * @param {object|null} info  the board's last word (the flight snapshot's view)
 * @param {number} now
 * @returns {object|null}  the card, or null when there is nothing to show
 */
export function flightCard(leg, info, now) {
  const view = info && typeof info === 'object' ? info : null
  const status = view?.status || null
  const planned = at(leg.departsAt)
  const departs = at(bestDeparture(view)) ?? planned
  if (departs === null) return null
  const arrives = at(bestArrival(view)) ?? at(leg.arrivesAt)
  const scheduled = at(view?.scheduledDeparture) ?? at(leg.departsWas) ?? planned
  const moved = scheduled === null ? 0 : Math.round((departs - scheduled) / 60_000)
  const name = flightName(leg)
  const route = `${leg.fromCode || leg.fromName || '?'} → ${leg.toCode || leg.toName || '?'}`
  const base = {
    flight: name,
    route,
    title: `${name} ${route}`,
    who: whoIsOn(leg),
    gate: view?.gate || leg.gate || null,
    terminal: view?.terminal || leg.terminal || null,
    belt: view?.baggageBelt || null,
    bags: view?.bagsInHall === true,
    boarding: view?.boardingStatus || null,
    departs: new Date(departs).toISOString(),
    arrives: arrives === null ? null : new Date(arrives).toISOString(),
    moved,
  }
  const dz = leg.departTz
  const az = leg.arriveTz

  /* The news that changes the day is told whenever the board says it, and
     stays an hour past the departure it took away. */
  if (status === 'cancelled' || leg.status === 'cancelled') {
    if (now > departs + CANCELLED_STAYS_MS) return null
    return { ...base, phase: 'cancelled', body: `Cancelled · was leaving ${clock(departs, dz)}` }
  }
  if (status === 'diverted') {
    if (now > (arrives ?? departs) + CANCELLED_STAYS_MS) return null
    return { ...base, phase: 'diverted', body: 'Diverted' }
  }
  if (now < departs - CARD_BEFORE_MS) return null

  const landedAt = at(view?.actualArrival)
  if ((status && LANDED.has(status)) || landedAt !== null) {
    const when = landedAt ?? arrives ?? now
    if (now > when + HOLD_AFTER_LANDING_MS) return null
    const belt = base.belt ? ` · baggage claim belt ${base.belt}` : ''
    if (base.bags) {
      return {
        ...base,
        phase: 'landed',
        body: `Bags in the hall${base.belt ? ` · belt ${base.belt}` : ''} · landed ${clock(when, az)}`,
      }
    }
    return { ...base, phase: 'landed', body: `Landed ${clock(when, az)}${belt}` }
  }
  /* Nothing heard for long enough after it was due down: the card goes,
     rather than saying "boarding" over a family already in the taxi. */
  if (now > (arrives ?? departs) + LANDED_GRACE_MS) return null

  if (status === 'departed' || view?.actualDeparture) {
    const left = at(view?.actualDeparture) ?? departs
    const lands = arrives !== null ? ` · lands ${clock(arrives, az)}` : ''
    return { ...base, phase: 'airborne', body: `Departed ${clock(left, dz)}${lands}` }
  }

  const gateWord = base.gate ? `gate ${base.gate}` : 'gate not announced yet'
  if (base.boarding === 'final-call')
    return { ...base, phase: 'boarding', body: `Final call · ${gateWord}` }
  if (base.boarding === 'closed')
    return { ...base, phase: 'boarding', body: `Gate closed · ${gateWord}` }
  if (base.boarding === 'boarding')
    return { ...base, phase: 'boarding', body: `Boarding · ${gateWord}` }

  if (status === 'delayed' || moved >= DELAY_SHOWS_MINUTES) {
    const by = moved >= DELAY_SHOWS_MINUTES ? ` ${spell(moved)}` : ''
    return {
      ...base,
      phase: 'before',
      body: `Delayed${by} · leaves ${clock(departs, dz)} · ${gateWord}`,
    }
  }
  const boardingAt = at(leg.deadlines?.boardingAt)
  const next =
    boardingAt !== null && boardingAt > now
      ? `boarding ${clock(boardingAt, dz)}`
      : `leaves ${clock(departs, dz)}`
  return {
    ...base,
    phase: 'before',
    body: `${view ? 'On time' : 'Scheduled'} · ${gateWord} · ${next}`,
  }
}

/** Two cards that read the same are the same card. */
export const sameCard = (a, b) =>
  !!a && !!b && a.phase === b.phase && a.title === b.title && a.body === b.body

/**
 * What about the new card is worth a sound to this person, or null.
 * @param {object|null} previous  the card the phone was last shown
 * @param {object} next
 * @param {'traveller'|'follower'} role
 */
export function whatWakes(previous, next, role) {
  const was = previous || null
  if ((next.phase === 'cancelled' || next.phase === 'diverted') && was?.phase !== next.phase) {
    return 'cancelled'
  }
  if (next.phase === 'before') {
    const from = was ? at(was.departs) : null
    const to = at(next.departs)
    if (from !== null && to !== null && Math.abs(to - from) >= DELAY_WAKES_MINUTES * 60_000) {
      return 'delay'
    }
    if (!was && next.moved >= DELAY_WAKES_MINUTES) return 'delay'
  }
  if (role === 'traveller') {
    /* The gate, once the phone has a card to compare with: a first card
       that already carries the gate is the day's plan, not news. */
    if (was && ['before', 'boarding'].includes(next.phase) && next.gate) {
      if (next.gate !== was.gate) return 'gate'
      if (next.terminal && was.terminal && next.terminal !== was.terminal) return 'gate'
    }
    if (next.phase === 'boarding') {
      if (was?.phase !== 'boarding') return 'boarding'
      if (next.boarding === 'final-call' && was.boarding !== 'final-call') return 'boarding'
    }
  } else if (next.phase === 'landed' && was?.phase !== 'landed') {
    return 'landed'
  }
  /* The bags out: whoever is waiting in arrivals, and whoever is standing
     at the wrong belt. */
  if (next.phase === 'landed' && next.bags && !was?.bags) return 'bags'
  return null
}

/**
 * Whether to send this person anything, and whether it may make a sound.
 * @returns {null | {send: 'clear'} | {send: 'card', audible: boolean, kind: string}}
 */
export function decidePush({ previous, next, role, woken = 0, wokenToday = 0 }) {
  if (!next) return previous ? { send: 'clear' } : null
  if (previous && sameCard(previous, next)) return null
  const kind = whatWakes(previous, next, role)
  const audible =
    kind !== null &&
    woken < WAKES_PER_LEG &&
    (role === 'traveller' || wokenToday < WAKES_PER_DAY_FOLLOWER)
  return { send: 'card', audible, kind: kind || 'update' }
}
