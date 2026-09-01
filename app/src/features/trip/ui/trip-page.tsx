import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Route } from '../../../routes/trips.$slug'
import { hasBackend, updateTrip } from '../../../backend'
import { absoluteTripHref } from '../../../app-routes-core'
import { clamp } from '../../../shared/lib/numbers'
import { ALL_DAYS, type SettingsTab, type TripView } from '../../../trip-search-core'
import Boot from '../../../shared/ui/boot'
import AccountMenu from '../../../shared/ui/account-menu'
import { useToast } from '../../../shared/ui/toast'
import { MapCanvas } from '../../map'
import { StopEditor, useItineraryEditor } from '../../itinerary'
import { PhotoViewer, UploadModal, useTripPhotos } from '../../photos'
import { AttractionCard } from '../../sights'
import { TripSettingsSheet } from '../../people'
import { appErrorMessage } from '../../../user-messages-core'
import { liveFollowView } from '../../../live-map-view-core'
import useLiveTrip from '../model/use-live-trip'
import useTripPresence from '../model/use-trip-presence'
import useTripData from '../model/use-trip-data'
import { withFace } from '../model/faces'
import { daysOf, tripItems, type TripItem } from '../model/trip-items'
import {
  EditHint, MapControls, NowCapsule, PlaceHint, ScopeToggle, TripCluster, TripTitle,
} from './trip-chrome'
import TripBar from './trip-bar'
import TripPanel from './trip-panel'
import DetailCard from './detail-card'
import type { Coordinates, MapView, Person, TripData } from '../../../shared/model/types'

export default function TripPage({ slug }: { slug: string }) {
  const busyEditing = useRef(false)
  const canAdopt = useCallback(() => !busyEditing.current, [])
  const { data, error, reload } = useTripData(slug, canAdopt)
  if (error) return <Boot what="This trip" error={error} onRetry={reload} />
  if (!data) return <Boot what="the trip" />
  return <Trip key={data.tripId} data={data} busyEditing={busyEditing} />
}

function Trip({ data, busyEditing }:
  { data: TripData; busyEditing: React.MutableRefObject<boolean> }) {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const notify = useToast()
  const { tripId, canEdit } = data

  const patch = useCallback((changes: Record<string, unknown>) => {
    navigate({ to: '.', search: current => ({ ...current, ...changes }), replace: true })
  }, [navigate])

  const setView = useCallback((next: any) => {
    const value = typeof next === 'function' ? next('map') : next
    patch({ view: value === 'map' ? undefined : value })
  }, [patch])

  // The boot script in the document head has already applied the stored theme;
  // read it back off the element rather than from storage, which the shell
  // renderer does not have.
  const [theme, setTheme] = useState(() => (typeof document === 'undefined'
    ? 'dark' : document.documentElement.dataset.theme || 'dark'))
  const [trip, setTrip] = useState(data.trip)
  const [route, setRoute] = useState(data.route)
  const [stops, setStops] = useState(data.stops)
  const [family, setFamily] = useState(() => (data.family || []).map(withFace))
  const [me] = useState<Person>(data.me || data.family[0] || { name: 'You' })
  const [following, setFollowing] = useState(true)
  const [placing, setPlacing] = useState<null | { move?: string }>(null)
  const [photoBy, setPhotoBy] = useState<string | null>(null)
  const [mapOverride, setMapOverride] = useState<string | null>(theme)
  const [attraction, setAttractionCard] = useState<any>(null)
  const viewers = useTripPresence(tripId, family)

  const view: TripView = search.view || 'map'
  const selected = search.sel
  const query = search.q || ''

  const toast = useCallback((message: string, tone: 'success' | 'error' = 'success') =>
    notify(message, tone), [notify])

  /* The hooks below think in stop ids; the chrome thinks in items. This is the
     seam between the two. */
  const selectId = useCallback((next: string | null | ((current: any) => any)) => {
    const id = typeof next === 'function' ? next(null) : next
    patch({ sel: id || undefined })
  }, [patch])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('offwego-theme', theme) } catch { /* private mode */ }
  }, [theme])

  // A reload hands down new data; adopt it.
  useEffect(() => {
    setTrip(data.trip); setRoute(data.route); setStops(data.stops)
    setFamily((data.family || []).map(withFace))
  }, [data])

  const [mapView, setMapView] = useState<MapView>(() => ({
    center: data.stops.length
      ? [data.stops.reduce((total, stop) => total + stop.lng, 0) / data.stops.length,
         data.stops.reduce((total, stop) => total + stop.lat, 0) / data.stops.length]
      : [4.8760, 52.3670],
    zoom: 13.9,
  }))
  const viewRef = useRef(mapView); viewRef.current = mapView

  const ordered = useMemo(
    () => [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [stops])
  const {
    phones, setPhones, track, live, livePoints, liveReady, sun, mapTheme, markers, trail,
    progress, progressCopy,
  } = useLiveTrip({ tripId, route, stops: ordered, family, mapOverride })
  const liveStop = progress.currentStop || progress.destination
  const day = search.day || liveStop?.day || ALL_DAYS

  const {
    photos, setPhotos, comments, likes, viewer, viewerList,
    openViewer, closeViewer, setIndex, addComment, toggleLike, addPhoto,
    changePhoto, removePhoto, removeComment,
  } = useTripPhotos({ data, tripId, me, toast, setSelected: selectId })

  const days = useMemo(() => daysOf(ordered), [ordered])

  const {
    editing, draft, setDraft, saving, routeDraft, setRouteDraft, places, setPlaces,
    startEditing, onMapClick, searchPlaces, pickPlace, lookUpDraft, saveRoute, onStopMove,
    onDraftField, moveStop, saveDraft, removeDraft, addSight, attractions, attrFilling,
    attrCount, toggleAttractions, addAttraction, showSight, showAttractions,
  } = useItineraryEditor({
    day, days, ordered, stops, setStops, canEdit, tripId,
    view: mapView, viewRef, setView: setMapView, toast, setRoute, setPhotos,
    selected: selected || null, setSelected: selectId,
    tab: view, setTab: setView, setFollowing,
  })

  busyEditing.current = editing || !!draft || !!routeDraft

  useEffect(() => {
    if (!following || !liveReady) return
    setMapView(current => liveFollowView(current, livePoints, { ready: true, duration: 900 })
      || { center: live, zoom: current.zoom, ms: 900 })
  }, [live, livePoints, liveReady, following])

  const items = useMemo(
    () => tripItems({ stops: ordered, photos, day, query }), [ordered, photos, day, query])
  const selectedItem = useMemo(
    () => items.find(item => item.id === selected)
      || tripItems({ stops: ordered, photos, day: ALL_DAYS }).find(item => item.id === selected),
    [items, ordered, photos, selected])

  const liveDay = liveStop?.day

  const onMapView = useCallback((next: MapView, options?: { user?: boolean }) => {
    if (options?.user) setFollowing(false)
    setMapView(next)
  }, [])

  const select = useCallback((item: TripItem) => {
    setFollowing(false)
    const target = item.stop
    if (item.kind === 'photo' && item.photo?.lng != null && item.photo?.lat != null) {
      setMapView({ center: [item.photo.lng, item.photo.lat], zoom: Math.max(viewRef.current.zoom, 15), ms: 520 })
    } else if (target) {
      setMapView({ center: [target.lng, target.lat], zoom: Math.max(viewRef.current.zoom, 15), ms: 520 })
    }
    patch({ sel: item.id, ...(day !== ALL_DAYS && item.day && item.day !== day ? { day: item.day } : {}) })
  }, [patch, day])

  const pickStop = useCallback((id: string) => {
    if (placing?.move) return
    patch({ sel: id })
    if (editing) setDraft(stops.find(stop => stop.id === id) || null)
  }, [editing, stops, placing, patch, setDraft])

  const onMapClicked = useCallback((point: Coordinates) => {
    if (placing) {
      const target = placing.move ? stops.find(stop => stop.id === placing.move) : null
      if (target) { onStopMove(target.id, point); toast('Pin moved') }
      else { onMapClick(point) }
      setPlacing(null)
      return
    }
    if (editing) onMapClick(point)
  }, [placing, stops, onStopMove, onMapClick, editing, toast])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (placing) setPlacing(null)
      else if (draft) setDraft(null)
      else if (selected) patch({ sel: undefined })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [placing, draft, selected, patch, setDraft])

  const fitAll = useCallback(() => {
    setFollowing(false)
    if (!stops.length) return
    const lngs = stops.map(stop => stop.lng)
    const lats = stops.map(stop => stop.lat)
    const west = Math.min(...lngs), east = Math.max(...lngs)
    const south = Math.min(...lats), north = Math.max(...lats)
    setMapView(current => ({
      center: [(west + east) / 2, (south + north) / 2], zoom: current.zoom, ms: 620,
      bounds: [[west, south], [east, north]],
    }))
  }, [stops])

  const toggleFollow = useCallback(() => {
    const next = !following
    setFollowing(next)
    if (next) {
      setMapView(current => liveFollowView(current, livePoints, { ready: liveReady, duration: 560 })
        || { center: live, zoom: Math.max(current.zoom, 15), ms: 560 })
    }
  }, [following, live, livePoints, liveReady])

  const saveTrip = useCallback(async (fields: Record<string, unknown>) => {
    const before = trip
    setTrip(current => ({ ...current, ...fields }))
    try { await updateTrip(tripId, fields); toast('Trip details saved') }
    catch (caught) { setTrip(before); toast(appErrorMessage(caught, 'save-trip'), 'error') }
  }, [trip, tripId, toast])

  const addPhotoToMap = useCallback(async input => {
    const saved = await addPhoto(input)
    const stop = stops.find(value => value.id === saved.stopId)
    const lng = stop?.lng ?? saved.lng
    const lat = stop?.lat ?? saved.lat
    if (lng != null && lat != null) {
      setFollowing(false)
      setMapView({ center: [lng, lat], zoom: Math.max(viewRef.current.zoom, 15), ms: 520 })
    }
    return saved
  }, [addPhoto, stops])

  const here = photos.filter(photo => photo.stopId === selectedItem?.stop?.id)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const panelOpen = view !== 'map'
  const subtitle = [
    trip.crew, trip.dates,
    `${family.filter(person => person.memberRole !== 'viewer').length} travelling`,
    `${family.filter(person => person.memberRole === 'viewer').length} following`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 overflow-hidden bg-canvas text-ink">
      <MapCanvas theme={mapTheme} tint={sun} view={mapView} onView={onMapView}
        route={routeDraft || track} stops={stops} photos={photos} markers={markers} trail={trail}
        selectedStop={selected} labels={mapView.zoom > 13} onStop={pickStop}
        onPhoto={openViewer} onLive={() => nowStop && patch({ sel: nowStop.id })}
        editing={editing} placing={!!placing} onMapClick={onMapClicked} onStopMove={onStopMove}
        places={editing && !routeDraft ? places : []} onPickPlace={pickPlace}
        attractions={attractions} onPickAttraction={setAttractionCard} />

      {/* The map runs behind everything; these two washes keep the chrome legible
          without a panel behind each piece of it. */}
      <div className="pointer-events-none absolute inset-0 opacity-70
                      [background:linear-gradient(to_bottom,var(--c-bg)_0%,transparent_26%,transparent_58%,var(--c-bg)_100%)]" />

      {/* One top bar rather than two islands laid out from opposite edges that
          met in the middle of a phone. On a phone it is a real bar, anchored to
          the top edge on its own surface, with the actions on a second line and
          the panels opening directly beneath it; above 640px it goes back to
          floating over the map, which is where there is room for it. */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-[var(--trip-top)] flex-wrap
                      items-center gap-2 border-b border-line bg-strong px-4 pb-2
                      pt-[calc(0.75rem+env(safe-area-inset-top,0px))] backdrop-blur-[22px]
                      sm:inset-x-7 sm:top-6 sm:h-auto sm:flex-nowrap sm:items-start sm:gap-3
                      sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0 sm:backdrop-blur-none">
        <TripTitle title={trip.title} sub={subtitle} />

        <div className="order-3 flex w-full min-w-0 items-center gap-2.5 sm:order-2 sm:w-auto">
          <TripCluster view={view} onView={setView}
            canEdit={canEdit} editing={editing} placing={!!placing} following={following}
            theme={theme} attractions={showAttractions} onAttractions={toggleAttractions}
            onEdit={startEditing}
            onSettings={() => patch({ sheet: 'settings', tab: 'trip' })}
            onPlace={() => { setPlacing(placing ? null : {}); patch({ sel: undefined }) }}
            onFollow={toggleFollow}
            onAdd={() => patch({ sheet: 'add' })}
            onTheme={() => {
              const next = theme === 'dark' ? 'light' : 'dark'
              setTheme(next); setMapOverride(next)
            }} />
        </div>

        <div className="order-2 sm:order-3"><AccountMenu me={me} /></div>
      </div>

      {panelOpen && (
        <TripPanel view={view} stops={ordered} photos={photos} people={family} viewers={viewers}
          selected={selected} photoBy={photoBy} onPhotoBy={setPhotoBy}
          onSelect={select} onClose={() => patch({ view: undefined })}
          onInvite={() => patch({ sheet: 'settings', tab: 'people' })}
          onAddPhotos={() => patch({ sheet: 'add' })}
          sights={{ centre: mapView, stops, canEdit, onAdd: addSight, onShow: showSight, toast }} />
      )}

      {!draft && selectedItem && (
        <DetailCard item={selectedItem} shifted={panelOpen} canEdit={canEdit}
          photoCount={selectedItem.kind === 'photo' ? 0 : here.length}
          onClose={() => patch({ sel: undefined })}
          onOpenPhotos={() => (selectedItem.kind === 'photo' && selectedItem.photo
            ? openViewer([selectedItem.photo], 0) : openViewer(here, 0))}
          onAddPhotos={() => patch({ sheet: 'add' })}
          onEdit={() => { startEditing(); setDraft(selectedItem.stop || null) }}
          onMove={() => setPlacing({ move: selectedItem.id })}
          onDelete={() => { setDraft(selectedItem.stop || null); removeDraft() }} />
      )}

      {draft && (
        <StopEditor draft={draft} days={days} onField={onDraftField} onSave={saveDraft}
          onDelete={removeDraft} onMove={moveStop} onLookUp={lookUpDraft}
          onClose={() => setDraft(null)} busy={saving} />
      )}

      {placing && (
        <PlaceHint onCancel={() => setPlacing(null)}
          what={placing.move ? 'Click the map to move this stop' : 'Click the map where the stop is'} />
      )}

      {editing && !draft && (
        <EditHint routeDraft={routeDraft} setRouteDraft={setRouteDraft} saveRoute={saveRoute}
          searchPlaces={searchPlaces} places={places} setPlaces={setPlaces} route={route} />
      )}

      {attraction && (
        <AttractionCard poi={attraction} canEdit={canEdit}
          inTrip={stops.some(stop => (stop.name || '').toLowerCase() === (attraction.n || '').toLowerCase())}
          onAdd={addAttraction} onClose={() => setAttractionCard(null)} />
      )}

      {showAttractions && attrFilling > 0 && (
        <div className="glass absolute left-1/2 top-20 z-[6] -translate-x-1/2 rounded-full px-3.5 py-2
                        text-xs text-muted">Finding attractions… {attrCount}</div>
      )}

      {!panelOpen && (
        <NowCapsule text={progressCopy.text} meta={progressCopy.meta} tone={progressCopy.tone}
          onClick={() => {
            setFollowing(true)
            if (liveStop) patch({ sel: liveStop.id, day: liveStop.day })
          }} />
      )}

      <ScopeToggle shifted={panelOpen} whole={day === ALL_DAYS}
        here={liveDay && day !== ALL_DAYS ? day : 'Today'}
        onHere={() => patch({ day: liveDay || days[0], sel: undefined })}
        onWhole={() => patch({ day: ALL_DAYS, sel: undefined })} />

      <MapControls following={following} onFollow={toggleFollow} onFit={fitAll}
        onZoom={by => {
          setFollowing(false)
          setMapView(current => ({ center: current.center, zoom: clamp(current.zoom + by, 3, 18), ms: 300 }))
        }} />

      <TripBar items={items} days={days} day={day} liveDay={liveDay} selected={selected}
        behindPanel={panelOpen}
        query={query} onDay={value => patch({ day: value, sel: undefined })}
        onQuery={value => patch({ q: value || undefined })} onSelect={select} />

      {viewer && viewerList && viewerList.length > 0 && (
        <PhotoViewer list={viewerList} index={clamp(viewer.index, 0, viewerList.length - 1)}
          setIndex={setIndex} onClose={closeViewer} stops={stops}
          byName={(name: string) => withFace(family.find(person => person.name === name) || { name })}
          comments={comments} addComment={addComment} likes={likes} toggleLike={toggleLike}
          theme={mapTheme} tint={sun} me={me} canEdit={canEdit} onPhotoChange={changePhoto}
          onPhotoDelete={removePhoto} onCommentDelete={removeComment} />
      )}

      {search.sheet === 'settings' && (
        <TripSettingsSheet tab={(search.tab || 'trip') as SettingsTab} onTab={tab => patch({ tab })}
          onClose={() => patch({ sheet: undefined, tab: undefined })}
          tripId={tripId} trip={trip} family={family} me={me} canEdit={canEdit}
          phones={phones} onPhones={setPhones} onSaveTrip={saveTrip} toast={toast}
          appLink={absoluteTripHref(trip.slug || '', origin,
            String(import.meta.env.VITE_API_URL || ''))} />
      )}

      {search.sheet === 'add' && (
        <UploadModal onClose={() => patch({ sheet: undefined })} onAdd={addPhotoToMap}
          live={live} stops={stops} toast={toast} theme={mapTheme} tint={sun} />
      )}

      {!hasBackend && (
        <div className="pointer-events-none absolute bottom-[var(--trip-3)] left-4 z-[3] rounded-full
                        sm:bottom-[var(--trip-2)]
                        bg-accent-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[.1em]
                        text-accent">Sample trip</div>
      )}
    </div>
  )
}
