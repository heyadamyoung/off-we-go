import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  hasBackend, signOut, subscribeToTrip, updateMe, updateTrip, uploadAvatar,
} from '../../backend'
import { MapCanvas } from '../map'
import { clamp } from '../../shared/lib/numbers'
import Icon from '../../shared/ui/icon'
import { StopEditor, useItineraryEditor } from '../itinerary'
import { FamilyView, PeopleModal } from '../people'
import { PhotoViewer, UploadModal, useTripPhotos } from '../photos'
import { AttractionCard, SightsView } from '../sights'
import { Filmstrip, HeroCard, Ticker } from './ui/trip-chrome'
import { ALL_DAYS } from '../../shared/constants/trip'
import { absoluteTripHref } from '../../app-routes-core'
import { PhotosView, TimelineView } from './ui/trip-views'
import { withFace } from './onboarding'
import useLiveTrip from './model/use-live-trip'
import useTripPresence from './model/use-trip-presence'
import type { MapView, Person, TripData } from '../../shared/model/types'
import { appErrorMessage } from '../../user-messages-core'
import ToastNoticeView, { type ToastNotice } from '../../shared/ui/toast'

interface TripAppProps {
  data: TripData
  onReload?: () => void
  onHome?: () => void
}

export default function TripApp({ data, onReload, onHome }: TripAppProps) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('wf-theme') || 'dark' } catch { return 'dark' }
  })
  const [tab, setTab] = useState('map')
  const [stops, setStops] = useState(data.stops)
  const [selected, setSelected] = useState(() => data.stops[0]?.id || null)
  const [day, setDay] = useState(() => data.stops.find(s => s.status === 'now')?.day || data.stops[0]?.day || '')
  const [query, setQuery] = useState('')
  const [person, setPerson] = useState<string | null>(null)
  const [share, setShare] = useState(false)
  const [upload, setUpload] = useState(false)
  const [notice, setNotice] = useState<ToastNotice | null>(null)
  const [following, setFollowing] = useState(true)

  const { tripId, canEdit } = data
  const [trip, setTrip] = useState(data.trip)
  const [route, setRoute] = useState(data.route)
  const [family, setFamily] = useState(() => (data.family || []).map(withFace))
  const [me, setMe] = useState(data.me || data.family[0] || { name: 'You', avatar: '' })
  const viewers = useTripPresence(tripId, family)
  /* No falling back to the first person on the trip: a photograph credited to
     somebody who is not a member belongs to them, not to whoever happens to be
     listed first. They get their initial instead. */
  const byName = useCallback(
    (name: string): Person => withFace(family.find(person => person.name === name) || { name }), [family])

  const [view, setView] = useState<MapView>(() => ({
    center: data.stops.length
      ? [data.stops.reduce((a, s) => a + s.lng, 0) / data.stops.length,
         data.stops.reduce((a, s) => a + s.lat, 0) / data.stops.length]
      : [4.8760, 52.3670],
    zoom: 13.9,
  }))
  const viewRef = useRef(view); viewRef.current = view

  const [mapOverride, setMapOverride] = useState<string | null>(null)
  useEffect(() => {
    document.body.dataset.theme = theme
    try { localStorage.setItem('wf-theme', theme) } catch { /* private mode */ }
  }, [theme])

  // A reload (realtime, or the retry button) hands down new data; adopt it.
  useEffect(() => {
    setTrip(data.trip); setRoute(data.route); setFamily((data.family || []).map(withFace))
    setStops(data.stops); setPhotos(data.photos)
    setComments(data.comments || {}); setLikes(new Set(data.likes || []))
    if (data.me) setMe(data.me)
  }, [data])

  const toastT = useRef(0)
  const toast = useCallback((message: string, tone: ToastNotice['tone'] = 'success') => {
    setNotice({ message, tone })
    window.clearTimeout(toastT.current)
    toastT.current = window.setTimeout(() => setNotice(null), tone === 'error' ? 5200 : 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(toastT.current), [])

  const {
    phones, setPhones, track, live, sun, mapTheme, km, markers, trail,
  } = useLiveTrip({ tripId, route, stops, family, mapOverride })

  const {
    photos, setPhotos, comments, setComments, likes, setLikes, viewer, viewerList,
    openViewer, closeViewer, setIndex, addComment, toggleLike, addPhoto,
    changePhoto, removePhoto, removeComment,
  } = useTripPhotos({ data, tripId, me, toast, setSelected })

  const addPhotoToMap = useCallback(async input => {
    const saved = await addPhoto(input)
    const stop = stops.find(value => value.id === saved.stopId)
    const lng = saved.lng ?? stop?.lng
    const lat = saved.lat ?? stop?.lat
    if (lng != null && lat != null) {
      setTab('map'); setFollowing(false)
      setView({ center: [lng, lat], zoom: Math.max(viewRef.current.zoom, 15), ms: 520 })
    }
    return saved
  }, [addPhoto, stops])

  const ordered = useMemo(
    () => [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [stops])
  const days = useMemo(() => [...new Set(ordered.map(s => s.day).filter(Boolean))], [ordered])

  const {
    editing, draft, setDraft, saving, routeDraft, setRouteDraft, places, setPlaces,
    attraction, setAttraction, showAttractions, finding, startEditing, onMapClick,
    searchPlaces, pickPlace, lookUpDraft, saveRoute, onStopMove, onDraftField,
    moveStop, saveDraft, removeDraft, addSight, attractions, attrFilling,
    attrCount, toggleAttractions, addAttraction, showSight,
  } = useItineraryEditor({
    day, days, ordered, stops, setStops, canEdit, tripId, view, viewRef, setView, toast,
    setRoute, setPhotos, selected, setSelected, tab, setTab, setFollowing,
  })

  // Live updates. Held off while someone is mid-edit, since refetching under an
  // open editor would pull the ground out from under them.
  const busyEditing = useRef(false)
  busyEditing.current = editing || !!draft || !!routeDraft
  useEffect(() => {
    if (!onReload) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = subscribeToTrip(tripId, () => {
      clearTimeout(timer)
      timer = setTimeout(() => { if (!busyEditing.current) onReload() }, 400)
    })
    return () => { clearTimeout(timer); stop() }
  }, [tripId, onReload])

  useEffect(() => {
    if (following) setView(v => ({ center: live, zoom: v.zoom, ms: 900 }))
  }, [live, following])

  // Search wins over the day filter: a query searches the whole trip, matching a
  // stop's own text or the caption of any photo taken there.
  const dayStops = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      const hit = s => [s.name, s.kind, s.note, s.day].some(v => (v || '').toLowerCase().includes(q))
        || photos.some(p => p.stopId === s.id && (p.caption || '').toLowerCase().includes(q))
      return ordered.filter(hit)
    }
    return day === ALL_DAYS ? ordered : ordered.filter(s => s.day === day)
  }, [ordered, photos, day, query])
  const selectedStop = stops.find(s => s.id === selected)
  const nowStop = stops.find(s => s.status === 'now')
  const nextStop = stops.find(s => s.status === 'next')
  const doneCount = stops.filter(s => s.status === 'done').length
  // Which day of the trip we are on, read off the stop marked "now" rather than
  // stored separately and left to drift.

  const handleView = useCallback((next, opts) => {
    if (opts?.user) setFollowing(false)
    setView(next)
  }, [])

  const selectStop = useCallback(id => {
    setSelected(id); setTab('map'); setFollowing(false)
    const s = stops.find(x => x.id === id)
    if (s) {
      setView({ center: [s.lng, s.lat], zoom: Math.max(viewRef.current.zoom, 15), ms: 520 })
      if (day !== ALL_DAYS && s.day !== day) setDay(s.day)
    }
  }, [stops, day])

  // In edit mode a pin opens the editor rather than the hero card.
  const pickStop = useCallback(id => {
    setSelected(id)
    if (editing) setDraft(stops.find(s => s.id === id) || null)
  }, [editing, stops])

  const closeHero = useCallback(() => setSelected(null), [])

  const fitAll = useCallback(() => {
    setFollowing(false)
    if (!stops.length) return
    setSelected(null)
    const lngs = stops.map(s => s.lng), lats = stops.map(s => s.lat)
    const west = Math.min(...lngs), east = Math.max(...lngs)
    const south = Math.min(...lats), north = Math.max(...lats)
    setView(v => ({
      center: [(west + east) / 2, (south + north) / 2],
      zoom: v.zoom, ms: 620,
      bounds: [[west, south], [east, north]],
    }))
  }, [stops])

  const zoomBy = useCallback(d => {
    setFollowing(false)
    setView(v => ({ center: v.center, zoom: clamp(v.zoom + d, 3, 18), ms: 300 }))
  }, [])

  const toggleFollow = useCallback(() => {
    const next = !following
    setFollowing(next)
    if (next) setView({ center: live, zoom: Math.max(viewRef.current.zoom, 15), ms: 560 })
  }, [following, live])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setMapOverride(next)
  }, [theme])

  const saveTrip = useCallback(async fields => {
    const before = trip
    setTrip(t => ({ ...t, ...fields }))
    try { await updateTrip(tripId, fields); toast('Trip details saved') }
    catch (e) { setTrip(before); toast(appErrorMessage(e, 'save-trip'), 'error') }
  }, [trip, tripId, toast])

  const saveMe = useCallback(async ({ name, handle, file }) => {
    try {
      if (file) await uploadAvatar(file)
      const saved = await updateMe({ name, handle })
      setMe(m => ({ ...m, ...saved }))
      setFamily(list => list.map(f => (f.id === me.id ? withFace({ ...f, ...saved }) : f)))
      toast('Profile saved')
    } catch (e) { toast(appErrorMessage(e, 'save-profile'), 'error') }
  }, [me.id, toast])

  const onPeople = useCallback(() => setShare(true), [])
  const onUpload = useCallback(() => setUpload(true), [])
  const backToMap = useCallback(() => setTab('map'), [])
  const onLive = useCallback(() => selectStop(nowStop?.id || stops[0]?.id), [selectStop, nowStop, stops])

  return (
    <div className="app wide">
      <Ticker trip={trip} km={km} doneCount={doneCount} stopCount={stops.length}
        photoCount={photos.length} nowStop={nowStop} nextStop={nextStop}
        liveKey={`${live[0]},${live[1]}`} onPeople={onPeople} tab={tab} setTab={setTab}
        onUpload={onUpload} theme={theme} onToggleTheme={toggleTheme}
        attractionsOn={showAttractions} onToggleAttractions={toggleAttractions}
        sunPhase={mapOverride ? null : sun.phase}
        canEdit={canEdit} editing={editing} onToggleEdit={startEditing}
        me={me} viewers={viewers}
        onHome={onHome}
        onSignOut={hasBackend ? () => signOut().then(() => window.location.reload()) : null} />

      <div className="stagewrap">
        <MapCanvas theme={mapTheme} tint={sun} view={view} onView={handleView}
          route={routeDraft || track} stops={stops} photos={photos} markers={markers} trail={trail}
          selectedStop={selected} labels={view.zoom > 13} onStop={pickStop}
          onPhoto={openViewer} onLive={onLive}
          editing={editing} onMapClick={onMapClick} onStopMove={onStopMove}
          places={editing && !routeDraft ? places : []} onPickPlace={pickPlace}
          attractions={attractions} onPickAttraction={setAttraction} />

        {showAttractions && attrFilling > 0 && (
          <div className="attrfill"><i /> Finding attractions… {attrCount}</div>
        )}

        {attraction && (
          <AttractionCard poi={attraction} canEdit={canEdit}
            inTrip={stops.some(s => (s.name || '').toLowerCase() === (attraction.n || '').toLowerCase())}
            onAdd={addAttraction} onClose={() => setAttraction(null)} />
        )}

        {editing && draft && (
          <StopEditor draft={draft} days={days} onField={onDraftField}
                      onSave={saveDraft} onDelete={removeDraft} onMove={moveStop}
                      onLookUp={lookUpDraft}
                      onClose={() => setDraft(null)} busy={saving} />
        )}

        {editing && !draft && (
          <div className="edithint">
            <b>{routeDraft ? 'Route' : 'Edit mode'}</b>
            {routeDraft ? (
              <>
                <span>Click to extend the line · {routeDraft.length} point{routeDraft.length === 1 ? '' : 's'}</span>
                <button onClick={() => setRouteDraft(r => r.slice(0, -1))}
                        disabled={!routeDraft.length}>Undo</button>
                <button onClick={() => setRouteDraft([])}>Clear</button>
                <button onClick={() => setRouteDraft(null)}>Cancel</button>
                <button className="go" onClick={saveRoute}>Save route</button>
              </>
            ) : (
              <>
                <span>Click the map to add a stop, or a pin to change one. Drag pins to move them.</span>
                <button onClick={searchPlaces} disabled={finding}>
                  {finding ? 'Searching…' : 'Find places'}
                </button>
                {places.length > 0 && (
                  <button onClick={() => setPlaces([])}>Hide {places.length}</button>
                )}
                <button onClick={() => setRouteDraft(route.slice())}>Edit route</button>
              </>
            )}
          </div>
        )}

        {!editing && selectedStop && (
          <HeroCard stop={selectedStop} photos={photos} onClose={closeHero}
                    openViewer={openViewer} toast={toast} />
        )}

        <div className="wctl">
          <button className="wc" onClick={() => zoomBy(1)} title="Zoom in"><Icon n="plus" s={17} w={2} /></button>
          <button className="wc" onClick={() => zoomBy(-1)} title="Zoom out"><Icon n="minus" s={17} w={2} /></button>
          <button className="wc" onClick={fitAll} title="Fit the whole trip"><Icon n="expand" s={16} /></button>
          <button className={'wc' + (following ? ' on' : '')} title="Follow the family" onClick={toggleFollow}>
            <Icon n="loc" s={17} c={following ? '#0a0c10' : 'currentColor'} w={2} />
          </button>
        </div>

        {tab === 'timeline' && <TimelineView stops={stops} photos={photos} byName={byName}
                                             openViewer={openViewer} onSelect={selectStop} onClose={backToMap} />}
        {tab === 'photos' && <PhotosView stops={stops} photos={photos} byName={byName} openViewer={openViewer}
                                         person={person} setPerson={setPerson} onClose={backToMap} />}
        {tab === 'sights' && <SightsView centre={view} stops={stops} canEdit={canEdit}
                                         onAdd={addSight} onShow={showSight}
                                         onClose={backToMap} toast={toast} />}
        {tab === 'family' && <FamilyView family={family} photos={photos} onClose={backToMap} onInvite={onPeople} />}
      </div>

      <Filmstrip stops={dayStops} photos={photos} byName={byName} selected={selected} onSelect={selectStop}
                 day={day} setDay={setDay} days={days} openViewer={openViewer}
                 query={query} setQuery={setQuery} />

      {viewerList && viewerList.length > 0 && (
        <PhotoViewer list={viewerList} index={clamp(viewer.index, 0, viewerList.length - 1)} setIndex={setIndex}
          onClose={closeViewer} stops={stops} byName={byName} comments={comments} addComment={addComment}
          likes={likes} toggleLike={toggleLike} theme={mapTheme} tint={sun} me={me}
          canEdit={canEdit} onPhotoChange={changePhoto} onPhotoDelete={removePhoto}
          onCommentDelete={removeComment} />
      )}
      {share && <PeopleModal onClose={() => setShare(false)} toast={toast} tripId={tripId}
                             family={family} canEdit={canEdit} trip={trip} onSaveTrip={saveTrip}
                             me={me} onSaveMe={saveMe} phones={phones} onPhonesChange={setPhones}
                             viewers={viewers}
                             appLink={absoluteTripHref(trip.slug, window.location.origin,
                               String(import.meta.env.VITE_API_URL || ''))} />}
      {upload && <UploadModal onClose={() => setUpload(false)} onAdd={addPhotoToMap} live={live} stops={stops} toast={toast} />}
      <ToastNoticeView notice={notice} />
    </div>
  )
}
