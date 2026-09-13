/* Where a photograph's pin came from, said out loud.

   The app has known this since the server became the authority on it: the
   picture's own GPS block, the trip's trail around the time it was taken, a
   person dropping it somewhere by hand, or — last and least — wherever the
   phone happened to be at the moment it was uploaded, which on a trip is a
   different place on a different day.

   It has never once shown it. So a picture sitting at the airport instead of
   the castle looked exactly like a bug, and the only way to find out which of
   those four answers it actually was, was to read the source.

   Two of them need no explanation: a picture that knows where it was taken is
   already right, and a place somebody chose by hand is right by definition.
   The other two are standing in for something missing, and the useful thing to
   say is what was missing — because the two ways it can be missing are
   different problems and only one of them is anybody's fault.

   A file that kept its capture time but not its coordinates had a readable
   block with the place taken out of it. That is what Android does to a picture
   on the way out of the gallery: the location lives in the system's own media
   database, which is where the gallery app reads it from, and the bytes handed
   to anything else have the GPS tags removed. The picture really does have
   coordinates and this app really cannot see them.

   A file with no capture time either had no block at all — a screenshot, a
   picture forwarded through a chat app, a scan. Nothing was taken; there was
   never anything there.

   Pure, and it stays that way: this is a sentence about a row. */

export type LocationSource = 'exif' | 'trail' | 'live' | 'manual' | 'approximate'

export interface PlacedPhoto {
  lng?: number | null
  lat?: number | null
  locationSource?: LocationSource | null
  /* When it was taken, read off the file — so its presence says there was a
     readable block, and its absence says there was not. The server sends it
     as `when`; `takenAt` is what an upload on its way there calls it. */
  when?: string | null
  takenAt?: string | null
}

export interface Provenance {
  label: string
  /** Whether this is the picture's own place or something standing in for it. */
  exact: boolean
  /** What was missing, when something was. Empty when nothing is being excused. */
  detail: string
}

const usable = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/* Why a stand-in was needed. The distinction is the whole point: one of these
   is a platform removing something that is there, and the other is a file that
   never had it. */
const missing = (photo: PlacedPhoto): string =>
  photo.when || photo.takenAt
    ? 'This file kept its time but not its place. Some phones strip the ' +
      'coordinates out on the way from the gallery to an app, even though the ' +
      'gallery itself still shows them.'
    : 'This file arrived with no camera details at all.'

/**
 * Where this photograph's point came from, or null if it has not got one.
 *
 * Null rather than a line about a missing pin: an unplaced photograph is
 * already drawn as unplaced everywhere it appears, and a sentence explaining
 * the provenance of a position that does not exist is furniture.
 */
export function placeProvenance(photo?: PlacedPhoto | null): Provenance | null {
  if (!photo || !usable(photo.lng) || !usable(photo.lat)) return null
  switch (photo.locationSource) {
    case 'exif':
      return { label: 'The picture’s own GPS', exact: true, detail: '' }
    case 'manual':
      return { label: 'Where you put it', exact: true, detail: '' }
    case 'trail':
      return { label: 'Where the trip was at the time', exact: false, detail: missing(photo) }
    case 'live':
      return { label: 'Where this was uploaded', exact: false, detail: missing(photo) }
    case 'approximate':
      return { label: 'Roughly where this was uploaded', exact: false, detail: missing(photo) }
    default:
      /* A row from before the column existed. Saying nothing about where the
         point came from beats inventing a provenance for it. */
      return { label: 'Placed on the map', exact: false, detail: '' }
  }
}
