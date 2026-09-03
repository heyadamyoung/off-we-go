import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { updateTrip } from '../../../backend'
import { useUploadQueue } from '../../photos'
import { appErrorMessage } from '../../../user-messages-core'
import type {
  MapView,
  Stop,
  Toast,
  Trip,
  TripPhoto,
  UploadInput,
} from '../../../shared/model/types'

/* The trip page's two writes, out of the page component so the page stays a
   layout. Saving is optimistic and honest about failure; a photograph that
   lands on the map takes the camera with it. */
export default function useTripMutations({
  trip,
  setTrip,
  tripId,
  toast,
  addPhoto,
  stops,
  setFollowing,
  setMapView,
  viewRef,
}: {
  trip: Trip
  setTrip: Dispatch<SetStateAction<Trip>>
  tripId: string
  toast: Toast
  addPhoto: (input: UploadInput) => Promise<TripPhoto>
  stops: Stop[]
  setFollowing: (value: boolean) => void
  setMapView: (view: MapView) => void
  viewRef: { current: MapView }
}) {
  const saveTrip = useCallback(
    async (fields: Record<string, unknown>) => {
      // Only the fields this save touched, so a second edit made while this
      // one was in flight is not rolled back with it.
      const before = Object.fromEntries(
        Object.keys(fields).map(key => [key, (trip as unknown as Record<string, unknown>)[key]]),
      )
      setTrip(current => ({ ...current, ...fields }))
      try {
        await updateTrip(tripId, fields)
        toast('Trip details saved')
      } catch (caught) {
        setTrip(current => ({ ...current, ...before }))
        toast(appErrorMessage(caught, 'save-trip'), 'error')
      }
    },
    [trip, setTrip, tripId, toast],
  )

  const addPhotoToMap = useCallback(
    async (input: UploadInput) => {
      const saved = await addPhoto(input)
      const stop = stops.find(value => value.id === saved.stopId)
      const lng = stop?.lng ?? saved.lng
      const lat = stop?.lat ?? saved.lat
      if (lng != null && lat != null) {
        setFollowing(false)
        setMapView({
          center: [lng, lat],
          zoom: Math.max(viewRef.current.zoom, 15),
          ms: 520,
          focus: true,
        })
      }
      return saved
    },
    [addPhoto, stops, setFollowing, setMapView, viewRef],
  )

  /* Photographs go up in the background: the sheet hands them over and closes,
     and the tray in the corner says what is still going. */
  const uploads = useUploadQueue({ send: addPhotoToMap, toast })

  return { saveTrip, uploads }
}
