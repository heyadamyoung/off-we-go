import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { ALL_DAYS, type TripView } from '../../../trip-search-core'
import { applyLiveStopStatuses } from '../../../live-stop-progress-core'
import { initialTripView } from '../../../live-map-view-core'
import { useAssistant } from '../../assistant'
import { useAirportIndoor } from '../../airport'
import { useSegments } from '../../transport'
import { useItineraryEditor } from '../../itinerary'
import { useTripPhotos } from '../../photos'
import { useTripCamera } from './use-trip-camera'
import useTripMutations from './use-trip-mutations'
import useTripSelection from './use-trip-selection'
import useLiveTrip from './use-live-trip'
import useTripPresence from './use-trip-presence'
import useTripEscape from './use-trip-escape'
import useOfflineEdits from './use-offline-edits'
import { track as trackEvent } from '../../../shared/lib/telemetry'
import { withFace } from './faces'
import { daysOf } from './trip-items'
import type {
  Attraction,
  Coordinates,
  MapView,
  Person,
  TripData,
} from '../../../shared/model/types'

/* Everything the trip screen KNOWS, in one hook; trip-page.tsx keeps only
   what it SHOWS. The screen destructures this bag and lays it out. */
interface TripPageOptions {
  data: TripData
  busyEditing: MutableRefObject<boolean>
  search: { view?: TripView; sel?: string; q?: string; day?: string }
  patch: (changes: Record<string, unknown>) => void
  notify: (message: string, tone?: 'success' | 'error') => void
  /** Re-reads the trip from the server, once queued changes have landed. */
  reload: () => void
}

export default function useTripPage({
  data,
  busyEditing,
  search,
  patch,
  notify,
  reload,
}: TripPageOptions) {
  const { tripId, canEdit } = data

  const setView = useCallback(
    (next: TripView | ((current: TripView) => TripView)) => {
      const value = typeof next === 'function' ? next('map') : next
      patch({ view: value === 'map' ? undefined : value })
    },
    [patch],
  )

  // The boot script in the document head has already applied the stored theme;
  // read it back off the element rather than from storage, which the shell
  // renderer does not have.
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined' ? 'dark' : document.documentElement.dataset.theme || 'dark',
  )
  const [trip, setTrip] = useState(data.trip)
  const [route, setRoute] = useState(data.route)
  const [stops, setStops] = useState(data.stops)
  const [family, setFamily] = useState(() => (data.family || []).map(withFace))
  const [me] = useState<Person>(data.me || data.family[0] || { name: 'You' })
  const [placing, setPlacing] = useState<null | { move?: string }>(null)
  const [photoBy, setPhotoBy] = useState<string | null>(null)
  const [mapOverride, setMapOverride] = useState<string | null>(theme)
  const [attraction, setAttractionCardBare] = useState<Attraction | null>(null)
  const setAttractionCard = useCallback((next: Attraction | null) => {
    if (next) trackEvent('open attraction', { attraction: String(next.name || next.id) })
    setAttractionCardBare(next)
  }, [])
  const viewers = useTripPresence(tripId, family)

  /* The AI chat: its transcript lives here so closing the sheet keeps the
     conversation, and reopening it picks up where it left off. */
  const [asking, setAsking] = useState(false)
  const assistant = useAssistant({ tripId, slug: data.trip.slug || '' })

  const view: TripView = search.view || 'map'
  const selected = search.sel
  const query = search.q || ''

  const toast = useCallback(
    (message: string, tone: 'success' | 'error' = 'success') => notify(message, tone),
    [notify],
  )

  /* The hooks below think in stop ids; the chrome thinks in items. This is the
     seam between the two. */
  const selectId = useCallback(
    (next: string | null | ((current: string | null) => string | null)) => {
      const id = typeof next === 'function' ? next(null) : next
      patch({ sel: id || undefined })
    },
    [patch],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('offwego-theme', theme)
    } catch {
      /* private mode */
    }
  }, [theme])

  // A reload hands down new data; adopt it.
  useEffect(() => {
    setTrip(data.trip)
    setRoute(data.route)
    setStops(data.stops)
    setFamily((data.family || []).map(withFace))
  }, [data])

  // The whole itinerary, not the average of it: the mean of a two-country
  // trip's stops was a street-level view of open water. initialTripView is
  // pure and tested; the follow effect then takes over for a live family.
  const [mapView, setMapView] = useState<MapView>(() => initialTripView(data.stops))
  const viewRef = useRef(mapView)
  viewRef.current = mapView

  const ordered = useMemo(() => [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [stops])
  const {
    phones,
    setPhones,
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
  } = useLiveTrip({ tripId, trip, route, stops: ordered, family, mapOverride })

  /* Phone only: the bottom bar collapsed to its peek. Owned here rather than
     by the screen so the camera's visible band can shrink and grow with it. */
  const [barPeek, setBarPeek] = useState(false)
  const {
    following,
    setFollowing,
    toggleFollow: cameraToggleFollow,
    fitAll,
    padding: mapPadding,
  } = useTripCamera({
    live,
    livePoints,
    liveReady,
    stops,
    panelOpen: view !== 'map',
    barPeek,
    setMapView,
  })
  const toggleFollow = useCallback(() => {
    trackEvent('toggle follow', { engaged: String(!following) })
    cameraToggleFollow()
  }, [cameraToggleFollow, following])

  /* The getting-there layer: legs, their editor, and the jump from a flight
     card into the terminal — same camera move the airport auto-open makes. */
  const transport = useSegments(tripId, toast)
  const [segmentEditing, setSegmentEditing] = useState<null | 'new' | string>(null)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const showGate = useCallback(
    (segment: { fromLng?: number | null; fromLat?: number | null }) => {
      if (segment.fromLng == null || segment.fromLat == null) return
      setFollowing(false)
      setMapView({
        center: [segment.fromLng, segment.fromLat],
        zoom: 16.3,
        ms: 620,
        focus: true,
      })
      patch({ view: undefined })
    },
    [setFollowing, setMapView, patch],
  )
  const liveStop = progress.currentStop || progress.destination
  const day = search.day || liveStop?.day || ALL_DAYS
  const liveStops = useMemo(() => applyLiveStopStatuses(ordered, progress), [ordered, progress])

  const {
    photos,
    setPhotos,
    comments,
    likes,
    viewer,
    viewerList,
    viewerIndex,
    openViewer,
    closeViewer,
    setIndex,
    addComment,
    toggleLike,
    addPhoto,
    changePhoto,
    removePhoto,
    removeComment,
  } = useTripPhotos({ data, tripId, me, toast, setSelected: selectId })

  const days = useMemo(() => daysOf(ordered), [ordered])

  /* Inside the terminal: zooming into an airport or its card's button opens
     it, the level picker or zooming away closes it. */
  const indoor = useAirportIndoor({
    toast,
    start: latestGpsPosition,
    view: mapView,
    stops: ordered,
    onOpen: stop => {
      setFollowing(false)
      setMapView({
        center: [stop.lng, stop.lat],
        zoom: Math.max(viewRef.current.zoom, 16.3),
        ms: 620,
        focus: true,
      })
    },
  })

  const {
    editing,
    draft,
    setDraft,
    saving,
    routeDraft,
    setRouteDraft,
    places,
    setPlaces,
    startEditing,
    onMapClick,
    searchPlaces,
    pickPlace,
    lookUpDraft,
    saveRoute,
    onStopMove,
    onDraftField,
    moveStop,
    saveDraft,
    removeDraft,
    addSight,
    attractions,
    attrFilling,
    attrCount,
    toggleAttractions,
    addAttraction,
    showSight,
    showAttractions,
  } = useItineraryEditor({
    day,
    days,
    ordered,
    stops,
    setStops,
    canEdit,
    tripId,
    view: mapView,
    viewRef,
    setView: setMapView,
    toast,
    route,
    setRoute,
    setPhotos,
    selected: selected || null,
    setSelected: selectId,
    tab: view,
    setTab: setView,
    onAttractionsHidden: () => setAttractionCard(null),
    setFollowing,
  })

  /* Changes made with no signal, sent the moment there is one. */
  const waitingEdits = useOfflineEdits({ toast, onSynced: reload })

  busyEditing.current = editing || !!draft || !!routeDraft

  const { items, selectedItem, select } = useTripSelection({
    liveStops,
    photos,
    day,
    query,
    selected,
    patch,
    setFollowing,
    setMapView,
    viewRef,
    openViewer,
  })

  const liveDay = liveStop?.day

  const onMapView = useCallback(
    (next: MapView, options?: { user?: boolean }) => {
      if (options?.user) setFollowing(false)
      setMapView(next)
    },
    [setFollowing],
  )

  const pickStop = useCallback(
    (id: string) => {
      if (placing?.move) return
      patch({ sel: id })
      if (editing) setDraft(stops.find(stop => stop.id === id) || null)
    },
    [editing, stops, placing, patch, setDraft],
  )

  const onMapClicked = useCallback(
    (point: Coordinates) => {
      if (placing) {
        const target = placing.move ? stops.find(stop => stop.id === placing.move) : null
        if (target) {
          onStopMove(target.id, point)
          toast('Pin moved')
        } else {
          onMapClick(point)
        }
        setPlacing(null)
        return
      }
      if (editing) onMapClick(point)
    },
    [placing, stops, onStopMove, onMapClick, editing, toast],
  )

  useTripEscape({
    viewerOpen: !!viewer,
    closeViewer,
    placing,
    setPlacing,
    draft,
    setDraft,
    asking,
    setAsking,
    indoor,
    selected,
    patch,
  })

  const { saveTrip, uploads } = useTripMutations({
    trip,
    setTrip,
    tripId,
    toast,
    addPhoto,
    stops,
    setFollowing,
    setMapView,
    viewRef,
  })

  const here = photos.filter(photo => photo.stopId === selectedItem?.stop?.id)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const panelOpen = view !== 'map'
  const subtitle = [
    trip.crew,
    trip.dates,
    `${family.filter(person => person.memberRole !== 'viewer').length} travelling`,
    `${family.filter(person => person.memberRole === 'viewer').length} following`,
  ]
    .filter(Boolean)
    .join(' · ')

  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  return {
    theme, setTheme, trip, route, stops, family, me, viewers,
    placing, setPlacing, photoBy, setPhotoBy, setMapOverride,
    attraction, setAttractionCard, asking, setAsking, assistant,
    view, setView, selected, query, day, days, toast,
    mapView, setMapView, onMapView, mapPadding, following, setFollowing, toggleFollow, fitAll,
    phones, setPhones, track, sun, mapTheme, markers, trail, trailFaded,
    progressCopy, latestGpsPosition, liveStop, liveDay, liveStops,
    transport, segmentEditing, setSegmentEditing, clock, showGate,
    photos, comments, likes, viewer, viewerList, viewerIndex, openViewer, closeViewer, setIndex,
    addComment, toggleLike, changePhoto, removePhoto, removeComment,
    indoor, editing, draft, setDraft, saving, routeDraft, setRouteDraft,
    places, setPlaces, startEditing, searchPlaces, pickPlace, lookUpDraft,
    saveRoute, onStopMove, onDraftField, moveStop, saveDraft, removeDraft,
    addSight, attractions, attrFilling, attrCount, toggleAttractions,
    addAttraction, showSight, showAttractions,
    items, selectedItem, select, pickStop, onMapClicked,
    saveTrip, uploads, here, origin, panelOpen, subtitle, waitingEdits, barPeek, setBarPeek,
    offlineAt: data.offlineAt ?? null,
  }
}
