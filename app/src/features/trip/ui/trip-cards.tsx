import { IndoorChrome, isAirportStop } from '../../airport'
import { StopEditor } from '../../itinerary'
import { AttractionCard } from '../../sights'
import DetailCard from './detail-card'
import { EditHint, PlaceHint } from './trip-chrome'
import type useTripPage from '../model/use-trip-page'

interface TripCardsProps {
  page: ReturnType<typeof useTripPage>
  canEdit: boolean
  patch: (changes: Record<string, unknown>) => void
}

/* The floating layer over the map: the stop card, the stop editor, the
   placement and route hints, and the attraction card. The page decides what
   exists; this layer decides how it hovers. */
export default function TripCards({ page, canEdit, patch }: TripCardsProps) {
  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  const {
    draft, selectedItem, panelOpen, here, openViewer, startEditing, setDraft,
    setPlacing, removeDraft, indoor, days, onDraftField, saveDraft, moveStop,
    lookUpDraft, saving, placing, editing, routeDraft, setRouteDraft, saveRoute,
    searchPlaces, places, setPlaces, route, attraction, stops, addAttraction,
    setAttractionCard, showAttractions, attrFilling, attrCount,
  } = page
  return (
    <>
      {!draft && selectedItem && selectedItem.kind !== 'photo' && (
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
        />
      )}

      {indoor.active && <IndoorChrome indoor={indoor} />}

      {draft && (
        <StopEditor
          draft={draft}
          days={days}
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
    </>
  )
}
