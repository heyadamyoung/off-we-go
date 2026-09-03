import { useEffect, useMemo, useRef, useState } from 'react'
import { loadLive, subscribeToPositions } from '../../../backend'
import { buildTrail } from '../../../trail-core'
import { LIVE_FIX_MAX_AGE_MS } from '../../../live-freshness-core'
import { liveRetryDelay, mergeLiveFixes } from '../../../live-positions-core'
import { aliveFixes, followPoints, livePhoneMarkers } from '../../../live-markers-core'
import { track as trackEvent } from '../../../shared/lib/telemetry'
import {
  deriveLiveStopProgress,
  describeLiveStopProgress,
  liveHistoryHours,
} from '../../../live-stop-progress-core'
import type {
  Coordinates,
  Device,
  Id,
  LiveFix,
  Person,
  Stop,
  Trip,
} from '../../../shared/model/types'
import { useDaylight } from '../../map'

export default function useLiveTrip({
  tripId,
  trip,
  route,
  stops,
  family,
  mapOverride,
}: {
  tripId: Id
  trip: Trip
  route: Coordinates[]
  stops: Stop[]
  family: Person[]
  mapOverride: string | null
}) {
  /* Where the phones are. Fixes arrive on their own channel and move only the
     markers; nothing else is refetched for them. */
  const [phones, setPhones] = useState<Device[]>([])
  const [fixes, setFixes] = useState<LiveFix[]>([])
  const [liveReady, setLiveReady] = useState(false)
  const [liveError, setLiveError] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const historyHours = liveHistoryHours(trip)
  useEffect(() => {
    let alive = true,
      stop = () => {},
      retryTimer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    setPhones([])
    setFixes([])
    setLiveReady(false)
    setLiveError(false)
    const connect = () => {
      loadLive(tripId, { hours: historyHours })
        .then(r => {
          if (!alive) return
          failures = 0
          setPhones(r.devices)
          setFixes(r.fixes)
          setLiveReady(true)
          setLiveError(false)
          stop = subscribeToPositions(
            tripId,
            fix => setFixes(list => mergeLiveFixes(list, [fix])),
            r.cursor,
            {
              hours: historyHours,
              onState: state => {
                if (alive) setLiveError(state === 'error')
              },
            },
          )
        })
        .catch(() => {
          if (!alive) return
          setLiveError(true)
          setLiveReady(true)
          retryTimer = setTimeout(connect, liveRetryDelay(failures++))
        })
    }
    connect()
    return () => {
      alive = false
      if (retryTimer) clearTimeout(retryTimer)
      stop()
    }
  }, [tripId, historyHours])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const progress = useMemo(
    () =>
      deriveLiveStopProgress({
        stops,
        fixes,
        now: new Date(now),
        devices: phones,
        sourceState: !liveReady ? 'loading' : liveError ? 'error' : 'ready',
      }),
    [stops, fixes, now, phones, liveReady, liveError],
  )
  const progressCopy = useMemo(
    () => describeLiveStopProgress(progress, new Date(now)),
    [progress, now],
  )
  const latestFix = progress.latestFix
  const latestGpsPosition: Coordinates | null = latestFix ? [latestFix.lng, latestFix.lat] : null

  /* The freshest trustworthy phone fix drives the live camera. With no GPS,
     the route endpoint or first stop is only a neutral map centre: no traveller
     marker is rendered there and no stop is claimed as current. */
  const track = route
  /* Content-keyed for the same reason as livePoints below: latestGpsPosition
     is a fresh array every 30-second progress recompute, and a new `live`
     identity re-armed the follow ease with nobody having moved. */
  const liveKey = latestGpsPosition ? latestGpsPosition.join(',') : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveKey carries latestGpsPosition's content; the array identity churns by design
  const live = useMemo<Coordinates>(() => {
    if (latestGpsPosition) return latestGpsPosition
    if (track.length) return track[track.length - 1]
    const s = stops[0]
    return s ? [s.lng, s.lat] : [4.876, 52.367]
  }, [liveKey, track, stops])
  const daylight = useDaylight(live)
  const mapTheme = mapOverride || daylight.base
  /* The wash was drawn for the basemap the sun would have chosen. Laid over the
     other one it only muddies it — a bright noon wash turns the dark base
     brown — so when the two disagree the wash steps aside and the map simply
     keeps the colour of the chosen theme. */
  const sun = useMemo(
    () => (mapTheme === daylight.base ? daylight : { ...daylight, alpha: 0 }),
    [mapTheme, daylight],
  )

  // Only trustworthy live fixes steer the arrival math and the camera. The
  // LIVE chip is a different question — "is this phone talking?" — answered
  // by recency alone: a car's cradle-grade fixes glide the dot and must
  // light the chip, however wide their accuracy circle.
  const fresh = progress.freshFixes
  const alive = useMemo(() => aliveFixes(fixes, now, LIVE_FIX_MAX_AGE_MS), [fixes, now])

  /* A phone that has gone quiet keeps its dot where it was last heard from,
     and framing follows whoever is reporting — or, with nobody reporting, the
     last place anyone was, which is the only answer there is. */
  const markers = useMemo(
    () => livePhoneMarkers({ fixes, fresh: alive, phones, family }),
    [fixes, alive, phones, family],
  )
  /* The verdict itself is telemetry: when a phone's liveness flips, say so —
     "dot glides, chip dark" was undiagnosable from the wire alone. */
  const liveness = useRef(new Map<string, boolean>())
  useEffect(() => {
    for (const marker of markers) {
      const wasLive = liveness.current.get(marker.key)
      const isLive = !marker.stale
      if (wasLive !== undefined && wasLive !== isLive) {
        trackEvent('flip phone liveness', { phone: marker.name, live: String(isLive) })
      }
      liveness.current.set(marker.key, isLive)
    }
  }, [markers])
  /* Stable by CONTENT, not by derivation: progress recomputes on a 30-second
     clock and hands back fresh arrays every time, and a new identity here
     re-armed the follow ease — the camera nudged itself half a chrome-offset
     north twice a minute, forever. The points may only change identity when a
     phone actually moved. */
  const rawPoints: Coordinates[] = useMemo(() => followPoints(fresh, fixes), [fresh, fixes])
  const pointsKey = rawPoints.map(point => point.join(',')).join(';')
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key IS the content; rawPoints identity churns by design
  const livePoints = useMemo(() => rawPoints, [pointsKey])

  /* Each phone's path, cleaned for drawing: poor fixes out, a long quiet gap
     starts a new line instead of a false straight across town, and jitter is
     simplified away so one street is one stroke. The rules live in
     trail-core, where they are tested without a map.

     Split by age: the last twelve hours draw at full strength, everything
     before at a ghost — old loops must not impersonate today's walking,
     which is exactly how a stale trail once read as a live one. */
  const trail = useMemo(
    () => buildTrail(fixes.filter(fix => now - fix.at.getTime() <= TRAIL_RECENT_MS)),
    [fixes, now],
  )
  const trailFaded = useMemo(
    () => buildTrail(fixes.filter(fix => now - fix.at.getTime() > TRAIL_RECENT_MS)),
    [fixes, now],
  )
  return {
    phones,
    setPhones,
    fixes,
    track,
    live,
    livePoints,
    liveReady,
    sun,
    mapTheme,
    markers,
    trail,
    trailFaded,
    progress,
    progressCopy,
    latestGpsPosition,
  }
}

const TRAIL_RECENT_MS = 12 * 60 * 60_000
