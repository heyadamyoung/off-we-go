import { localDayIso } from '../../../trip-days-core'
import { useCallback, useEffect, useRef } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { absoluteTripHref } from '../../../app-routes-core'
import { clamp } from '../../../shared/lib/numbers'
import { ALL_DAYS, type SettingsTab } from '../../../trip-search-core'
import Boot from '../../../shared/ui/boot'
import AccountMenu from '../../../shared/ui/account-menu'
import { useToast } from '../../../shared/ui/toast'
import { MapAskOverlays } from './map-menu'
import TripMap from './trip-map'
import { AssistantButton, AssistantChat } from '../../assistant'
import { PhotoViewer, UploadBar, UploadModal } from '../../photos'
import { TripSettingsSheet } from '../../people'
import useTripData from '../model/use-trip-data'
import useTripLegs from '../model/use-trip-legs'
import useTripChat from '../model/use-trip-chat'
import { withFace } from '../model/faces'
import useMapAsk from '../model/use-map-ask'
import TripNow from './trip-now'
import usePapers from '../model/use-papers'
import useStopDocs from '../model/use-stop-docs'
import useTripPage from '../model/use-trip-page'
import { MapChrome, MapControls, ScopeToggle, StandingNotices, TripTitle } from './trip-chrome'
import { TripCluster } from './trip-cluster'
import TripBar from './trip-bar'
import TripPanel from './trip-panel'
import TripCards from './trip-cards'
import { TravelDayActivity } from '../../transport'
import type { Coordinates, TripData } from '../../../shared/model/types'
import { dayLabelOf } from '../../../day-label-core'

export default function TripPage({ slug }: { slug: string }) {
  const busyEditing = useRef(false)
  const canAdopt = useCallback(() => !busyEditing.current, [])
  const { data, error, reload } = useTripData(slug, canAdopt)
  if (error) return <Boot what="This trip" error={error} onRetry={reload} />
  if (!data) return <Boot what="the trip" />
  return <Trip key={data.tripId} data={data} busyEditing={busyEditing} reload={reload} />
}

/* Typed access to this route's search params without importing the route
   file — that import is a real cycle (route → feature → route), and the
   router's registry gives the same types without it. */
const routeApi = getRouteApi('/trips/$slug')

function Trip({
  data,
  busyEditing,
  reload,
}: {
  data: TripData
  busyEditing: React.MutableRefObject<boolean>
  reload: () => void
}) {
  const search = routeApi.useSearch()
  const navigate = useNavigate()
  const notify = useToast()
  const { tripId, canEdit } = data
  const legs = useTripLegs({ tripId, stops: data.stops })
  const stopDocs = useStopDocs(tripId, reload, notify)

  const patch = useCallback(
    (changes: Record<string, unknown>) => {
      navigate({ to: '.', search: current => ({ ...current, ...changes }), replace: true })
    },
    [navigate],
  )

  const page = useTripPage({ data, busyEditing, search, patch, notify, reload })
  // The paper on screen, and where a rename to it is sent — see use-papers.
  const papers = usePapers(canEdit, page.transport, stopDocs)
  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  const {
    theme, toggleTheme, trip, stops, family, me, viewers, placing, setPlacing, planOnDay, photoBy, setPhotoBy,
    streetNames, toggleStreetNames,
    asking, setAsking, assistant, view, setView, selected, query, day, days, toast,
    mapView, setMapView, following, setFollowing, toggleFollow,
    phones, setPhones, fixes, sun, mapTheme, markers, progress, progressCopy, openViewer,
    latestGpsPosition, lastSeenPosition, liveStop, liveDay, liveStops, transport,
    setSegmentEditing, clock, showGate, saveTrip, uploads, origin, panelOpen, subtitle,
    photos, comments, likes, viewer, viewerList, viewerIndex, closeViewer, setIndex,
    addComment, toggleLike, changePhoto, movePhotos, removePhoto, removePhotos, removeComment, editing, startEditing,
    addSight, toggleAttractions, showSight, showAttractions, items, selectedItem, select, addStopAt,
    offlineAt, waitingEdits, barPeek, setBarPeek,
  } = page
  const chat = useTripChat({ tripId, toast })
  const ask = useMapAsk({
    tripId,
    sample: data.source === 'sample',
    from: latestGpsPosition ?? lastSeenPosition,
    stop: selectedItem?.stop || null,
    toast,
  })
  /* Heading-up owns the camera; two authorities easing it at once would fight. */
  const headingUp = ask.compass.mode === 'heading'
  useEffect(() => {
    if (headingUp) setFollowing(false)
  }, [headingUp, setFollowing])

  return (
    <div
      className={
        'tripscreen fixed inset-x-0 top-0 h-[100dvh] overflow-hidden bg-canvas text-ink' +
        (barPeek ? ' barpeek' : '')
      }
      onScroll={event => {
        const screen = event.currentTarget
        if (screen.scrollTop || screen.scrollLeft) {
          screen.scrollTop = 0
          screen.scrollLeft = 0
        }
      }}>
      <TripMap page={page} ask={ask} patch={patch} onContextMenu={ask.setMenuAt} />
      <MapAskOverlays
        ask={ask}
        canEdit={canEdit}
        onAddStop={addStopAt}
        onDeselect={() => patch({ sel: undefined })}
      />

      {/* The map runs behind everything; two washes keep the chrome legible. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70
                      [background:linear-gradient(to_bottom,var(--c-bg)_0%,transparent_26%,transparent_58%,var(--c-bg)_100%)]"
      />

      {/* One top bar rather than two islands laid out from opposite edges that
          met in the middle of a phone. On a phone it is a real bar on its own
          surface, the tabs on a second line and the panels opening beneath it;
          above 640px it goes back to floating over the map, where there is room. */}
      <div
        id="trip-top"
        className="absolute inset-x-0 top-0 z-20 flex h-[var(--trip-top)] flex-wrap
                      items-center gap-1 border-b border-line bg-strong px-4 pb-1
                      pt-[calc(0.375rem+env(safe-area-inset-top,0px))] backdrop-blur-[22px]
                      sm:inset-x-7 sm:top-6 sm:h-auto sm:flex-nowrap sm:items-start sm:gap-3
                      sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0 sm:backdrop-blur-none
                      sm:mx-auto sm:max-w-[1760px]">
        <TripTitle title={trip.title} sub={subtitle} behindPanel={view !== 'map'} />

        <div className="order-3 flex w-full min-w-0 items-center gap-2 sm:order-2 sm:w-auto">
          <TripCluster
            view={view}
            onView={setView}
            canEdit={canEdit}
            editing={editing}
            placing={!!placing}
            theme={theme}
            attractions={showAttractions}
            onAttractions={toggleAttractions}
            streetNames={streetNames}
            onStreetNames={toggleStreetNames}
            onEdit={startEditing}
            onSettings={() => patch({ sheet: 'settings', tab: 'trip' })}
            onPlace={() => {
              setPlacing(placing ? null : {})
              patch({ sel: undefined })
            }}
            onAdd={() => patch({ sheet: 'add' })}
            onTheme={toggleTheme}
          />
        </div>

        <div className={'order-2 sm:order-3' + (view !== 'map' ? ' max-sm:hidden' : '')}>
          <AccountMenu me={me} />
        </div>
      </div>

      {panelOpen && (
        <TripPanel
          view={view}
          stops={liveStops}
          photos={photos}
          people={family}
          viewers={viewers}
          selected={selected}
          photoBy={photoBy}
          onPhotoBy={setPhotoBy}
          onSelect={select}
          onClose={() => patch({ view: undefined })}
          onInvite={() => patch({ sheet: 'settings', tab: 'people' })}
          onAddPhotos={canEdit ? () => patch({ sheet: 'add' }) : undefined}
          onMovePhotos={canEdit ? movePhotos : undefined}
          onDeletePhotos={canEdit ? removePhotos : undefined}
          legs={legs}
          onAddOnDay={canEdit ? planOnDay : undefined}
          onTravel={() => patch({ view: 'travel' })}
          papers={{ onOpen: papers.open }}
          chat={{ ...chat, meId: me?.id }}
          sights={{ centre: mapView, stops, canEdit, onAdd: addSight, onShow: showSight, toast }}
          transport={{
            tripId,
            segments: transport.segments,
            loadFailed: transport.loadFailed,
            now: clock,
            canEdit,
            onEdit: segment => setSegmentEditing(segment.id),
            onAdd: () => setSegmentEditing('new'),
            onShowGate: showGate,
            onAttach: (segment, file) => transport.attachDocument(segment.id, file, {}),
            onOpenPaper: papers.open,
          }}
        />
      )}

      <TripCards
        page={page}
        canEdit={canEdit}
        patch={patch}
        stopDocs={stopDocs}
        papers={papers}
        stats={ask.stats}
      />

      {/* The Lock Screen card: the same legs, positions and clock the meter
          reads, kept true from here whether or not any panel is open. */}
      <TravelDayActivity
        segments={transport.segments}
        markers={markers}
        fixes={fixes}
        now={clock}
      />
      <MapChrome>
        <ScopeToggle
          shifted={panelOpen}
          whole={day === ALL_DAYS}
          /* The label, not the date: the toggle says 'Fri 4 Sep', never
             '2026-09-04'. The date is what everything compares by. */
          here={liveDay && day !== ALL_DAYS ? dayLabelOf(day) || day : 'Today'}
          onHere={() => patch({ day: liveDay || days[0]?.iso, sel: undefined })}
          onWhole={() => patch({ day: ALL_DAYS, sel: undefined })}
        />
        {/* A demo has no phone to wait for: the sample never shows the GPS
            nudge, which read as broken in the one trip everyone sees first. */}
        {!panelOpen && (data.source !== 'sample' || progressCopy.tone !== 'waiting') && (
          <TripNow
            tripId={tripId}
            progressCopy={progressCopy}
            progress={progress}
            stops={stops}
            photos={photos}
            segments={transport.segments}
            fixes={fixes}
            travellers={markers
              .filter(marker => !marker.stale)
              .map(marker => ({ name: marker.name, lng: marker.lng, lat: marker.lat }))}
            clock={clock}
            travelling={canEdit}
            liveStop={liveStop}
            onFollow={stop => {
              setFollowing(true)
              if (stop) patch({ sel: stop.id, day: stop.day })
            }}
            onSelect={stop => {
              setFollowing(false)
              patch({ sel: stop.id, day: stop.day })
            }}
            onPhotos={photo => {
              const at = photos.findIndex(one => one.id === photo.id)
              openViewer(photos, at < 0 ? 0 : at)
            }}
            onTravel={() => patch({ view: 'travel' })}
            onPaper={papers.open}
          />
        )}
        <AssistantButton on={asking} onClick={() => setAsking(value => !value)} />
        <MapControls
          following={following}
          onFollow={toggleFollow}
          compassOn={ask.compass.on}
          onCompass={ask.compass.toggle}
          onZoom={by => {
            setFollowing(false)
            setMapView(current => ({
              center: current.center,
              zoom: clamp(current.zoom + by, 3, 18),
              ms: 300,
            }))
          }}
        />
      </MapChrome>

      {asking && (
        <AssistantChat
          messages={assistant.messages}
          busy={assistant.busy}
          error={assistant.error}
          canEdit={canEdit}
          onAsk={assistant.ask}
          onRetry={assistant.retry}
          onClose={() => setAsking(false)}
        />
      )}

      <UploadBar queue={uploads} lowered={panelOpen} />

      <TripBar
        items={items}
        days={days}
        day={day}
        liveDay={liveDay ?? undefined}
        today={localDayIso(clock)}
        selected={selected}
        behindPanel={panelOpen}
        onAddStop={
          canEdit
            ? () => {
                setPlacing({})
                patch({ sel: undefined })
              }
            : undefined
        }
        query={query}
        onDay={value => patch({ day: value, sel: undefined })}
        onQuery={value => patch({ q: value || undefined })}
        onSelect={select}
        peek={barPeek}
        onPeek={setBarPeek}
      />

      {viewer && viewerList && viewerList.length > 0 && (
        <PhotoViewer
          tripId={tripId}
          list={viewerList}
          index={viewerIndex}
          setIndex={setIndex}
          stops={liveStops}
          onClose={() => {
            closeViewer()
            if (selectedItem?.kind === 'photo') patch({ sel: undefined })
          }}
          byName={(name: string) =>
            withFace(family.find(person => person.name === name) || { name })
          }
          comments={comments}
          addComment={addComment}
          likes={likes}
          toggleLike={toggleLike}
          theme={mapTheme}
          tint={sun}
          me={me}
          canEdit={canEdit}
          onPhotoChange={changePhoto}
          onPhotoDelete={removePhoto}
          onCommentDelete={removeComment}
        />
      )}

      {search.sheet === 'settings' && (
        <TripSettingsSheet
          tab={(search.tab || 'trip') as SettingsTab}
          onTab={tab => patch({ tab })}
          onClose={() => patch({ sheet: undefined, tab: undefined })}
          tripId={tripId}
          trip={trip}
          family={family}
          me={me}
          canEdit={canEdit}
          phones={phones}
          onPhones={setPhones}
          mapPoints={stops.map(stop => [stop.lng, stop.lat] as Coordinates)}
          onSaveTrip={saveTrip}
          toast={toast}
          appLink={absoluteTripHref(
            trip.slug || '',
            origin,
            String(import.meta.env.VITE_API_URL || ''),
          )}
        />
      )}

      {search.sheet === 'add' && (
        <UploadModal
          onClose={() => patch({ sheet: undefined })}
          onAdd={uploads.add}
          live={latestGpsPosition}
          toast={toast}
        />
      )}

      <StandingNotices
        waitingEdits={waitingEdits}
        offlineAt={offlineAt}
        sample={data.source === 'sample'}
      />
    </div>
  )
}
