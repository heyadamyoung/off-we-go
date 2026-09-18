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
    setAttractionCard, showAttractions, attrFilling, attrCount, photos,
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

      {/* The terminal's floor picker and walking line belong to the map; with
          a panel open they were still floating over it. */}
      {indoor.active && !panelOpen && <IndoorChrome indoor={indoor} />}

      {draft && (
        <StopEditor
          draft={draft}
          photos={photos}
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

      {showAttractions && attrFilling > 0 && (
        <div
          className="glass absolute left-1/2 top-20 z-[6] -translate-x-1/2 rounded-full px-3.5 py-2
                        text-xs text-muted">
          Finding attractions… {attrCount}
        </div>
      )}

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
