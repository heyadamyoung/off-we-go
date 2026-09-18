import { dueLabel } from './live-progress-copy-core'
import {
  delayMinutes,
  localTime,
  nextDeadline,
  type Segment,
  type SegmentDeadlines,
} from './segments-core'

/* The travel day, in words — pure.
 *
 * The server writes what the airport's board says onto the leg
 * (segment.flight); the app already derives the deadlines and knows the
 * clock. This turns the three into the sentences a family reads on the day:
 * one headline per leg with a tone, the phases in order with the one that is
 * happening now, everything a traveller would otherwise stand and read off
 * the departures board, which board said so and how long ago, and the one
 * line the capsule over the map leads with. Nothing here fetches; the day
 * works at a desk with no signal. */

export type FlightTone = 'ok' | 'tight' | 'late' | 'done' | 'quiet'

/* Board hostnames → the names people say. Mirrors SOURCE_NAMES in
   server/src/flights/watch.js; the server says the same names in its notes. */
export const BOARD_NAMES: Record<string, string> = {
  'api.dublinairport.com': 'Dublin Airport',
  'yqr.simpleway.cloud': 'Regina Airport',
  'www.torontopearson.com': 'Toronto Pearson',
  'gtaa-fl-prod.azureedge.net': 'Toronto Pearson',
  'api.adsb.lol': 'ADS-B',
  'www.schiphol.nl': 'Schiphol',
}
export const boardName = (source: string | null | undefined): string =>
  (source && BOARD_NAMES[source]) || 'The airport'

/** A board that has not answered for this long is said to have gone quiet. */
export const QUIET_AFTER_MS = 15 * 60_000

const LANDED = new Set(['landed', 'arrived'])
const OVER = new Set(['landed', 'arrived', 'cancelled', 'diverted'])

const at = (iso: unknown): number | null => {
  const when = Date.parse(String(iso ?? ''))
  return Number.isFinite(when) ? when : null
}

const spell = (minutes: number): string =>
  minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`

/* The deadline as it reads mid-sentence: "boarding in 42 min". */
const IN_SENTENCE: Record<keyof SegmentDeadlines, string> = {
  checkinOpensAt: 'check-in opens',
  checkinClosesAt: 'check-in closes',
  bagsCloseAt: 'bags close',
  boardingAt: 'boarding',
  doorsAt: 'doors close',
}

/** How far a departure moved, from the leg or, failing that, from the board's estimate. */
export function movedMinutes(segment: Segment): number | null {
  const own = delayMinutes(segment)
  if (own !== null) return own
  const flight = segment.flight
  const was = at(flight?.scheduledDeparture)
  const is = at(flight?.estimatedDeparture)
  if (was === null || is === null || was === is) return null
  return Math.round((is - was) / 60_000)
}

/**
 * The one line for a leg, and its tone. Lead with the answer, in words:
 * "On time · gate 106 · boarding in 42 min", "Delayed 55 min · leaves
 * 19:30", "Landed 23:28 · bags on belt 5". Never a raw status word.
 */
export function flightHeadline(segment: Segment, now: number): { text: string; tone: FlightTone } {
  const flight = segment.flight || null
  const gate = segment.gate || flight?.gate || null
  const gateWord = gate ? ` · gate ${gate}` : ''
  const status = flight?.status || null
  if (segment.status === 'cancelled' || status === 'cancelled')
    return { text: 'Cancelled', tone: 'late' }
  if (status === 'diverted') return { text: 'Diverted', tone: 'late' }
  if (status && LANDED.has(status)) {
    const when = flight?.actualArrival || flight?.estimatedArrival || segment.arrivesAt
    const belt = flight?.baggageBelt ? ` · bags on belt ${flight.baggageBelt}` : ''
    return { text: `Landed ${localTime(when, segment.arriveTz)}${belt}`, tone: 'done' }
  }
  if (status === 'departed') {
    const left = localTime(flight?.actualDeparture || segment.departsAt, segment.departTz)
    const lands = flight?.estimatedArrival || flight?.scheduledArrival || segment.arrivesAt
    const landing = lands ? ` · lands ${localTime(lands, segment.arriveTz)}` : ''
    return { text: `Departed ${left}${landing}`, tone: 'ok' }
  }
  switch (flight?.boardingStatus) {
    case 'final-call':
      return { text: `Final call${gateWord}`, tone: 'late' }
    case 'closed':
      return { text: `Gate closed${gateWord}`, tone: 'late' }
    case 'boarding':
      return { text: `Boarding${gateWord}`, tone: 'tight' }
    case 'go-to-gate': {
      const walk = flight?.walkMinutes ? ` · ${flight.walkMinutes} min walk` : ''
      return { text: `Go to gate${gate ? ` ${gate}` : ''}${walk}`, tone: 'tight' }
    }
  }
  const departs = at(segment.departsAt) ?? now
  const arrives = at(segment.arrivesAt)
  const flying = segment.mode === 'flight'
  /* Past the departure with no board word, the app says what is due rather
     than what happened — and not "delayed", which was true of a train that
     has since left and is history now. A board still saying scheduled about
     a flight past its time has not called it, and the app does not either. */
  if (now >= departs && (!flight || status === 'scheduled' || status === 'unknown')) {
    const when = localTime(segment.arrivesAt, segment.arriveTz)
    if (arrives !== null && now >= arrives) {
      return { text: `Due to have ${flying ? 'landed' : 'arrived'} ${when}`, tone: 'done' }
    }
    return {
      text: arrives === null ? 'Due to have left' : `Due to ${flying ? 'land' : 'arrive'} ${when}`,
      tone: 'ok',
    }
  }
  const moved = movedMinutes(segment)
  if (status === 'delayed' || segment.status === 'delayed' || (moved !== null && moved > 0)) {
    const by = moved !== null && moved > 0 ? ` ${spell(moved)}` : ''
    return {
      text: `Delayed${by} · leaves ${localTime(segment.departsAt, segment.departTz)}${gateWord}`,
      tone: 'tight',
    }
  }
  const next = nextDeadline(segment, now)
  const minutes = next ? Math.round((at(next.at) as number) - now) / 60_000 : null
  const countdown = next
    ? `${IN_SENTENCE[next.key]} ${dueLabel(minutes)}`
    : `leaves ${dueLabel(Math.round((departs - now) / 60_000))}`
  const state =
    flight && status !== 'unknown'
      ? 'On time'
      : segment.mode === 'flight'
        ? 'Scheduled'
        : 'On the plan'
  const tone: FlightTone = minutes !== null && minutes <= 15 ? 'tight' : 'ok'
  return { text: `${state}${gateWord} · ${countdown}`, tone }
}

export interface FlightPhase {
  key: string
  label: string
  at: string | null
  state: 'done' | 'now' | 'later'
  /** the time in the airport's own clock, or ✓ once done */
  clock: string
}

const PHASE_LABELS: Record<string, string> = {
  checkinClosesAt: 'Check-in',
  bagsCloseAt: 'Bags',
  goToGate: 'To gate',
  boardingAt: 'Boarding',
  doorsAt: 'Doors',
}

/**
 * The phases in order, each done, now or later: the deadlines the app
 * derives, the board's go-to-gate time when it gives one, then leaving and
 * landing with the board's actuals taking over from the plan as they happen,
 * and the belt once there is one.
 */
export function flightPhases(segment: Segment, now: number): FlightPhase[] {
  const flight = segment.flight || null
  const deadlines = segment.deadlines || {}
  const status = flight?.status || null
  /* Leaving and landing are the board's to call when there is one: a plane
     the board has not said has left has not left, however late the clock
     is. A train has no board, and then the clock is all there is. */
  const arrives = at(segment.arrivesAt)
  const byClock = !flight
  const left =
    status === 'departed' ||
    (status !== null && LANDED.has(status)) ||
    (byClock && (at(segment.departsAt) ?? Number.POSITIVE_INFINITY) <= now)
  const down =
    (status !== null && LANDED.has(status)) || (byClock && arrives !== null && arrives <= now)
  const rows: Array<{ key: string; label: string; at: string | null; done?: boolean }> = []
  for (const key of ['checkinClosesAt', 'bagsCloseAt'] as const) {
    if (deadlines[key]) rows.push({ key, label: PHASE_LABELS[key], at: deadlines[key] as string })
  }
  if (flight?.goToGateTime)
    rows.push({ key: 'goToGate', label: PHASE_LABELS.goToGate, at: flight.goToGateTime })
  for (const key of ['boardingAt', 'doorsAt'] as const) {
    if (deadlines[key]) rows.push({ key, label: PHASE_LABELS[key], at: deadlines[key] as string })
  }
  rows.push({
    key: 'departs',
    label: left ? 'Departed' : 'Departs',
    at: flight?.actualDeparture || flight?.estimatedDeparture || segment.departsAt,
    done: left,
  })
  if (segment.arrivesAt || flight?.actualArrival) {
    rows.push({
      key: 'lands',
      label: down ? 'Landed' : 'Lands',
      at: flight?.actualArrival || flight?.estimatedArrival || segment.arrivesAt || null,
      done: down,
    })
  }
  if (flight?.baggageBelt)
    rows.push({ key: 'belt', label: `Belt ${flight.baggageBelt}`, at: null, done: down })

  let nowFound = false
  return rows.map(row => {
    const when = at(row.at)
    const done =
      row.done === true ||
      (row.done === undefined &&
        !['departs', 'lands'].includes(row.key) &&
        when !== null &&
        when <= now)
    let state: FlightPhase['state'] = 'later'
    if (done) state = 'done'
    else if (!nowFound) {
      state = 'now'
      nowFound = true
    }
    const tz = row.key === 'lands' || row.key === 'belt' ? segment.arriveTz : segment.departTz
    return {
      key: row.key,
      label: row.label,
      at: row.at,
      state,
      clock: done ? '✓' : localTime(row.at, tz),
    }
  })
}

export interface TicketColumn {
  key: string
  label: string
  /** null is drawn as a dash: the column is there before the board fills it */
  value: string | null
  was?: string | null
}

/* The columns a ticket has, whether or not anything is known for them yet.
   A boarding pass prints TERMINAL, GATE and the rest as headings with the
   value under each, and a traveller looks for the heading first — so the
   headings are always there, with a dash under the ones the board has not
   filled in, rather than appearing one by one as facts arrive and moving
   everything else around when they do. The optional ones — pre-clearance,
   the stand — are added only when the board says, because a dash under
   "US pre-clearance" on a flight to Cork is a question nobody asked. */
export function ticketColumns(segment: Segment): TicketColumn[] {
  const flight = segment.flight || null
  const gate = segment.gate || flight?.gate || null
  const terminal = segment.terminal || flight?.terminal || null
  const terminalWord = terminal ? `T${terminal}` : null
  if (segment.mode === 'flight') {
    /* Dublin numbers its zones ("13"); Pearson names its aisles in words the
       board already chose ("Aisle 5"). A bare number gets the noun. */
    const zone = flight?.checkinZone
      ? /^\d+$/.test(flight.checkinZone)
        ? `Zone ${flight.checkinZone}`
        : flight.checkinZone
      : ''
    const desks = flight?.checkinDesks ? `Desks ${flight.checkinDesks.replace('-', '–')}` : ''
    const queue = flight?.securityWaitMinutes
    const columns: TicketColumn[] = [
      { key: 'terminal', label: 'Terminal', value: terminalWord },
      { key: 'gate', label: 'Gate', value: gate, was: segment.gateWas || null },
      {
        key: 'checkin',
        label: 'Check-in',
        value: [zone, desks].filter(Boolean).join(' · ') || null,
      },
      {
        key: 'walk',
        label: 'Walk to gate',
        value: flight?.walkMinutes ? `${flight.walkMinutes} min` : null,
      },
      {
        key: 'security',
        label: 'Security',
        value: queue == null ? null : queue > 0 ? `${queue} min queue` : 'No queue',
      },
      { key: 'belt', label: 'Belt', value: flight?.baggageBelt || null },
    ]
    if (flight?.preClearance)
      columns.push({ key: 'preclearance', label: 'US pre-clearance', value: 'Before the gate' })
    if (flight?.stand) columns.push({ key: 'stand', label: 'Stand', value: flight.stand })
    return columns
  }
  if (segment.mode === 'train' || segment.mode === 'bus') {
    return [
      {
        key: 'platform',
        label: segment.mode === 'bus' ? 'Bay' : 'Platform',
        value: segment.platform || null,
      },
    ]
  }
  if (segment.mode === 'ferry') {
    return [
      { key: 'terminal', label: 'Terminal', value: terminalWord },
      { key: 'gate', label: 'Gate', value: gate },
    ]
  }
  return []
}

/** The ticket's first columns with something in them, as one line for a
    pill or a card row: "T2 · gate 406 · Zone 15 · Desks 1501–1520". */
export function ticketLine(segment: Segment): string {
  const said = (column: TicketColumn) =>
    column.key === 'gate' || column.key === 'belt' || column.key === 'platform'
      ? `${column.label.toLowerCase()} ${column.value}`
      : column.value
  return ticketColumns(segment)
    .filter(
      column => column.value && !['walk', 'security', 'preclearance', 'stand'].includes(column.key),
    )
    .map(said)
    .join(' · ')
}

export interface SourceLine {
  name: string
  /** "just now", "2 min ago", "1 h ago" */
  age: string
  quiet: boolean
  /** the board's own words, as it said them */
  said: string | null
}

/** Which board, how old, and whether it has gone quiet. */
export function flightSource(segment: Segment, now: number): SourceLine | null {
  const flight = segment.flight
  if (!flight) return null
  const heard = at(flight.fetchedAt) ?? at(flight.lastUpdated)
  const names = [...new Set((flight.sources || []).map(boardName))]
  const name = names.length ? names.join(' and ') : 'The airport'
  if (heard === null) return { name, age: '', quiet: false, said: flight.statusText || null }
  const minutes = Math.max(0, Math.round((now - heard) / 60_000))
  const age =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes} min ago`
        : `${Math.round(minutes / 60)} h ago`
  const over = OVER.has(flight.status)
  return {
    name,
    age,
    quiet: !over && now - heard > QUIET_AFTER_MS,
    said: flight.statusText || null,
  }
}
