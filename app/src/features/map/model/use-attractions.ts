import { useEffect, useRef, useState } from 'react'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { loadPlacePins } from '../../places'
import { MIN_ZOOM_KEY, RANK_KEY } from '../../../place-marks-core'
import { trackError } from '../../../shared/lib/telemetry'
import type { AttractionPoi, MapView } from '../../../shared/model/types'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/* The pins on the map, from the places layer.
 *
 * This used to be two things fighting. A seeded `attractions` table, walked
 * out of Wikipedia's geosearch one region at a time, which in practice meant
 * the Netherlands and Scotland and nowhere else. And, for everywhere else, a
 * live walk of Wikipedia from this device: a hundred and fifty ten-kilometre
 * circles, two at a time, paused while a finger was down, with a "filling"
 * counter on screen because it took a minute of somebody's data allowance to
 * cover a city — and every visitor paid for it again, for only the ground they
 * personally wandered over. A traveller in Canada got rate-limited rather than
 * pins.
 *
 * Now it is one query per view against our own database, which covers
 * anywhere, is the same for everyone who opens the app, and costs the phone a
 * single round trip. Nothing to fill, nothing to pause, nothing to keep.
 */
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

/* The short keys are what the map layer's paint expressions already read, so
   they stay: `n` is the label, `k` the kind that picks the colour, `big`
   whether it survives a zoom out. `d` was a Wikipedia one-liner and `f` a
   photograph file, and open data has neither — they are empty rather than
   invented, and the card fills them in from `/api/places/:id` on a tap. */
const featureFor = (poi: AttractionPoi): Feature<Point> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [poi.lng, poi.lat] },
  properties: {
    id: poi.id,
    n: poi.name,
    d: '',
    k: poi.category,
    f: '',
    big: poi.big,
    /* The zoom this place earns its dot at, and which place wins when two
       want the same piece of screen. Both decided by the server, which holds
       the weighting — see places/rank.js. Passed through rather than computed
       here, so there is one taxonomy and not two. */
    [MIN_ZOOM_KEY]: poi.minzoom,
    [RANK_KEY]: poi.rank,
  },
})

/* Zoomed out, only what deserves a dot from orbit. Which of the twenty
   categories those are is the server's decision, not this file's — it holds
   the data and the weighting. This is only the zoom at which to ask for it,
   and it is the zoom the old layer used for the same purpose. */
const HEADLINE_BELOW_ZOOM = 10.5
/* Below this the view is a continent and every pin would be a dot on an ocean. */
const MIN_ZOOM = 5
/* A pan settles before it asks: a drag across a city is one query, not forty. */
const SETTLE_MS = 260

function useAttractions(view: MapView, enabled: boolean) {
  const [data, setData] = useState<FeatureCollection>(EMPTY_FC)
  const [attribution, setAttribution] = useState<
    { license: string; notice: string; url: string | null }[]
  >([])
  /* The ground under this view has not been ingested yet. The server has
     queued it; saying so beats an empty map that looks broken. */
  const [filling, setFilling] = useState(false)
  /* Not `hasBackend`: the demo has no server and still draws pins, from its
     own canned Amsterdam. This turns false only when a server answers that it
     has no places layer at all. */
  const [available, setAvailable] = useState(true)
  const held = useRef<FeatureCollection>(EMPTY_FC)

  useEffect(() => {
    if (!enabled || !available || view.zoom < MIN_ZOOM) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const found = await loadPlacePins(
          boxFor(view),
          { headline: view.zoom < HEADLINE_BELOW_ZOOM },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (!found) {
          /* No places layer on this deployment. Said once, and the map simply
             draws no pins rather than pretending to fill. */
          setAvailable(false)
          return
        }
        /* The server is restarting — a release, usually. Nothing changes:
           the pins stay, the attribution stays, and the next pan asks again.
           A deploy should be invisible on the map, not a map that empties. */
        if (found.retry) return
        setFilling(found.degraded)
        setAttribution(found.attribution || [])
        /* The previous view's pins stay on screen while a cell is still
           filling, so panning into an uningested country does not blank the
           map between one answer and the next. */
        if (found.places.length || !found.degraded) {
          held.current = {
            type: 'FeatureCollection',
            features: found.places.map(featureFor),
          }
          setData(held.current)
        }
      } catch (caught) {
        if (controller.signal.aborted) return
        trackError('place pins', caught)
      }
    }, SETTLE_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [view, enabled, available])

  const shown = enabled ? data : EMPTY_FC
  return {
    data: shown,
    filling: enabled && filling,
    attribution: enabled ? attribution : [],
    count: shown.features.length,
  }
}

export { EMPTY_FC }
export default useAttractions
