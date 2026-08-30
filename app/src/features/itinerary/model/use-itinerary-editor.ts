import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { createStop, deleteStop, replaceRoute, updateStop } from '../../../backend'
import { useAttractions } from '../../map'
import { describePlace, enrichStops, findSights, imageForPage, radiusForView } from '../../sights'
import { ALL_DAYS } from '../../../shared/constants/trip'
import type {
  Attraction, Coordinates, Id, MapView, Stop, StopDraft, Toast, TripPhoto,
} from '../../../shared/model/types'

const ICON_FOR_KIND = {
  castle: 'museum', museum: 'museum', worship: 'museum', outdoors: 'walk',
  history: 'museum', culture: 'camera', food: 'food', fun: 'star',
}

interface UseItineraryEditorOptions {
  day: string
  days: string[]
  ordered: Stop[]
  stops: Stop[]
  setStops: Dispatch<SetStateAction<Stop[]>>
  canEdit: boolean
  tripId: Id
  view: MapView
  viewRef: MutableRefObject<MapView>
  setView: Dispatch<SetStateAction<MapView>>
  toast: Toast
  setRoute: Dispatch<SetStateAction<Coordinates[]>>
  setPhotos: Dispatch<SetStateAction<TripPhoto[]>>
  selected: Id | null
  setSelected: Dispatch<SetStateAction<Id | null>>
  tab: string
  setTab: Dispatch<SetStateAction<string>>
  setFollowing: Dispatch<SetStateAction<boolean>>
}

export default function useItineraryEditor({
  day, days, ordered, stops, setStops, canEdit, tripId, view, viewRef, setView, toast,
  setRoute, setPhotos, selected, setSelected, tab, setTab, setFollowing,
}: UseItineraryEditorOptions) {
  // --- editing ---
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<StopDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [routeDraft, setRouteDraft] = useState<Coordinates[] | null>(null)   // non-null while editing the line
  const [places, setPlaces] = useState<Attraction[]>([])             // candidates from a place search
  const [attraction, setAttraction] = useState<Attraction | null>(null)   // the pin whose card is open
  const [showAttractions, setShowAttractions] = useState(() => {
    try { return localStorage.getItem('wf-attractions') !== 'off' } catch { return true }
  })
  const [finding, setFinding] = useState(false)

  /* ---- editing ----------------------------------------------------------- */
  const startEditing = useCallback(() => {
    setEditing(e => !e)
    setDraft(null)
  }, [])

  // Clicking bare map while editing drops a new stop there.
  // The day filter's "all" is a sentinel, not a day — never write it to a stop.
  const dayForNewStop = day === ALL_DAYS ? (days[0] || '') : (day || '')

  const onMapClick = useCallback((lngLat: Coordinates) => {
    if (routeDraft) { setRouteDraft(r => [...r, lngLat]); return }
    setDraft(d => (d && !d.id)
      ? { ...d, lng: lngLat[0], lat: lngLat[1] }            // reposition the pending one
      : { name: '', icon: 'pin', status: 'planned', day: dayForNewStop,
          lng: lngLat[0], lat: lngLat[1] })
    setSelected(null)
  }, [dayForNewStop, routeDraft])

  /* Stops with no picture of their own get one looked up, once, on load. This
     is the difference between a trip that arrives already looking like
     something and one you have to fill in by hand a stop at a time. Strict
     name matching, so an unrecognised stop keeps its placeholder rather than
     being handed a photograph of somewhere else. */
  const enriched = useRef(false)
  useEffect(() => {
    if (enriched.current || !stops.length) return
    enriched.current = true
    let alive = true
    enrichStops(stops).then(found => {
      if (!alive || !found.length) return
      setStops(list => list.map(s => {
        const p = found.find(f => f.id === s.id)
        return p ? { ...s, src: p.src, sourceUrl: p.sourceUrl,
                     note: p.note === undefined ? s.note : p.note } : s
      }))
      // Persist so it is a one-time cost, but only if this account may write.
      if (canEdit) {
        for (const p of found) {
          updateStop(tripId, p.id, {
            src: p.src, sourceUrl: p.sourceUrl,
            ...(p.note === undefined ? {} : { note: p.note }),
          }).catch(() => {})
        }
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [stops, canEdit, tripId])

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
        lng: v.center[0], lat: v.center[1],
        radius: radiusForView(v.zoom, v.center[1],
          Math.min(window.innerWidth, window.innerHeight) * 0.8),
      })
      const taken = new Set(stops.map(x => (x.name || '').toLowerCase()))
      const fresh = found.filter(pl => !taken.has(pl.name.toLowerCase()))
      setPlaces(fresh)
      toast(fresh.length ? `Found ${fresh.length} place${fresh.length === 1 ? '' : 's'} here`
                         : 'Nothing new found here — try zooming out')
    } catch (e) {
      toast(e.message || 'Could not search for places')
    } finally {
      setFinding(false)
    }
  }, [finding, stops, toast])

  const pickPlace = useCallback(pl => {
    setPlaces(list => list.filter(x => x.id !== pl.id))
    setDraft({
      name: pl.name, kind: pl.kind || '', icon: pl.icon || 'pin', status: 'planned',
      day: dayForNewStop, note: pl.note || '', lng: pl.lng, lat: pl.lat,
      src: pl.image || null, sourceUrl: pl.source || null,
    })
    setSelected(null)

    // No lead photograph — go looking in the article body, and drop it in if the
    // draft is still the same one by the time it arrives.
    if (!pl.image && pl.pageTitle) {
      imageForPage(pl.pageTitle)
        .then(url => { if (url) setDraft(d => (d && !d.id && d.name === pl.name && !d.src ? { ...d, src: url } : d)) })
        .catch(() => {})
    }
  }, [dayForNewStop])

  // Fill in a stop you placed by hand from whatever is at those coordinates.
  const lookUpDraft = useCallback(async () => {
    if (!draft) return
    try {
      const pl = await describePlace({ lng: draft.lng, lat: draft.lat, name: draft.name })
      if (!pl) { toast('Nothing found at that spot'); return }
      const image = pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
      setDraft(d => ({
        ...d,
        name: (d.name || '').trim() || pl.name,
        kind: d.kind || pl.kind || '',
        icon: d.icon && d.icon !== 'pin' ? d.icon : pl.icon,
        note: (d.note || '').trim() || pl.note || '',
        src: d.src || image || null,
        sourceUrl: d.sourceUrl || pl.source || null,
      }))
      toast('Filled in from ' + pl.name)
    } catch (e) {
      toast(e.message || 'Could not look that up')
    }
  }, [draft, toast])

  const saveRoute = useCallback(async () => {
    if (!routeDraft) return
    const next = routeDraft
    setRoute(next); setRouteDraft(null)
    try { await replaceRoute(tripId, next); toast('Route saved') }
    catch (e) { toast(e.message || 'Could not save the route') }
  }, [routeDraft, tripId, toast])

  // Dragging a pin writes straight through; there is nothing to confirm.
  const onStopMove = useCallback(async (id: Id, lngLat: Coordinates) => {
    setStops(list => list.map(s => (s.id === id ? { ...s, lng: lngLat[0], lat: lngLat[1] } : s)))
    setDraft(d => (d && d.id === id ? { ...d, lng: lngLat[0], lat: lngLat[1] } : d))
    try {
      await updateStop(tripId, id, { lng: lngLat[0], lat: lngLat[1] })
    } catch (e) {
      toast(e.message || 'Could not move that stop')
    }
  }, [tripId, toast])

  const onDraftField = useCallback((key: keyof StopDraft, value: StopDraft[keyof StopDraft]) => {
    setDraft(current => current ? ({ ...current, [key]: value }) : current)
  }, [])

  // Swap seq with the neighbour. Both rows move, so both are saved.
  const moveStop = useCallback(async (dir: number) => {
    if (!draft || !draft.id) return
    const i = ordered.findIndex(x => x.id === draft.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ordered.length) return
    const a = ordered[i], b = ordered[j]
    const aSeq = a.seq ?? i, bSeq = b.seq ?? j
    setStops(list => list.map(x =>
      x.id === a.id ? { ...x, seq: bSeq } : x.id === b.id ? { ...x, seq: aSeq } : x))
    try {
      await Promise.all([updateStop(tripId, a.id, { seq: bSeq }), updateStop(tripId, b.id, { seq: aSeq })])
    } catch (e) { toast(e.message || 'Could not reorder those') }
  }, [draft, ordered, tripId, toast])

  const saveDraft = useCallback(async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      if (draft.id) {
        const saved = await updateStop(tripId, draft.id, {
          name: draft.name, kind: draft.kind, icon: draft.icon, day: draft.day,
          time: draft.time, status: draft.status, note: draft.note,
          lng: draft.lng, lat: draft.lat, src: draft.src || null,
          sourceUrl: draft.sourceUrl || null,
        })
        setStops(list => list.map(s => (s.id === draft.id ? { ...s, ...saved } : s)))
        toast('Stop saved')
      } else {
        const saved = await createStop(tripId, { ...draft, seq: stops.length })
        setStops(list => [...list, saved])
        setSelected(saved.id)
        toast('Stop added')
      }
      setDraft(null)
    } catch (e) {
      toast(e.message || 'Could not save that stop')
    } finally {
      setSaving(false)
    }
  }, [draft, saving, tripId, stops.length, toast])

  const removeDraft = useCallback(async () => {
    if (!draft?.id || saving) return
    setSaving(true)
    try {
      await deleteStop(tripId, draft.id)
      setStops(list => list.filter(s => s.id !== draft.id))
      setPhotos(list => list.map(p => (p.stopId === draft.id ? { ...p, stopId: null } : p)))
      if (selected === draft.id) setSelected(null)
      setDraft(null)
      toast('Stop deleted')
    } catch (e) {
      toast(e.message || 'Could not delete that stop')
    } finally {
      setSaving(false)
    }
  }, [draft, saving, tripId, selected, toast])

  // From the sights list: add it to the trip outright, rather than opening an
  // editor — you are browsing, not authoring.
  const addSight = useCallback(async pl => {
    try {
      const image = pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
      const saved = await createStop(tripId, {
        name: pl.name, kind: pl.kind || '', icon: pl.icon || 'pin', status: 'planned',
        day: dayForNewStop, note: pl.note || '', lng: pl.lng, lat: pl.lat,
        src: image || null, sourceUrl: pl.source || null, seq: stops.length,
      })
      setStops(list => [...list, saved])
      toast(`${pl.name} added to the trip`)
    } catch (e) {
      toast(e.message || 'Could not add that')
    }
  }, [tripId, dayForNewStop, stops.length, toast])

  const { data: attractions, filling: attrFilling, count: attrCount } =
    useAttractions(view, showAttractions && tab === 'map')

  const toggleAttractions = useCallback(() => {
    setShowAttractions(on => {
      const next = !on
      try { localStorage.setItem('wf-attractions', next ? 'on' : 'off') } catch { /* private mode */ }
      if (!next) setAttraction(null)
      return next
    })
  }, [])

  const addAttraction = useCallback(async (poi: Attraction) => {
    try {
      const saved = await createStop(tripId, {
        name: poi.n, kind: poi.d || '', icon: ICON_FOR_KIND[poi.k] || 'pin', status: 'planned',
        day: dayForNewStop, note: poi.note || '', lng: poi.lng, lat: poi.lat,
        src: poi.image || null, sourceUrl: poi.source || null, seq: stops.length,
      })
      setStops(list => [...list, saved])
      toast(`${poi.n} added to the trip`)
    } catch (e) { toast(e.message || 'Could not add that') }
  }, [tripId, dayForNewStop, stops.length, toast])

  const showSight = useCallback(pl => {
    setTab('map'); setFollowing(false)
    setView({ center: [pl.lng, pl.lat], zoom: Math.max(viewRef.current.zoom, 16), ms: 620 })
  }, [])

  return {
    editing, draft, setDraft, saving, routeDraft, setRouteDraft, places, setPlaces,
    attraction, setAttraction, showAttractions, finding, startEditing, onMapClick,
    searchPlaces, pickPlace, lookUpDraft, saveRoute, onStopMove, onDraftField,
    moveStop, saveDraft, removeDraft, addSight, attractions, attrFilling,
    attrCount, toggleAttractions, addAttraction, showSight,
  }
}
