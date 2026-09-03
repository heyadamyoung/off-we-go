import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { createStop, deleteStop, replaceRoute, updateStop } from '../../../backend'
import useEditorPlaces from './use-editor-places'
import { enrichStops } from '../../sights'
import { ALL_DAYS } from '../../../shared/constants/trip'
import { appErrorMessage } from '../../../user-messages-core'
import { nextSeq } from './stop-order'
import type { TripView } from '../../../trip-search-core'
import type {
  Coordinates,
  Id,
  MapView,
  Stop,
  StopDraft,
  Toast,
  TripPhoto,
} from '../../../shared/model/types'

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
  /** The route as it stands, so a failed save can hand the drawing back. */
  route: Coordinates[]
  setRoute: Dispatch<SetStateAction<Coordinates[]>>
  setPhotos: Dispatch<SetStateAction<TripPhoto[]>>
  selected: Id | null
  setSelected: Dispatch<SetStateAction<Id | null>>
  tab: string
  setTab: (tab: TripView | ((current: TripView) => TripView)) => void
  setFollowing: Dispatch<SetStateAction<boolean>>
  /** Closes the attraction card when the dots are switched off. */
  onAttractionsHidden?: () => void
}

export default function useItineraryEditor({
  day,
  days,
  ordered,
  stops,
  setStops,
  canEdit,
  tripId,
  view,
  viewRef,
  setView,
  toast,
  route,
  setRoute,
  setPhotos,
  selected,
  setSelected,
  tab,
  setTab,
  setFollowing,
}: UseItineraryEditorOptions) {
  // --- editing ---
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<StopDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [routeDraft, setRouteDraft] = useState<Coordinates[] | null>(null) // non-null while editing the line

  /* ---- editing ----------------------------------------------------------- */
  const startEditing = useCallback((on?: boolean) => {
    // The toolbar button toggles; the detail card's pencil asks for it on, and
    // must not switch it off when it is already on.
    setEditing(current => (typeof on === 'boolean' ? on : !current))
    setDraft(null)
  }, [])

  // Clicking bare map while editing drops a new stop there.
  // The day filter's "all" is a sentinel, not a day — never write it to a stop.
  const dayForNewStop = day === ALL_DAYS ? days[0] || '' : day || ''

  const placesArm = useEditorPlaces({
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
  })

  const onMapClick = useCallback(
    (lngLat: Coordinates) => {
      if (routeDraft) {
        setRouteDraft(r => [...(r || []), lngLat])
        return
      }
      setDraft(d =>
        d && !d.id
          ? { ...d, lng: lngLat[0], lat: lngLat[1] } // reposition the pending one
          : {
              name: '',
              icon: 'pin',
              status: 'planned',
              day: dayForNewStop,
              lng: lngLat[0],
              lat: lngLat[1],
            },
      )
      setSelected(null)
    },
    [dayForNewStop, routeDraft, setSelected],
  )

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
    enrichStops(stops)
      .then(found => {
        if (!alive || !found.length) return
        setStops(list =>
          list.map(s => {
            const p = found.find(f => f.id === s.id)
            return p
              ? {
                  ...s,
                  src: p.src,
                  sourceUrl: p.sourceUrl,
                  note: p.note === undefined ? s.note : p.note,
                }
              : s
          }),
        )
        // Persist so it is a one-time cost, but only if this account may write.
        if (canEdit) {
          for (const p of found) {
            updateStop(tripId, p.id, {
              src: p.src,
              sourceUrl: p.sourceUrl,
              ...(p.note === undefined ? {} : { note: p.note }),
            }).catch(() => {})
          }
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [stops, canEdit, tripId, setStops])

  const saveRoute = useCallback(async () => {
    if (!routeDraft) return
    const next = routeDraft
    const before = route
    setRoute(next)
    setRouteDraft(null)
    try {
      await replaceRoute(tripId, next)
      toast('Route saved')
    } catch (e) {
      /* Hand the drawing back rather than leaving a line on screen the server
         never took — and with the draft gone there was no way to try again. */
      setRoute(before)
      setRouteDraft(next)
      toast(appErrorMessage(e, 'save-route'), 'error')
    }
  }, [routeDraft, route, tripId, toast, setRoute])

  // Dragging a pin writes straight through; there is nothing to confirm.
  const onStopMove = useCallback(
    async (id: Id, lngLat: Coordinates) => {
      setStops(list => list.map(s => (s.id === id ? { ...s, lng: lngLat[0], lat: lngLat[1] } : s)))
      setDraft(d => (d && d.id === id ? { ...d, lng: lngLat[0], lat: lngLat[1] } : d))
      try {
        await updateStop(tripId, id, { lng: lngLat[0], lat: lngLat[1] })
      } catch (e) {
        toast(appErrorMessage(e, 'move-stop'), 'error')
      }
    },
    [tripId, toast, setStops],
  )

  const onDraftField = useCallback((key: keyof StopDraft, value: StopDraft[keyof StopDraft]) => {
    setDraft(current => (current ? { ...current, [key]: value } : current))
  }, [])

  // Swap seq with the neighbour. Both rows move, so both are saved.
  const moveStop = useCallback(
    async (dir: number) => {
      if (!draft?.id) return
      const i = ordered.findIndex(x => x.id === draft.id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ordered.length) return
      const a = ordered[i],
        b = ordered[j]
      const aSeq = a.seq ?? i,
        bSeq = b.seq ?? j
      setStops(list =>
        list.map(x =>
          x.id === a.id ? { ...x, seq: bSeq } : x.id === b.id ? { ...x, seq: aSeq } : x,
        ),
      )
      try {
        await Promise.all([
          updateStop(tripId, a.id, { seq: bSeq }),
          updateStop(tripId, b.id, { seq: aSeq }),
        ])
      } catch (e) {
        /* Put the order back. Left as it was, the strip, the map and the
           itinerary all show an order the server never accepted, which
           silently rights itself on the next load. */
        setStops(list =>
          list.map(x =>
            x.id === a.id ? { ...x, seq: aSeq } : x.id === b.id ? { ...x, seq: bSeq } : x,
          ),
        )
        toast(appErrorMessage(e, 'reorder-stops'), 'error')
      }
    },
    [draft, ordered, tripId, toast, setStops],
  )

  const saveDraft = useCallback(async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      if (draft.id) {
        const saved = await updateStop(tripId, draft.id, {
          name: draft.name,
          kind: draft.kind,
          icon: draft.icon,
          day: draft.day,
          time: draft.time,
          status: draft.status,
          note: draft.note,
          lng: draft.lng,
          lat: draft.lat,
          src: draft.src || null,
          sourceUrl: draft.sourceUrl || undefined,
        })
        setStops(list => list.map(s => (s.id === draft.id ? { ...s, ...saved } : s)))
        toast('Stop saved')
      } else {
        const saved = await createStop(tripId, { ...draft, seq: nextSeq(stops) })
        setStops(list => [...list, saved])
        setSelected(saved.id)
        toast('Stop added')
      }
      setDraft(null)
    } catch (e) {
      toast(appErrorMessage(e, 'save-stop'), 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, saving, tripId, stops, toast, setStops, setSelected])

  /* The stop to remove is passed in by callers that have one but no draft —
     the detail card renders only when there is no draft, so reading `draft`
     there would always find null and the delete would quietly do nothing. */
  const removeDraft = useCallback(
    async (target?: { id?: Id } | null) => {
      const doomed = target?.id ?? draft?.id
      if (!doomed || saving) return
      setSaving(true)
      try {
        await deleteStop(tripId, doomed)
        setStops(list => list.filter(s => s.id !== doomed))
        setPhotos(list => list.map(p => (p.stopId === doomed ? { ...p, stopId: null } : p)))
        if (selected === doomed) setSelected(null)
        setDraft(null)
        toast('Stop deleted')
      } catch (e) {
        toast(appErrorMessage(e, 'delete-stop'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [draft, saving, tripId, selected, toast, setStops, setPhotos, setSelected],
  )

  return {
    ...placesArm,
    editing,
    draft,
    setDraft,
    saving,
    routeDraft,
    setRouteDraft,
    startEditing,
    onMapClick,
    saveRoute,
    onStopMove,
    onDraftField,
    moveStop,
    saveDraft,
    removeDraft,
  }
}
