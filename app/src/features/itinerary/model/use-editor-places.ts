import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { createStop } from '../../../backend'
import { useAttractions } from '../../map'
import {
  describePlace,
  findSights,
  imageForPage,
  radiusForView,
  type SightPlace,
} from '../../sights'
import { appErrorMessage } from '../../../user-messages-core'
import { nextSeq } from './stop-order'
import type { Attraction, Id, MapView, Stop, StopDraft, Toast } from '../../../shared/model/types'
import type { TripView } from '../../../trip-search-core'

const ICON_FOR_KIND: Record<string, string> = {
  castle: 'museum',
  museum: 'museum',
  worship: 'museum',
  outdoors: 'walk',
  history: 'museum',
  culture: 'camera',
  food: 'food',
  fun: 'star',
}

/* The discovery arm of the editor: searching what is on screen, turning a
   find into a draft or a stop, and the attraction dots' card. The editing arm
   stays in use-itinerary-editor; this one only ever adds. */
interface UseEditorPlacesOptions {
  tripId: Id
  stops: Stop[]
  setStops: Dispatch<SetStateAction<Stop[]>>
  dayForNewStop: string
  draft: StopDraft | null
  setDraft: Dispatch<SetStateAction<StopDraft | null>>
  setSelected: Dispatch<SetStateAction<Id | null>>
  toast: Toast
  viewRef: MutableRefObject<MapView>
  view: MapView
  tab: string
  setTab: (tab: TripView | ((current: TripView) => TripView)) => void
  setFollowing: Dispatch<SetStateAction<boolean>>
  setView: Dispatch<SetStateAction<MapView>>
  /** Called when the dots are switched off, so an open card can go with them. */
  onHidden?: () => void
}

export default function useEditorPlaces({
  tripId,
  stops,
  setStops,
  dayForNewStop,
  draft,
  setDraft,
  setSelected,
  toast,
  viewRef,
  view,
  tab,
  setTab,
  setFollowing,
  setView,
  onHidden,
}: UseEditorPlacesOptions) {
  const [places, setPlaces] = useState<Attraction[]>([]) // candidates from a place search
  const [showAttractions, setShowAttractions] = useState(() => {
    try {
      return localStorage.getItem('wf-attractions') !== 'off'
    } catch {
      return true
    }
  })
  const [finding, setFinding] = useState(false)

  /* ---- places ------------------------------------------------------------
     Search what is currently on screen, drop the results as candidates, and let
     a click turn one into a stop with its name, description and photograph
     already filled in. */
  const searchPlaces = useCallback(async () => {
    if (finding) return
    setFinding(true)
    try {
      const v = viewRef.current
      const found = await findSights({
        // The narrower screen dimension, not the wider one: a candidate you
        // cannot see is a candidate you cannot click, and results are ranked by
        // how well known they are now rather than by how close they are.
        lng: v.center[0],
        lat: v.center[1],
        radius: radiusForView(
          v.zoom,
          v.center[1],
          Math.min(window.innerWidth, window.innerHeight) * 0.8,
        ),
      })
      const taken = new Set(stops.map(x => (x.name || '').toLowerCase()))
      // A find without coordinates cannot be pinned, so it is not offered.
      const fresh = found.filter(
        (pl): pl is SightPlace & { lng: number; lat: number } =>
          pl.lng != null && pl.lat != null && !taken.has(pl.name.toLowerCase()),
      )
      setPlaces(fresh)
      toast(
        fresh.length
          ? `Found ${fresh.length} place${fresh.length === 1 ? '' : 's'} here`
          : 'Nothing new found here — try zooming out',
      )
    } catch (e) {
      toast(appErrorMessage(e, 'search-places'), 'error')
    } finally {
      setFinding(false)
    }
  }, [finding, stops, toast, viewRef])

  const pickPlace = useCallback(
    (pl: Attraction) => {
      setPlaces(list => list.filter(x => x.id !== pl.id))
      setDraft({
        name: pl.name,
        kind: pl.kind || '',
        icon: pl.icon || 'pin',
        status: 'planned',
        day: dayForNewStop,
        note: pl.note || '',
        lng: pl.lng,
        lat: pl.lat,
        src: pl.image || null,
        sourceUrl: pl.source || null,
      })
      setSelected(null)

      // No lead photograph — go looking in the article body, and drop it in if the
      // draft is still the same one by the time it arrives.
      if (!pl.image && pl.pageTitle) {
        imageForPage(pl.pageTitle)
          .then(url => {
            if (url)
              setDraft(d => (d && !d.id && d.name === pl.name && !d.src ? { ...d, src: url } : d))
          })
          .catch(() => {})
      }
    },
    [dayForNewStop, setSelected, setDraft],
  )

  // Fill in a stop you placed by hand from whatever is at those coordinates.
  const lookUpDraft = useCallback(async () => {
    if (!draft) return
    try {
      const pl = await describePlace({ lng: draft.lng, lat: draft.lat, name: draft.name })
      if (!pl) {
        toast('Nothing found at that spot')
        return
      }
      const image =
        pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
      setDraft(d =>
        d
          ? {
              ...d,
              name: (d.name || '').trim() || pl.name,
              kind: d.kind || pl.kind || '',
              icon: d.icon && d.icon !== 'pin' ? d.icon : pl.icon,
              note: (d.note || '').trim() || pl.note || '',
              src: d.src || image || undefined,
              sourceUrl: d.sourceUrl || pl.source || undefined,
            }
          : d,
      )
      toast('Filled in from ' + pl.name)
    } catch (e) {
      toast(appErrorMessage(e, 'lookup-place'), 'error')
    }
  }, [draft, toast, setDraft])

  // From the sights list: add it to the trip outright, rather than opening an
  // editor — you are browsing, not authoring.
  const addSight = useCallback(
    async (pl: SightPlace) => {
      // A sight the second pass never got coordinates for cannot be pinned.
      if (pl.lng == null || pl.lat == null) return
      try {
        const image =
          pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
        const saved = await createStop(tripId, {
          name: pl.name,
          kind: pl.kind || '',
          icon: pl.icon || 'pin',
          status: 'planned',
          day: dayForNewStop,
          note: pl.note || '',
          lng: pl.lng,
          lat: pl.lat,
          src: image || null,
          sourceUrl: pl.source || null,
          seq: nextSeq(stops),
        })
        setStops(list => [...list, saved])
        toast(`${pl.name} added to the trip`)
      } catch (e) {
        toast(appErrorMessage(e, 'add-place'), 'error')
      }
    },
    [tripId, dayForNewStop, stops, toast, setStops],
  )

  const {
    data: attractions,
    filling: attrFilling,
    count: attrCount,
  } = useAttractions(view, showAttractions && tab === 'map')

  const toggleAttractions = useCallback(() => {
    setShowAttractions(on => {
      const next = !on
      try {
        localStorage.setItem('wf-attractions', next ? 'on' : 'off')
      } catch {
        /* private mode */
      }
      // The card belongs to the screen, not to this hook; closing it here is
      // the only way hiding the dots does not leave a card describing a pin
      // that is no longer on the map.
      if (!next) onHidden?.()
      return next
    })
  }, [onHidden])

  const addAttraction = useCallback(
    async (poi: Attraction) => {
      try {
        const saved = await createStop(tripId, {
          name: poi.n,
          kind: poi.d || '',
          icon: ICON_FOR_KIND[poi.k || ''] || 'pin',
          status: 'planned',
          day: dayForNewStop,
          note: poi.note || '',
          lng: poi.lng,
          lat: poi.lat,
          src: poi.image || null,
          sourceUrl: poi.source || undefined,
          seq: nextSeq(stops),
        })
        setStops(list => [...list, saved])
        toast(`${poi.n} added to the trip`)
      } catch (e) {
        toast(appErrorMessage(e, 'add-place'), 'error')
      }
    },
    [tripId, dayForNewStop, stops, toast, setStops],
  )

  const showSight = useCallback(
    (pl: SightPlace) => {
      if (pl.lng == null || pl.lat == null) return
      setTab('map')
      setFollowing(false)
      setView({ center: [pl.lng, pl.lat], zoom: Math.max(viewRef.current.zoom, 16), ms: 620 })
    },
    [setTab, setFollowing, setView, viewRef],
  )

  return {
    places,
    setPlaces,
    showAttractions,
    finding,
    searchPlaces,
    pickPlace,
    lookUpDraft,
    addSight,
    attractions,
    attrFilling,
    attrCount,
    toggleAttractions,
    addAttraction,
    showSight,
  }
}
