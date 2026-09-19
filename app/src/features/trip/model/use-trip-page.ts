import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { TripView } from '../../../trip-search-core'
import { applyLiveStopStatuses } from '../../../live-stop-progress-core'
import { initialTripView } from '../../../live-map-view-core'
import { useAssistant } from '../../assistant'
import type { Segment } from '../../../segments-core'
import { useAirportIndoor } from '../../airport'
import { usePlanePosition, useSegments } from '../../transport'
import { useItineraryEditor } from '../../itinerary'
import { useTripPhotos } from '../../photos'
import { useTripCamera } from './use-trip-camera'
import useTripMutations from './use-trip-mutations'
import useTripSelection from './use-trip-selection'
import useLiveTrip from './use-live-trip'
import useTripPresence from './use-trip-presence'
import useOfflinePapers from './use-offline-papers'
import useTripEscape from './use-trip-escape'
import useOfflineEdits from './use-offline-edits'
import { track as trackEvent } from '../../../shared/lib/telemetry'
import { withFace } from './faces'
import { tripSubtitle } from './trip-items'
import useMapLook from './use-map-look'
import useMinuteClock from './use-minute-clock'
import useTripDays from './use-trip-days'
import type {
  Attraction,
  Coordinates,
  MapView,
  Person,
  Toast,
  ToastTone,
  TripData,
} from '../../../shared/model/types'

/* Everything the trip screen KNOWS, in one hook; trip-page.tsx keeps only
   what it SHOWS. The screen destructures this bag and lays it out. */
interface TripPageOptions {
  data: TripData
  busyEditing: MutableRefObject<boolean>
  search: { view?: TripView; sel?: string; q?: string; day?: string }
  patch: (changes: Record<string, unknown>) => void
  notify: Toast
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
  const { theme, toggleTheme, mapOverride, streetNames, toggleStreetNames } = useMapLook()
  const [trip, setTrip] = useState(data.trip)
  const [route, setRoute] = useState(data.route)
  const [stops, setStops] = useState(data.stops)
  const [family, setFamily] = useState(() => (data.family || []).map(withFace))
  const [me] = useState<Person>(data.me || data.family[0] || { name: 'You' })
  const [placing, setPlacing] = useState<null | { move?: string }>(null)
  const [photoBy, setPhotoBy] = useState<string | null>(null)
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
    (message: string, tone: ToastTone = 'success') => notify(message, tone),
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
    lastSeenPosition,
  } = useLiveTrip({ tripId, trip, route, stops: ordered, family, mapOverride })

  // Phone only: the bar's peek, owned here so the camera's band tracks it.
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
  /* The tickets and bookings, onto the phone before anybody asks: the case is
     a check-in desk with no signal and a document nobody thought to open. */
  useOfflinePapers({ tripId, stops: ordered, segments: transport.segments })
  const clock = useMinuteClock()
  const plane = usePlanePosition(tripId, transport.segments, clock) // over the family's dots
  const liveStop = progress.currentStop || progress.destination
  /* The itinerary with the journey's own progress written over it: what has
     been reached, what is next. */
  const liveStops = useMemo(() => applyLiveStopStatuses(ordered, progress), [ordered, progress])

  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  const {
    photos, setPhotos, comments, likes,
    viewer, viewerList, viewerIndex, openViewer, closeViewer, setIndex,
    addComment, toggleLike, addPhoto, changePhoto, movePhotos, removePhoto, removeComment,
  } = useTripPhotos({ data, tripId, me, toast, setSelected: selectId })

  const { days, day, liveDay } = useTripDays({
    stops: ordered,
    photos,
    searchDay: search.day,
    liveStop,
  })

  // Inside the terminal, and the walk through it on the day of a flight.
  const indoor = useAirportIndoor({
    toast,
    start: latestGpsPosition,
    view: mapView,
    stops: ordered,
    segments: transport.segments,
    fix: progress.latestFix,
    now: clock,
    onOpen: (stop, focus) => {
      setFollowing(false)
      setMapView({
        center: focus || [stop.lng, stop.lat],
        zoom: Math.max(viewRef.current.zoom, 16.3),
        ms: 620,
        focus: true,
      })
    },
  })
  /* From a ticket to the gate itself, on its floor, with the panel away. */
  const showGate = useCallback(
    (segment: Segment) => {
      indoor.focusGate(segment)
      patch({ view: undefined })
    },
    [indoor.focusGate, patch],
  )

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

  /* Planning a day from the day itself, which is what the timeline's own
     heading offers. The page should not have to know that this means three
     things — choose the chip, get out of the way, hand the map over — because
     the moment a fourth is needed it would be three screens that each learned
     two of them.

     A place is still chosen with a pin, deliberately. A stop with no point is
     a stop nothing can draw, and the map is where points come from. */
  const planOnDay = useCallback(
    (iso: string) => {
      patch({ day: iso, view: undefined, sel: undefined })
      setPlacing({})
    },
    [patch],
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

  const panelOpen = view !== 'map'
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
    viewOpen: panelOpen,
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
  const subtitle = tripSubtitle(trip, family)

  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  return {
    theme, toggleTheme, trip, route, stops, family, me, viewers,
    placing, setPlacing, planOnDay, photoBy, setPhotoBy, streetNames, toggleStreetNames,
    attraction, setAttractionCard, asking, setAsking, assistant,
    view, setView, selected, query, day, days, toast,
    mapView, setMapView, onMapView, mapPadding, following, setFollowing, toggleFollow, fitAll,
    phones, setPhones, fixes, track, sun, mapTheme, markers, trail, trailFaded,
    progress, progressCopy, latestGpsPosition, lastSeenPosition, liveStop, liveDay, liveStops,
    transport, segmentEditing, setSegmentEditing, clock, showGate, plane,
    photos, comments, likes, viewer, viewerList, viewerIndex, openViewer, closeViewer, setIndex,
    addComment, toggleLike, changePhoto, movePhotos, removePhoto, removeComment, indoor, editing,
    draft, setDraft, saving, routeDraft, setRouteDraft,
    places, setPlaces, startEditing, searchPlaces, pickPlace, lookUpDraft, saveRoute,
    onStopMove, onDraftField, moveStop, saveDraft, removeDraft,
    addSight, attractions, attrFilling, attrCount, toggleAttractions,
    addAttraction, showSight, showAttractions,
    items, selectedItem, select, pickStop, onMapClicked, addStopAt: onMapClick,
    saveTrip, uploads, here, origin, panelOpen, subtitle, waitingEdits, barPeek, setBarPeek,
    offlineAt: data.offlineAt ?? null,
  }
}
