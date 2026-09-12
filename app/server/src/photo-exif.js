/* What a photograph says about itself.
 *
 * A picture taken on a phone carries where and when it was taken inside its
 * own EXIF block. Until now the server took the client's word for both, which
 * made the answer a property of whichever picker happened to send the row —
 * and on iOS that picker re-encodes the image from a UIImage and can only
 * recover the metadata through PHAsset, which a photo library shared as
 * "Selected Photos" will not answer for. The result was silent: no position,
 * no capture time, and the phone's current location standing in for where the
 * photograph was taken, recorded as though it were a fact.
 *
 * So this reads the file. It is the same argument as stop-placement.js — the
 * one machine every upload passes through is the only place an answer can be
 * made to hold for every client, including the ones nobody has written yet.
 *
 * It runs before the image is resized, because resizing is what destroys the
 * block: the display copy sharp writes has no EXIF at all.
 */

import exifr from 'exifr'

/* Only the two blocks worth reading. Parsing the whole of a modern phone's
   EXIF — maker notes, thumbnails, colour profiles — is work done to throw
   away, on every upload. */
const WANTED = { gps: true, exif: true, ifd0: false, interop: false, translateValues: true }

const usable = value => typeof value === 'number' && Number.isFinite(value)

/**
 * Where and when a photograph was taken, as far as it will say.
 *
 * Returns null rather than throwing on anything unreadable. A metadata block
 * we cannot parse must never cost somebody their photograph, so every failure
 * here is the same as the picture having said nothing.
 *
 * @param {Buffer|Uint8Array|null|undefined} bytes the image as uploaded
 * @returns {Promise<{lng?: number, lat?: number, takenAt?: string} | null>}
 */
export async function exifFromImage(bytes) {
  if (!bytes?.length) return null
  let parsed = null
  try {
    parsed = await exifr.parse(bytes, WANTED)
  } catch {
    /* No readable block, or not an image at all. */
    return null
  }
  if (!parsed) return null

  const found = {}
  /* exifr has already applied the N/S/E/W references, so these are signed. */
  const { latitude, longitude } = parsed
  if (
    usable(latitude) &&
    usable(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    /* Null Island is what a camera with a GPS chip and no fix writes. It is a
       real place in the Gulf of Guinea and nobody's holiday photograph. */
    !(latitude === 0 && longitude === 0)
  ) {
    found.lat = latitude
    found.lng = longitude
  }

  const takenAt = firstDate(parsed.DateTimeOriginal, parsed.CreateDate, parsed.ModifyDate)
  if (takenAt) found.takenAt = takenAt

  return Object.keys(found).length ? found : null
}

/* The first of these that is a real instant. exifr hands back Date objects,
   but a corrupt block can leave a string or an Invalid Date behind. */
function firstDate(...values) {
  for (const value of values) {
    if (!value) continue
    const at = value instanceof Date ? value : new Date(value)
    if (!Number.isNaN(at.getTime())) return at.toISOString()
  }
  return null
}
