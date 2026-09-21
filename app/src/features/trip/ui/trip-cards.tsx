import { IndoorChrome, isAirportStop } from '../../airport'
import { StopEditor } from '../../itinerary'
import { SegmentEditor } from '../../transport'
import { AttractionCard } from '../../sights'
import DetailCard from './detail-card'
import PaperView from './paper-view'
import { EditHint, PlaceHint } from './trip-chrome'
import type useTripPage from '../model/use-trip-page'

import type usePapers from '../model/use-papers'
import type { RouteToStop } from '../model/use-route-to-stop'
import type { StopDocTools } from '../model/use-stop-docs'

interface TripCardsProps {
  page: ReturnType<typeof useTripPage>
  canEdit: boolean
  patch: (changes: Record<string, unknown>) => void
  stopDocs: StopDocTools
  /** the paper on screen and the doors to it — see use-papers */
  papers: ReturnType<typeof usePapers>
  /** distance and both gaits' minutes from the person to the open stop */
  stats: RouteToStop | null
}

/* The floating layer over the map: the stop card, the stop editor, the editor
   for a leg of the journey, the placement and route hints, and the attraction
   card. The page decides what exists; this layer decides how it hovers. */
export default function TripCards({
  page,
  canEdit,
  patch,
  stopDocs,
  papers,
  stats,
}: TripCardsProps) {
  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  const {
    draft, selectedItem, panelOpen, here, openViewer, startEditing, setDraft,
    setPlacing, removeDraft, indoor, trip, onDraftField, saveDraft, moveStop,
    lookUpDraft, saving, placing, editing, routeDraft, setRouteDraft, saveRoute,
    searchPlaces, places, setPlaces, route, attraction, stops, addAttraction,
    setAttractionCard, photos,
    transport, segmentEditing, setSegmentEditing, family,
  } = page
  return (
    <>
      {/* A leg of the journey, edited where every other editor on this screen
          lives. It sat on the page beside the panel it is opened from, which
          made the page the only thing that knew a flight has an editor. */}
      {segmentEditing !== null && (
        <SegmentEditor
          segment={transport.segments.find(leg => leg.id === segmentEditing) || null}
          people={family}
          startsOn={trip.startsOn}
          endsOn={trip.endsOn}
          onSave={transport.saveSegment}
          onDelete={transport.removeSegment}
          onClose={() => setSegmentEditing(null)}
        />
      )}
      {/* One card at a time: stacked over the stop card, the attraction's X
          sat exactly where the stop card's X would be next — one perceived
          close became two real ones, and "the walking line vanished". The
          stop card waits underneath and returns, line intact. */}
      {!draft && !attraction && selectedItem && selectedItem.kind !== 'photo' && (
        <DetailCard
          item={selectedItem}
          shifted={panelOpen}
          canEdit={canEdit}
          photoCount={here.length}
          onClose={() => patch({ sel: undefined })}
          onOpenPhotos={() => openViewer(here, 0)}
          onAddPhotos={() => patch({ sheet: 'add' })}
          onEdit={() => {
            startEditing(true)
            setDraft(selectedItem.stop || null)
          }}
          onMove={() => setPlacing({ move: selectedItem.id })}
          // Named outright: setDraft has not landed yet when removeDraft runs.
          onDelete={() => removeDraft(selectedItem.stop || null)}
          onIndoor={
            selectedItem.stop && isAirportStop(selectedItem.stop)
              ? () => indoor.open(selectedItem.stop!)
              : undefined
          }
          docs={stopDocs}
          onOpenPaper={papers.open}
          stats={stats}
        />
      )}

      {/* The terminal's floor picker and the walk belong to the map; with a
          panel open they were still floating over it. */}
      {(indoor.active || !!indoor.walk.stage) && !panelOpen && <IndoorChrome indoor={indoor} />}

      {draft && (
        <StopEditor
          draft={draft}
          photos={photos}
          tripId={trip.id}
          startsOn={trip.startsOn}
          endsOn={trip.endsOn}
          onField={onDraftField}
          onSave={saveDraft}
          onDelete={removeDraft}
          onMove={moveStop}
          onLookUp={lookUpDraft}
          onClose={() => setDraft(null)}
          busy={saving}
        />
      )}

      {placing && (
        <PlaceHint
          onCancel={() => setPlacing(null)}
          what={
            placing.move ? 'Click the map to move this stop' : 'Click the map where the stop is'
          }
        />
      )}

      {editing && !draft && (
        <EditHint
          routeDraft={routeDraft}
          setRouteDraft={setRouteDraft}
          saveRoute={saveRoute}
          searchPlaces={searchPlaces}
          places={places}
          setPlaces={setPlaces}
          route={route}
        />
      )}

      {attraction && (
        <AttractionCard
          poi={attraction}
          canEdit={canEdit}
          inTrip={stops.some(
            stop => (stop.name || '').toLowerCase() === (attraction.n || '').toLowerCase(),
          )}
          onAdd={addAttraction}
          onClose={() => setAttractionCard(null)}
        />
      )}

      {/* There was a capsule here that said "still loading places here".
          It is gone, and the words are not to come back.
       *
       * It was honest when the places layer was a live walk of Wikipedia from
       * this device: filling was a thing the phone was doing, it took a
       * minute, and a counter was the difference between waiting and broken.
       * None of that is true now. The pins come from tiles built from our own
       * database, a square is drawn the moment it is asked for, and what the
       * capsule actually reported was `degraded` — which means "the sweep has
       * not reached this one-degree cell of the planet yet", a fact about a
       * backfill running on a box in another country. It hung over a map that
       * was already drawing pins, with a count that is structurally zero on a
       * tiled map, and it hung there for days at a time.
       *
       * A map does not apologise for the parts of the world nobody has
       * finished cataloguing. It draws what it has. `degraded` still travels
       * on the answer, because the server needs it to decide that a
       * half-empty tile must not be cached for a day — see TILE_UNSETTLED in
       * places/routes.js — but it is not something to put on the screen. */}

      {/* The paper itself, above every other thing that floats here. At a desk
          with a queue behind you the document IS the interface, so nothing on
          this screen is allowed over it. Keyed, so a second paper is a second
          screen: the cache lookup and whether the picture loaded are both per
          document. */}
      {papers.paper && (
        <PaperView
          key={papers.paper.id}
          paper={papers.paper}
          editing={papers.editing}
          onClose={papers.close}
        />
      )}
    </>
  )
}
