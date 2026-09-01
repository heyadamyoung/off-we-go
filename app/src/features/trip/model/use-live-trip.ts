import { useEffect, useMemo, useState } from 'react'
import { loadLive, subscribeToPositions } from '../../../backend'
import { mergeLiveFixes } from '../../../live-positions-core'
import { deriveLiveStopProgress, describeLiveStopProgress } from '../../../live-stop-progress-core'
import { agoLabel } from '../../../shared/lib/geo'
import type { Coordinates } from '../../../shared/model/types'
import { useDaylight } from '../../map'

export default function useLiveTrip({ tripId, route, stops, family, mapOverride }) {
  /* Where the phones are. Fixes arrive on their own channel and move only the
     markers; nothing else is refetched for them. */
  const [phones, setPhones] = useState<any[]>([])
  const [fixes, setFixes] = useState<any[]>([])
  const [liveReady, setLiveReady] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true, stop = () => {}
    setLiveReady(false)
    loadLive(tripId)
      .then(r => {
        if (!alive) return
        setPhones(r.devices)
        setFixes(r.fixes)
        setLiveReady(true)
        stop = subscribeToPositions(tripId, fix => setFixes(list => mergeLiveFixes(list, [fix])), r.cursor)
      })
      .catch(() => { if (alive) setLiveReady(true) })
    return () => { alive = false; stop() }
  }, [tripId])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const progress = useMemo(
    () => deriveLiveStopProgress({ stops, fixes, now: new Date(now) }), [stops, fixes, now])
  const progressCopy = useMemo(
    () => describeLiveStopProgress(progress, new Date(now)), [progress, now])
  const latestFix = progress.latestFix

  /* Where the family is. The most recent fix from any phone; with none, the
     end of the walked route if one has been drawn; failing that, the stop
     marked "now", then the next one up, then the first. Nothing is simulated:
     a marker that strolled a demo route on its own timer was fine for a sample
     and a lie about a real trip. */
  const track = route
  const live = useMemo(() => {
    if (latestFix) return [latestFix.lng, latestFix.lat]
    if (track.length) return track[track.length - 1]
    const s = stops[0]
    return s ? [s.lng, s.lat] : [4.876, 52.367]
  }, [latestFix, track, stops])
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
    markers, trail, progress, progressCopy,
  }
}


