import { useEffect, useMemo, useState } from 'react'
import { loadLive, subscribeToPositions } from '../../../backend'
import { liveRetryDelay, mergeLiveFixes } from '../../../live-positions-core'
import {
  deriveLiveStopProgress, describeLiveStopProgress, liveHistoryHours,
} from '../../../live-stop-progress-core'
import { agoLabel } from '../../../shared/lib/geo'
import type { Coordinates } from '../../../shared/model/types'
import { useDaylight } from '../../map'

export default function useLiveTrip({ tripId, trip, route, stops, family, mapOverride }) {
  /* Where the phones are. Fixes arrive on their own channel and move only the
     markers; nothing else is refetched for them. */
  const [phones, setPhones] = useState<any[]>([])
  const [fixes, setFixes] = useState<any[]>([])
  const [liveReady, setLiveReady] = useState(false)
  const [liveError, setLiveError] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const historyHours = liveHistoryHours(trip)
  useEffect(() => {
    let alive = true, stop = () => {}, retryTimer: ReturnType<typeof setTimeout> | null = null
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
    () => deriveLiveStopProgress({
      stops, fixes, now: new Date(now),
      sourceState: !liveReady ? 'loading' : liveError ? 'error' : 'ready',
    }), [stops, fixes, now, liveReady, liveError])
  const progressCopy = useMemo(
    () => describeLiveStopProgress(progress, new Date(now)), [progress, now])
  const latestFix = progress.latestFix
  const latestGpsPosition: Coordinates | null = latestFix
    ? [latestFix.lng, latestFix.lat] : null

  /* The freshest trustworthy phone fix drives the live camera. With no GPS,
     the route endpoint or first stop is only a neutral map centre: no traveller
     marker is rendered there and no stop is claimed as current. */
  const track = route
  const live = useMemo(() => {
    if (latestGpsPosition) return latestGpsPosition
    if (track.length) return track[track.length - 1]
    const s = stops[0]
    return s ? [s.lng, s.lat] : [4.876, 52.367]
  }, [latestGpsPosition, track, stops])
  const daylight = useDaylight(live)
  const mapTheme = mapOverride || daylight.base
  /* The wash was drawn for the basemap the sun would have chosen. Laid over the
     other one it only muddies it — a bright noon wash turns the dark base
     brown — so when the two disagree the wash steps aside and the map simply
     keeps the colour of the chosen theme. */
  const sun = useMemo(
    () => (mapTheme === daylight.base ? daylight : { ...daylight, alpha: 0 }),
    [mapTheme, daylight])

  // Only trustworthy live fixes get a marker. A planned route never impersonates a traveller.
  const fresh = progress.freshFixes
  const livePoints: Coordinates[] = useMemo(() => fresh.map(f => [f.lng, f.lat]), [fresh])
  const markers = useMemo(() => {
    return fresh.map(f => {
      const phone = phones.find(p => p.id === f.deviceId)
      const who = phone && family.find(p => p.id === phone.userId)
      const name = who?.name || phone?.name || 'Phone'
      return { key: f.deviceId || 'phone', lng: f.lng, lat: f.lat, avatar: who?.avatar || null, name,
               title: `${name} · ${agoLabel(f.at)}` }
    })
  }, [fresh, phones, family])

  // Each phone's path over the last day, poor fixes left out so the line does not spike.
  const trail = useMemo(() => {
    const by = new Map()
    for (const f of fixes) {
      if (f.accuracy != null && f.accuracy > 80) continue
      if (!by.has(f.deviceId)) by.set(f.deviceId, [])
      by.get(f.deviceId).push([f.lng, f.lat])
    }
    return [...by.values()].filter(l => l.length > 1)
  }, [fixes])
  return {
    phones, setPhones, fixes, track, live, livePoints, liveReady, sun, mapTheme,
    markers, trail, progress, progressCopy, latestGpsPosition,
  }
}


