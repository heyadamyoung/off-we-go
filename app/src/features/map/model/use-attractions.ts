import { useEffect, useRef, useState } from 'react'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { hasBackend, loadAttractions } from '../../../backend'
import { attractionsInCell, cellsCovering, isHeadline } from '../api/attractions'
import type { AttractionPoi, MapView } from '../../../shared/model/types'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/* Which attraction cells the screen is touching, and everything ever fetched.

   Cells are asked for one at a time and abandoned the moment the view moves
   again, so a long pan does not queue up a hundred requests for country you
   have already left. Anything fetched stays: the layer only ever grows. */
const boxFor = (view: MapView) => {
  const scale = 360 / (256 * 2 ** view.zoom)
  const lngSpan = window.innerWidth * scale
  const latSpan = window.innerHeight * scale * Math.cos((view.center[1] * Math.PI) / 180)
  return {
    west: view.center[0] - lngSpan / 2,
    east: view.center[0] + lngSpan / 2,
    south: view.center[1] - latSpan / 2,
    north: view.center[1] + latSpan / 2,
  }
}

const featureFor = (poi: AttractionPoi): Feature<Point> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [poi.x, poi.y] },
  properties: {
    id: poi.id,
    n: poi.n,
    d: poi.d,
    k: poi.k,
    f: poi.f || '',
    big: isHeadline(poi.k),
  },
})

/* Where the attractions come from.

   Seeded, they are one indexed bounding-box query: everything on screen, in a
   single round trip, the same for everyone who opens the app. Nobody's phone
   pays to rediscover Edinburgh Castle.

   Unseeded — no database configured, or the table still empty — the map falls
   back to asking Wikipedia directly, ten kilometres at a time, and keeps what
   it finds in that browser. It works, but every visitor pays for it again, and
   only for the ground they personally wandered over. That fallback is what
   this was before there was anywhere to put the answers. */
function useAttractions(view: MapView, enabled: boolean) {
  const seen = useRef(new Map<number, AttractionPoi>())
  const [data, setData] = useState<FeatureCollection>(EMPTY_FC)
  const [filling, setFilling] = useState(0)
  /* Two ways this can go wrong, and they want different answers. A database
     that errors is out for the session. A database that simply holds nothing
     for the region you have panned to is fine — it has not been filled that
     far — so the live walk covers that view, and the next region that is in
     the table still comes back in one query. */
  const [dbUp, setDbUp] = useState(hasBackend)
  const [dbBlankHere, setDbBlankHere] = useState(false)
  const dirty = useRef(false)

  const handOn = useRef(false)
  useEffect(() => {
    const down = () => {
      handOn.current = true
    }
    const up = () => {
      handOn.current = false
    }
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', up, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  /* ---- seeded: one query per view ------------------------------------- */
  useEffect(() => {
    if (!enabled || !dbUp || view.zoom < 5) return
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const rows = await loadAttractions(boxFor(view), { headlineOnly: view.zoom < 10.5 })
        if (!alive || !rows) return
        setDbBlankHere(rows.length === 0)
        if (rows.length) setData({ type: 'FeatureCollection', features: rows.map(featureFor) })
      } catch {
        if (alive) setDbUp(false) // fall back rather than show nothing
      }
    }, 260)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [view, enabled, dbUp])

  /* ---- unseeded: walk Wikipedia in ten-kilometre cells ----------------- */
  useEffect(() => {
    if (!enabled || (dbUp && !dbBlankHere)) return
    const publish = setInterval(() => {
      if (!dirty.current) return
      dirty.current = false
      setData({
        type: 'FeatureCollection',
        features: [...seen.current.values()].map(featureFor),
      })
    }, 700)
    return () => clearInterval(publish)
  }, [enabled, dbUp, dbBlankHere])

  useEffect(() => {
    if (!enabled || (dbUp && !dbBlankHere) || view.zoom < 7.4) {
      setFilling(0)
      return
    }
    let alive = true

    const timer = setTimeout(async () => {
      const cells = cellsCovering(boxFor(view), { limit: 150, centre: view.center })
      let left = cells.length
      setFilling(left)
      // Two at a time: enough to blanket a country in a minute, few enough that
      // Wikipedia does not start refusing us. Cells already in the browser come
      // back without a request at all, so this is instant the second time.
      for (let i = 0; i < cells.length; i += 2) {
        if (!alive) return
        while (handOn.current && alive) await new Promise(r => setTimeout(r, 140))
        if (!alive) return
        const batch = cells.slice(i, i + 2)
        const got = await Promise.all(batch.map(c => attractionsInCell(c).catch(() => null)))
        if (!alive) return
        left -= batch.length
        setFilling(left)
        for (const poi of got.flatMap(list => list ?? [])) {
          if (!seen.current.has(poi.id)) {
            seen.current.set(poi.id, poi)
            dirty.current = true
          }
        }
      }
      setFilling(0)
    }, 320)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [view, enabled, dbUp, dbBlankHere])

  const shown = enabled ? data : EMPTY_FC
  return { data: shown, filling: enabled ? filling : 0, count: shown.features.length }
}

export { EMPTY_FC }
export default useAttractions
