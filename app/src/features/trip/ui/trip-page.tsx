import { useCallback, useRef, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { absoluteTripHref } from '../../../app-routes-core'
import { clamp } from '../../../shared/lib/numbers'
import { ALL_DAYS, type SettingsTab } from '../../../trip-search-core'
import Boot from '../../../shared/ui/boot'
import AccountMenu from '../../../shared/ui/account-menu'
import { useToast } from '../../../shared/ui/toast'
import { MapMenu, MeasurePill } from './map-menu'
import TripMap from './trip-map'
import { AssistantButton, AssistantChat } from '../../assistant'
import { PhotoViewer, UploadModal, UploadTray } from '../../photos'
import { TripSettingsSheet } from '../../people'
import useTripData from '../model/use-trip-data'
import useTripLegs from '../model/use-trip-legs'
import useTripChat from '../model/use-trip-chat'
import { withFace } from '../model/faces'
import useRouteToStop from '../model/use-route-to-stop'
import useStopDocs from '../model/use-stop-docs'
import useTripPage from '../model/use-trip-page'
import {
  Advisories,
  MapChrome,
  MapControls,
  NowCapsule,
  ScopeToggle,
  TripTitle,
} from './trip-chrome'
import { TripCluster } from './trip-cluster'
import Icon from '../../../shared/ui/icon'
import OfflineNote from '../../../shared/ui/offline-note'
import { SegmentEditor } from '../../transport'
import TripBar from './trip-bar'
import TripPanel from './trip-panel'
import TripCards from './trip-cards'
import type { Coordinates, TripData } from '../../../shared/model/types'

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
  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  const {
    theme, setTheme, trip, stops, family, me, viewers, placing, setPlacing, photoBy, setPhotoBy,
    setMapOverride, asking, setAsking, assistant, view, setView, selected, query, day, days, toast,
    mapView, setMapView, following, setFollowing, toggleFollow, fitAll,
    phones, setPhones, sun, mapTheme, markers, progressCopy,
    latestGpsPosition, lastSeenPosition, liveStop, liveDay, liveStops, transport, segmentEditing,
    setSegmentEditing, clock, showGate, saveTrip, uploads, origin, panelOpen, subtitle,
    photos, comments, likes, viewer, viewerList, viewerIndex, closeViewer, setIndex,
    addComment, toggleLike, changePhoto, removePhoto, removeComment, editing, startEditing,
    addSight, toggleAttractions, showSight, showAttractions, items, selectedItem, select, addStopAt,
    offlineAt, waitingEdits, barPeek, setBarPeek,
  } = page
  const chat = useTripChat({ tripId, toast })
  const [menuAt, setMenuAt] = useState<Coordinates | null>(null)
  const [probe, setProbe] = useState<Coordinates | null>(null)
  const toStop = useRouteToStop({
    tripId,
    sample: data.source === 'sample',
    from: latestGpsPosition ?? lastSeenPosition,
    stop: selectedItem?.stop || null,
    point: probe,
  })

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
      <TripMap page={page} measure={toStop.measure} patch={patch} onContextMenu={setMenuAt} />
      {menuAt && (
        <MapMenu
          at={menuAt}
          canEdit={canEdit}
          canMeasure={!!latestGpsPosition}
          onAddStop={addStopAt}
          onMeasure={setProbe}
          onClose={() => setMenuAt(null)}
        />
      )}
      {probe && !selectedItem?.stop && toStop.summary && (
        <MeasurePill summary={toStop.summary} onClose={() => setProbe(null)} />
      )}

      {/* The map runs behind everything; these two washes keep the chrome legible
          without a panel behind each piece of it. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70
                      [background:linear-gradient(to_bottom,var(--c-bg)_0%,transparent_26%,transparent_58%,var(--c-bg)_100%)]"
      />

      {/* One top bar rather than two islands laid out from opposite edges that
          met in the middle of a phone. On a phone it is a real bar, anchored to
          the top edge on its own surface, with the actions on a second line and
          the panels opening directly beneath it; above 640px it goes back to
          floating over the map, which is where there is room for it. */}
      <div
        className="absolute inset-x-0 top-0 z-20 flex h-[var(--trip-top)] flex-wrap
                      items-center gap-2 border-b border-line bg-strong px-4 pb-2
                      pt-[calc(0.75rem+env(safe-area-inset-top,0px))] backdrop-blur-[22px]
                      sm:inset-x-7 sm:top-6 sm:h-auto sm:flex-nowrap sm:items-start sm:gap-3
                      sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0 sm:backdrop-blur-none
                      sm:mx-auto sm:max-w-[1760px]">
        <TripTitle title={trip.title} sub={subtitle} />

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
            onEdit={startEditing}
            onSettings={() => patch({ sheet: 'settings', tab: 'trip' })}
            onPlace={() => {
              setPlacing(placing ? null : {})
              patch({ sel: undefined })
            }}
            onAdd={() => patch({ sheet: 'add' })}
            onTheme={() => {
              const next = theme === 'dark' ? 'light' : 'dark'
              setTheme(next)
              setMapOverride(next)
            }}
          />
        </div>

        <div className="order-2 sm:order-3">
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
          legs={legs}
          chat={{ ...chat, meId: me?.id }}
          sights={{ centre: mapView, stops, canEdit, onAdd: addSight, onShow: showSight, toast }}
          transport={{
            segments: transport.segments,
            loadFailed: transport.loadFailed,
            now: clock,
            canEdit,
            onEdit: segment => setSegmentEditing(segment.id),
            onAdd: () => setSegmentEditing('new'),
            onShowGate: showGate,
            onAttach: (segment, file) => transport.attachDocument(segment.id, file, {}),
            onEditDoc: transport.editDocument,
            onRemoveDoc: transport.removeDocument,
          }}
        />
      )}

      {segmentEditing !== null && (
        <SegmentEditor
          segment={transport.segments.find(s => s.id === segmentEditing) || null}
          people={family}
          onSave={transport.saveSegment}
          onDelete={transport.removeSegment}
          onClose={() => setSegmentEditing(null)}
        />
      )}

      <TripCards
        page={page}
        canEdit={canEdit}
        patch={patch}
        stopDocs={stopDocs}
        fromYou={toStop.summary}
      />

      {!panelOpen && (
        <Advisories
          segments={transport.segments}
          markers={markers}
          phones={phones}
          now={clock}
          sample={data.source === 'sample'}
        />
      )}

      <MapChrome>
        <ScopeToggle
          shifted={panelOpen}
          whole={day === ALL_DAYS}
          here={liveDay && day !== ALL_DAYS ? day : 'Today'}
          onHere={() => patch({ day: liveDay || days[0], sel: undefined })}
          onWhole={() => patch({ day: ALL_DAYS, sel: undefined })}
        />
        {/* A demo has no phone to wait for: the sample never shows the GPS
            nudge, which read as broken in the one trip everyone sees first. */}
        {!panelOpen && (data.source !== 'sample' || progressCopy.tone !== 'waiting') && (
          <NowCapsule
            text={progressCopy.text}
            meta={progressCopy.meta}
            tone={progressCopy.tone}
            onClick={() => {
              setFollowing(true)
              if (liveStop) patch({ sel: liveStop.id, day: liveStop.day })
            }}
          />
        )}
        <AssistantButton on={asking} onClick={() => setAsking(value => !value)} />
        <MapControls
          following={following}
          onFollow={toggleFollow}
          onFit={fitAll}
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

      <UploadTray uploads={uploads.uploads} onRetry={uploads.tryAgain} onDismiss={uploads.forget} />

      <TripBar
        items={items}
        days={days}
        day={day}
        liveDay={liveDay}
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
          stops={stops}
          toast={toast}
          theme={mapTheme}
          tint={sun}
        />
      )}

      {waitingEdits > 0 && (
        <div
          className="glass pointer-events-none absolute bottom-[var(--trip-4)]
                        left-4 z-[3] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]
                        font-semibold text-muted">
          <Icon n="clock" s={12} />
          {waitingEdits} change{waitingEdits === 1 ? '' : 's'} waiting for a signal
        </div>
      )}

      {offlineAt != null && (
        <OfflineNote at={offlineAt} className="absolute bottom-[var(--trip-3)] left-4 z-[3]" />
      )}

      {data.source === 'sample' && (
        <div
          className="pointer-events-none absolute bottom-[var(--trip-3)] left-4 z-[3] rounded-full
                        bg-accent-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[.1em]
                        text-accent">
          Sample trip
        </div>
      )}
    </div>
  )
}
