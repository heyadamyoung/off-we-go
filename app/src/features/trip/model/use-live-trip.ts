import { useEffect, useMemo, useState } from 'react'
import { loadLive, subscribeToPositions } from '../../../backend'
import { mergeLiveFixes } from '../../../live-positions-core'
import { agoLabel, routeKm, trailKm } from '../../../shared/lib/geo'
import type { Coordinates } from '../../../shared/model/types'
import { useDaylight } from '../../map'

export default function useLiveTrip({ tripId, route, stops, family, mapOverride }) {
  /* Where the phones are. Fixes arrive on their own channel and move only the
     markers; nothing else is refetched for them. */
  const [phones, setPhones] = useState([])
  const [fixes, setFixes] = useState([])
  const [liveReady, setLiveReady] = useState(false)
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

  const latestByPhone = useMemo(() => {
    const m = new Map()
    for (const f of fixes) { const cur = m.get(f.deviceId); if (!cur || f.at > cur.at) m.set(f.deviceId, f) }
    return m
  }, [fixes])
  const latestFix = useMemo(() => {
    let best = null
    for (const f of latestByPhone.values()) if (!best || f.at > best.at) best = f
    return best
  }, [latestByPhone])

  /* Where the family is. The most recent fix from any phone; with none, the
     end of the walked route if one has been drawn; failing that, the stop
     marked "now", then the next one up, then the first. Nothing is simulated:
     a marker that strolled a demo route on its own timer was fine for a sample
     and a lie about a real trip. */
  const track = route
  const live = useMemo(() => {
    if (latestFix) return [latestFix.lng, latestFix.lat]
    if (track.length) return track[track.length - 1]
    const s = stops.find(x => x.status === 'now') || stops.find(x => x.status === 'next') || stops[0]
    return s ? [s.lng, s.lat] : [4.876, 52.367]
  }, [latestFix, track, stops])
  const sun = useDaylight(live)
  const mapTheme = mapOverride || sun.base

  // Kilometres from the phones when they have reported today, else the drawn route.
  const km = useMemo(() => trailKm(fixes) || routeKm(track), [fixes, track])

  // One marker per phone heard from in the last day; none reporting, one for the family.
  const fresh = useMemo(
    () => [...latestByPhone.values()].filter(f => Date.now() - f.at.getTime() < 24 * 3600_000),
    [latestByPhone],
  )
  const livePoints: Coordinates[] = useMemo(() => fresh.map(f => [f.lng, f.lat]), [fresh])
  const markers = useMemo(() => {
    if (!fresh.length) {
      return [{ key: 'family', lng: live[0], lat: live[1], avatar: family[0]?.avatar || null,
                name: family[0]?.name, title: 'The family is here' }]
    }
    return fresh.map(f => {
      const phone = phones.find(p => p.id === f.deviceId)
      const who = phone && family.find(p => p.id === phone.userId)
      const name = who?.name || phone?.name || 'Phone'
      return { key: f.deviceId, lng: f.lng, lat: f.lat, avatar: who?.avatar || null, name,
               title: `${name} · ${agoLabel(f.at)}` }
    })
  }, [fresh, phones, family, live])

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
  return { phones, setPhones, fixes, track, live, livePoints, liveReady, sun, mapTheme, km, markers, trail }
}


