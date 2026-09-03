import { metres } from './shared/lib/geo'
import type { Coordinates, Device, LiveFix } from './shared/model/types'

/* The sample trip, live. A real trip gets its motion from phones; the sample
   gets it from the clock. Maya walks a closed loop through the Saturday
   itinerary — Rijksmuseum steps, across Museumplein, the length of
   Vondelpark, up to Foodhallen for a long dwell, back along Kinkerstraat —
   and her position is a pure function of wall time, so the walk never stops,
   every visitor watches the same moment, and a reload changes nothing.

   The numbers here are chosen against the real thresholds: dwells sit well
   inside ARRIVAL_RADIUS_METRES at under the arrival speed, so the capsule
   honestly says she has arrived; walking speed is a human 1.4 m/s, so
   "heading to" and "approaching" fire on the way; accuracies stay under the
   trail's 80 m cut so every fix draws. */

interface Waypoint {
  at: Coordinates
  /** seconds spent standing here before walking on */
  dwellS?: number
  /** metres per second to the NEXT waypoint — the train is not a stroll */
  speedMS?: number
}

const WALK_METRES_PER_SECOND = 1.4
const TRAIN_METRES_PER_SECOND = 16
const FIX_STEP_S = 30
const LOOP_HISTORY_S = 2 * 60 * 60 // two hours of laps behind her
const MAYA = 'sample-phone-maya'
const ALEX = 'sample-phone-alex'

/* Saturday's loop. Starts and ends on the Rijksmuseum steps — which is also
   where the morning commute ends, so the two histories join without a seam. */
const LOOP: Waypoint[] = [
  { at: [4.8852, 52.36], dwellS: 240 }, // Rijksmuseum steps, one more look
  { at: [4.883, 52.3585] }, // across the Museumplein lawn
  { at: [4.8811, 52.3618] }, // Vondelpark gate
  { at: [4.877, 52.3597] }, // the pond
  { at: [4.8722, 52.3581] }, // mid-park
  { at: [4.8672, 52.3585] }, // west bend
  { at: [4.8654, 52.3606] }, // north exit
  { at: [4.8668, 52.3635] }, // J.P. Heijestraat
  { at: [4.8686, 52.3663], dwellS: 360 }, // Foodhallen — lunch with Alex
  { at: [4.8745, 52.367] }, // Kinkerstraat
  { at: [4.8779, 52.3641] }, // Bilderdijkstraat
  { at: [4.8807, 52.3625] }, // back toward the park's edge
  { at: [4.8836, 52.3607] }, // Hobbemastraat
]

/* The walk that put the trail on the map before the loop began: Hotel Jakarta
   to the museum, the long way that a first morning actually goes — Damrak,
   Rokin, the Munt, then Vijzelstraat down to the Singelgracht. Enough corners
   that the line reads as streets, not as a ruler laid over the canal belt. */
const MORNING: Waypoint[] = [
  { at: [4.935, 52.3793], dwellS: 300 }, // Hotel Jakarta, slow breakfast
  { at: [4.927, 52.3768] },
  { at: [4.9152, 52.3752] },
  { at: [4.9041, 52.3776], dwellS: 120 }, // Centraal, deciding against the tram
  { at: [4.896, 52.3752] }, // Damrak
  { at: [4.8936, 52.373] }, // Dam
  { at: [4.8925, 52.37] }, // Rokin
  { at: [4.894, 52.3666] }, // Muntplein
  { at: [4.8922, 52.3625] }, // Vijzelstraat
  { at: [4.8905, 52.3598] }, // Weteringcircuit
  { at: [4.8875, 52.3595] }, // along the Singelgracht
  { at: [4.8852, 52.36] }, // museum steps — the loop takes over here
]

/* Friday, so the record says what the itinerary says: wheels down, the train
   into town, the hotel, and the canal cruise at golden hour. Without this the
   progress machinery — honestly — announced Schiphol as up next. */
const FRIDAY: Waypoint[] = [
  { at: [4.7639, 52.3105], dwellS: 1500, speedMS: TRAIN_METRES_PER_SECOND }, // Schiphol, bags
  { at: [4.809, 52.357], speedMS: TRAIN_METRES_PER_SECOND }, // the train, Lelylaan
  { at: [4.8378, 52.3888], speedMS: TRAIN_METRES_PER_SECOND }, // Sloterdijk curve
  { at: [4.9003, 52.379], dwellS: 420 }, // Centraal, finding the exit
  { at: [4.915, 52.3768] }, // along the IJ waterfront
  { at: [4.9265, 52.3782] },
  { at: [4.935, 52.3793], dwellS: 5400 }, // Hotel Jakarta — check-in, a nap
  { at: [4.9245, 52.3775] }, // back out for the evening
  { at: [4.9041, 52.3776] },
  { at: [4.8935, 52.3762] }, // Nieuwendijk wander
  { at: [4.884, 52.374], dwellS: 5400 }, // the canal cruise, from the Jordaan dock
  { at: [4.8935, 52.3762] },
  { at: [4.9041, 52.3776] }, // Prins Hendrikkade back
  { at: [4.9265, 52.3782] },
  { at: [4.935, 52.3793], dwellS: 600 }, // hotel, done for the day
]

interface Leg {
  from: Coordinates
  to: Coordinates
  startS: number
  endS: number
  /** metres per second while on this leg; 0 is a dwell */
  speedMS: number
}

/* A path becomes a timetable: every leg knows when it starts and ends, dwells
   included, so position-at-time is one scan and a lerp. */
function schedule(points: Waypoint[], closed: boolean): { legs: Leg[]; totalS: number } {
  const legs: Leg[] = []
  let clock = 0
  const step = (from: Waypoint, to: Waypoint) => {
    if (from.dwellS) {
      legs.push({
        from: from.at,
        to: from.at,
        startS: clock,
        endS: clock + from.dwellS,
        speedMS: 0,
      })
      clock += from.dwellS
    }
    const speed = from.speedMS ?? WALK_METRES_PER_SECOND
    const seconds = Math.max(1, metres(from.at, to.at) / speed)
    legs.push({ from: from.at, to: to.at, startS: clock, endS: clock + seconds, speedMS: speed })
    clock += seconds
  }
  for (let index = 0; index < points.length - 1; index++) step(points[index], points[index + 1])
  if (closed) step(points[points.length - 1], points[0])
  return { legs, totalS: clock }
}

const loop = schedule(LOOP, true)
const morning = schedule(MORNING, false)
const friday = schedule(FRIDAY, false)

function positionOn(
  { legs, totalS }: { legs: Leg[]; totalS: number },
  second: number,
): { at: Coordinates; speedMS: number } {
  const t = ((second % totalS) + totalS) % totalS
  for (const leg of legs) {
    if (t > leg.endS) continue
    const span = leg.endS - leg.startS
    const share = span > 0 ? (t - leg.startS) / span : 0
    return {
      at: [
        leg.from[0] + (leg.to[0] - leg.from[0]) * share,
        leg.from[1] + (leg.to[1] - leg.from[1]) * share,
      ],
      speedMS: leg.speedMS,
    }
  }
  return { at: legs[0].from, speedMS: 0 }
}

/* A little believable wobble — GPS never draws a ruler line. Deterministic
   from the timestamp, a couple of metres, nothing the simplifier keeps. */
const wobble = (epochS: number, salt: number): Coordinates => [
  Math.sin(epochS / 7 + salt) * 0.000024,
  Math.cos(epochS / 9 + salt * 2) * 0.000015,
]

function mayaFixAt(epochMs: number): LiveFix {
  const second = Math.floor(epochMs / 1000)
  const spot = positionOn(loop, second)
  const [jx, jy] = wobble(second, 1)
  return {
    deviceId: MAYA,
    id: `${MAYA}-${second - (second % FIX_STEP_S)}`,
    lng: spot.at[0] + jx,
    lat: spot.at[1] + jy,
    at: new Date(epochMs),
    accuracy: spot.speedMS > 0 ? 18 : 32,
    speed: spot.speedMS,
  }
}

function alexFixAt(epochMs: number): LiveFix {
  const second = Math.floor(epochMs / 1000)
  const [jx, jy] = wobble(second, 5)
  return {
    deviceId: ALEX,
    id: `${ALEX}-${second - (second % 60)}`,
    lng: 4.8688 + jx,
    lat: 52.3662 + jy,
    at: new Date(epochMs),
    accuracy: 24,
    speed: 0,
  }
}

/** the fixes a subscribe tick delivers: where everyone is right now */
export function sampleLiveNow(now = new Date()): LiveFix[] {
  return [mayaFixAt(now.getTime()), alexFixAt(now.getTime())]
}

/** the full backlog a page load asks for: the morning walk, the laps since */
export function sampleLiveHistory(now = new Date()): { devices: Device[]; fixes: LiveFix[] } {
  const nowMs = now.getTime()
  const fixes: LiveFix[] = []

  /* The loop's timetable runs on absolute time, so the last moment its clock
     read zero is a fixed point in the world — the morning walk is laid down
     to END there, stepping straight onto the loop with no gap and no seam. */
  const loopStartMs = nowMs - LOOP_HISTORY_S * 1000
  const second = Math.floor(loopStartMs / 1000)
  const phaseS = ((second % loop.totalS) + loop.totalS) % loop.totalS
  const loopZeroMs = loopStartMs - phaseS * 1000

  const walked = (
    walk: { legs: Leg[]; totalS: number },
    endMs: number,
    salt: number,
    tag: string,
  ) => {
    for (let t = endMs - walk.totalS * 1000; t < endMs; t += FIX_STEP_S * 1000) {
      const spot = positionOn(walk, (t - endMs) / 1000 + walk.totalS)
      const [jx, jy] = wobble(Math.floor(t / 1000), salt)
      fixes.push({
        deviceId: MAYA,
        id: `${MAYA}-${tag}-${Math.floor(t / 1000)}`,
        lng: spot.at[0] + jx,
        lat: spot.at[1] + jy,
        at: new Date(t),
        accuracy: spot.speedMS > 0 ? 20 : 40,
        speed: spot.speedMS,
      })
    }
  }
  /* Friday ends back at the hotel around "yesterday evening": anchored so the
     overnight quiet is a real gap and the trail honestly starts a new line. */
  walked(friday, nowMs - 21 * 3_600_000, 4, 'f')
  walked(morning, loopZeroMs, 3, 'm')
  for (let t = loopZeroMs; t <= nowMs; t += FIX_STEP_S * 1000) fixes.push(mayaFixAt(t))

  // Alex has been holding the Foodhallen table for three quarters of an hour.
  for (let t = nowMs - 45 * 60_000; t <= nowMs; t += 60_000) fixes.push(alexFixAt(t))

  const devices: Device[] = [
    { id: MAYA, name: "Maya's phone", userId: 'u1', lastSeen: now },
    { id: ALEX, name: "Alex's phone", userId: 'u2', lastSeen: now },
  ]
  return { devices, fixes }
}
