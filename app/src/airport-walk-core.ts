/* Through the airport, one place at a time.

   The board says where a departure's bags go — a zone, a run of desks — and,
   nearer the time, which gate it leaves from; the terminal's floor plan says
   where those are. This turns the two into the walk a traveller actually
   makes, bag drop, then security, then the gate, and keeps its place in it
   the way the itinerary keeps its place: a stage is reached by coming within
   range of it and finished by leaving it, or by being found at a later one.
   The gate is never finished — wander off for a coffee and the walk points
   back. A gate the board has not named yet is still a stage, one that says
   when it will be.

   All of it a function of a leg, a floor plan, a position and a clock, so
   the whole walk is tested without a map. */

import { isAirportStop, type IndoorFeature } from './airport-indoor-core'
import { stepMetres } from './airport-route-core'
import { localTime, type Segment } from './segments-core'
import type { Coordinates, Stop } from './shared/model/types'

/** Somewhere a route can be planned to — the same shape as a tapped gate. */
export interface WalkPoint {
  ref: string
  lng: number
  lat: number
  levels: number[]
}

export type WalkStageKind = 'bagdrop' | 'security' | 'gate'

export interface WalkStage {
  kind: WalkStageKind
  /** what the capsule leads with: "Bag drop", "Security", "Gate 104" */
  title: string
  /** the board's word on it: "Zone 6 · Desks 606–609", "8 min queue", "not announced yet · by 12:15" */
  detail: string
  /** where it is, when the floor plan has it */
  at: WalkPoint | null
}

export interface WalkState {
  done: WalkStageKind[]
  /** the stage the traveller has been within range of, when it is the current one */
  reached: WalkStageKind | null
}

export const WALK_START: WalkState = { done: [], reached: null }

/* At the airport: within this of the leg's origin. The itinerary's arrival
   radius would call the hotel across the motorway "there"; a terminal is a
   big building and its car parks are bigger. */
export const WALK_AIRPORT_METRES = 2500
/* Within range of a desk or a gate, and gone from it — two numbers, well
   apart, so a fix wandering under a roof does not arrive and leave by the
   minute. */
export const WALK_IN_METRES = 60
export const WALK_OUT_METRES = 130
const HOURS_BEFORE = 6
const MINUTES_AFTER = 45
const SAME_AIRPORT_METRES = 2000

const OVER = new Set(['departed', 'landed', 'arrived', 'cancelled', 'diverted'])
const departure = (leg: Segment) => Date.parse(leg.flight?.estimatedDeparture || leg.departsAt)

/** The flight the traveller is at the airport for: at its origin, in the hours before it. */
export function walkLeg(
  segments: readonly Segment[] | null | undefined,
  position: Coordinates | null | undefined,
  now: number,
): Segment | null {
  if (!position) return null
  let best: Segment | null = null
  for (const leg of segments || []) {
    if (leg.mode !== 'flight' || leg.fromLng == null || leg.fromLat == null) continue
    if (leg.status === 'done' || leg.status === 'cancelled') continue
    if (leg.flight?.status && OVER.has(leg.flight.status)) continue
    const departs = departure(leg)
    if (!Number.isFinite(departs)) continue
    if (departs < now - MINUTES_AFTER * 60_000 || departs > now + HOURS_BEFORE * 3_600_000) continue
    if (stepMetres(position, [leg.fromLng, leg.fromLat]) > WALK_AIRPORT_METRES) continue
    if (!best || departs < departure(best)) best = leg
  }
  return best
}

/** The itinerary's own stop for the leg's airport, or one made from the leg. */
export function walkStop(leg: Segment, stops?: readonly Stop[] | null): Stop {
  const origin: Coordinates = [leg.fromLng as number, leg.fromLat as number]
  const own = (stops || []).find(
    stop => isAirportStop(stop) && stepMetres(origin, [stop.lng, stop.lat]) < SAME_AIRPORT_METRES,
  )
  return (
    own || {
      id: `leg-${leg.id}`,
      name: leg.fromName,
      lng: origin[0],
      lat: origin[1],
      icon: 'plane',
    }
  )
}

/** Whether an open terminal is the leg's airport. */
export function sameAirport(
  stop: { lng: number; lat: number } | null | undefined,
  leg: Segment | null | undefined,
) {
  if (!stop || !leg || leg.fromLng == null || leg.fromLat == null) return false
  return stepMetres([stop.lng, stop.lat], [leg.fromLng, leg.fromLat]) < SAME_AIRPORT_METRES
}

const pointOf = (f: IndoorFeature): WalkPoint | null =>
  f.geometry.type === 'Point'
    ? {
        ref: f.properties.ref || f.properties.name,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        levels: f.properties.levels,
      }
    : null

const gateRef = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^GATE\s+/, '')

/* "606-609", "606–609", "Desks 13-20", "12": the numbers a desk row is
   written with, as the spans they cover. */
function spans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const rest = text.replace(/(\d+)\s*[-–—]\s*(\d+)/g, (_, a: string, b: string) => {
    out.push([Math.min(+a, +b), Math.max(+a, +b)])
    return ' '
  })
  for (const single of rest.match(/\d+/g) || []) out.push([+single, +single])
  return out
}
const overlap = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1]

/* How well a mapped desk answers the board: its numbers cover the desks
   named (3), or it carries the zone's number or name (2). Anything less is a
   guess, and a guess in a hall with fourteen zones is worse than no pointer. */
function deskScore(f: IndoorFeature, zone: string, desks: string): number {
  const text = `${f.properties.ref} ${f.properties.name}`
  const found = spans(text)
  const wanted = spans(desks)
  if (wanted.length && found.some(range => wanted.some(want => overlap(range, want)))) return 3
  const word = zone.trim()
  if (!word) return 0
  if (/^\d+$/.test(word)) return found.some(([from, to]) => from === to && from === +word) ? 2 : 0
  return text.toLowerCase().includes(word.toLowerCase()) ? 2 : 0
}

function bagDrop(
  features: readonly IndoorFeature[],
  zone: string,
  desks: string,
  from: Coordinates | null,
): WalkPoint | null {
  const mapped = features.filter(f => f.properties.cat === 'checkin' && f.geometry.type === 'Point')
  let best: IndoorFeature | null = null
  let bestScore = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const f of mapped) {
    const score = deskScore(f, zone, desks)
    if (!score || f.geometry.type !== 'Point') continue
    const distance = from ? stepMetres(from, f.geometry.coordinates) : 0
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = f
      bestScore = score
      bestDistance = distance
    }
  }
  // One check-in in the whole terminal is not a guess.
  if (!best && mapped.length === 1) best = mapped[0]
  return best ? pointOf(best) : null
}

function securityNear(
  features: readonly IndoorFeature[],
  anchor: Coordinates | null,
): WalkPoint | null {
  let best: IndoorFeature | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const f of features) {
    if (f.properties.cat !== 'security' || f.geometry.type !== 'Point') continue
    const distance = anchor ? stepMetres(anchor, f.geometry.coordinates) : 0
    if (distance < bestDistance) {
      best = f
      bestDistance = distance
    }
  }
  return best ? pointOf(best) : null
}

function gateAt(features: readonly IndoorFeature[], gate: string): WalkPoint | null {
  const want = gateRef(gate)
  if (!want) return null
  const found = features.find(
    f => f.properties.kind === 'gate' && gateRef(f.properties.ref) === want,
  )
  return found ? pointOf(found) : null
}

const BOARDING_WORDS: Record<string, string> = {
  'go-to-gate': 'Go to gate',
  boarding: 'Boarding',
  'final-call': 'Final call',
  closed: 'Gate closed',
}
// Dublin numbers its zones; Pearson names its aisles. The ticket's wording.
const zoneWord = (zone: string) => (zone ? (/^\d+$/.test(zone) ? `Zone ${zone}` : zone) : '')
const desksWord = (desks: string) => (desks ? `Desks ${desks.replace('-', '–')}` : '')

/**
 * The walk, in order, for a flight: bag drop for whoever has a bag and
 * while the desks are open, security where the floor plan has it, and the
 * gate always — named or not, mapped or not.
 */
export function walkStages(
  leg: Segment,
  features: readonly IndoorFeature[] | null | undefined,
  from: Coordinates | null,
  now: number,
): WalkStage[] {
  if (leg.mode !== 'flight') return []
  const flight = leg.flight || null
  const mapped = features || []
  const stages: WalkStage[] = []

  const bagsClose = Date.parse(leg.deadlines?.bagsCloseAt || '')
  const carryOnOnly = !!leg.bags && !leg.bags.checked
  const bagsOver = Number.isFinite(bagsClose) && bagsClose <= now
  if (!carryOnOnly && !bagsOver) {
    const zone = flight?.checkinZone || ''
    const desks = flight?.checkinDesks || ''
    const at = bagDrop(mapped, zone, desks, from)
    const detail = [zoneWord(zone), desksWord(desks)].filter(Boolean).join(' · ') || at?.ref || ''
    if (detail || at) stages.push({ kind: 'bagdrop', title: 'Bag drop', detail, at })
  }

  const desk = stages[0]?.at
  const security = securityNear(mapped, desk ? [desk.lng, desk.lat] : from)
  if (security) {
    const queue = flight?.securityWaitMinutes
    const detail = queue == null ? '' : queue > 0 ? `${queue} min queue` : 'No queue'
    stages.push({ kind: 'security', title: 'Security', detail, at: security })
  }

  const gate = leg.gate || flight?.gate || ''
  const at = gateAt(mapped, gate)
  const words: string[] = []
  if (!gate) {
    words.push('not announced yet')
    if (flight?.goToGateTime) words.push(`by ${localTime(flight.goToGateTime, leg.departTz)}`)
  } else {
    const boarding = BOARDING_WORDS[flight?.boardingStatus || '']
    if (boarding) words.push(boarding)
    if (!at && flight?.walkMinutes) words.push(`${flight.walkMinutes} min walk`)
  }
  stages.push({
    kind: 'gate',
    title: gate ? `Gate ${gate}` : 'Gate',
    detail: words.join(' · '),
    at,
  })
  return stages
}

export const currentStage = (stages: readonly WalkStage[], state: WalkState): WalkStage | null =>
  stages.find(stage => !state.done.includes(stage.kind)) || null

const metresTo = (position: Coordinates, at: WalkPoint | null) =>
  at ? stepMetres(position, [at.lng, at.lat]) : Number.POSITIVE_INFINITY

/**
 * Where the walk is now, given where the traveller is: the current stage is
 * reached within range and finished on leaving it — or on being found nearer
 * a later one, which means it is behind them. The last stage is never
 * finished, only left and come back to.
 */
export function advanceWalk(
  state: WalkState,
  stages: readonly WalkStage[],
  position: Coordinates | null | undefined,
): WalkState {
  let next = state
  for (let guard = 0; guard <= stages.length; guard++) {
    const index = stages.findIndex(stage => !next.done.includes(stage.kind))
    const stage = stages[index]
    if (!stage || !position) return next
    const here = metresTo(position, stage.at)
    const beyond = stages.slice(index + 1).some(later => {
      const there = metresTo(position, later.at)
      return there <= WALK_IN_METRES && there < here
    })
    if (beyond) {
      next = { done: [...next.done, stage.kind], reached: null }
      continue
    }
    if (here <= WALK_IN_METRES) {
      return next.reached === stage.kind ? next : { ...next, reached: stage.kind }
    }
    if (next.reached !== stage.kind || here < WALK_OUT_METRES) return next
    if (index === stages.length - 1) return { ...next, reached: null }
    next = { done: [...next.done, stage.kind], reached: null }
  }
  return next
}

/** The traveller says they are done here; the last stage has nowhere to go. */
export function skipStage(state: WalkState, stages: readonly WalkStage[]): WalkState {
  const stage = currentStage(stages, state)
  if (!stage || stage === stages[stages.length - 1]) return state
  return { done: [...state.done, stage.kind], reached: null }
}
