/* Reading what the places API sends.
 *
 * Split out of places-core when that file crossed the review boundary, and it
 * is the right seam anyway: everything on the other side of it is arithmetic
 * over records we already hold — weights, licences, groupings — and everything
 * here is the defensive reading of somebody else's JSON. The two fail
 * differently. A weighting that is wrong shows the wrong place first; a reader
 * that is wrong shows nothing at all, and shows nothing quietly.
 *
 * Which is exactly what happened: see placeFrom.
 *
 * Types only from places-core, so this is not a runtime cycle.
 */

import type { PlaceAbout, PlaceCredit } from './places-about'
import type { Place, PlaceList } from './places-core'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** A list answer, read defensively: the typeahead runs on every keystroke, and
    a payload that is a bare array, or that calls its rows something else, must
    come back empty rather than as an exception inside a React render. */
export function placeListFrom(payload: unknown): PlaceList {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.places)
      ? payload.places
      : []
  const places = rows.filter(
    (row): row is Place =>
      isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string',
  )
  const degraded = isRecord(payload) && payload.degraded === true
  const coverage = isRecord(payload) && isRecord(payload.coverage) ? payload.coverage : null
  return {
    places,
    degraded,
    coverage:
      coverage && typeof coverage.cell === 'string'
        ? { cell: coverage.cell, status: String(coverage.status || '') }
        : null,
  }
}

/** One record, as `/api/places/:id` sends it.
 *
 * That answer is the odd one out. Every other places endpoint replies
 * `{places: [...]}`, which placeListFrom reads directly; this one replies
 * `{place, redirectedFrom}`, because a single record can also say where it
 * went when upstream merged or dropped it — and a wrapper is the honest way
 * to carry a second fact beside the first.
 *
 * Unwrapping it belongs here rather than at the call site, because the call
 * site is where it went wrong: it handed the whole envelope to placeListFrom
 * as though the envelope were a record. The envelope has no `id` and no
 * `name`, so the filter dropped it, so every lookup of a single place
 * returned null — which on screen was a card that knew a pin's name and
 * category and could not say the address or the telephone number of
 * anywhere, ever, while both sat in the payload it had just thrown away.
 */
export function placeFrom(payload: unknown): Place | null {
  const row = isRecord(payload) && 'place' in payload ? payload.place : payload
  const place = placeListFrom({ places: [row] }).places[0] || null
  if (!place) return null
  const about = aboutFrom(isRecord(payload) ? payload.about : null)
  return about ? { ...place, about } : place
}

/** One credit, or null if the server did not send a usable one. */
function creditFrom(value: unknown): PlaceCredit | null {
  if (!isRecord(value)) return null
  const license = typeof value.license === 'string' ? value.license : ''
  const text = typeof value.text === 'string' ? value.text : ''
  /* No licence, no credit, and — since the server only sends a picture it
     has a licence for — no picture either. The client does not invent one. */
  if (!license || !text) return null
  return {
    text,
    license,
    author: typeof value.author === 'string' ? value.author : null,
    licenseUrl: typeof value.licenseUrl === 'string' ? value.licenseUrl : null,
    source: typeof value.source === 'string' ? value.source : null,
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : null,
  }
}

/**
 * The picture and the paragraph, as the card will show them.
 *
 * A picture with no credit is dropped rather than shown bare. The server
 * already refuses to store one it cannot credit, so this only fires if
 * something went wrong between there and here — and the safe failure is a
 * card with no photograph, not somebody's photograph with no name on it.
 */
export function aboutFrom(value: unknown): PlaceAbout | null {
  if (!isRecord(value)) return null
  const said = isRecord(value.description) ? value.description : null
  const text = said && typeof said.text === 'string' ? said.text : ''
  const images = Array.isArray(value.images) ? value.images : []
  return {
    description: text
      ? {
          text,
          source: typeof said?.source === 'string' ? said.source : null,
          sourceUrl: typeof said?.sourceUrl === 'string' ? said.sourceUrl : null,
          attribution: creditFrom(said?.attribution),
        }
      : null,
    images: images
      .filter(isRecord)
      .map(image => ({
        url: typeof image.url === 'string' ? image.url : '',
        thumbUrl: typeof image.thumbUrl === 'string' ? image.thumbUrl : null,
        width: typeof image.width === 'number' ? image.width : null,
        height: typeof image.height === 'number' ? image.height : null,
        attribution: creditFrom(image.attribution),
      }))
      .filter(image => image.url && image.attribution),
    status: typeof value.status === 'string' ? value.status : 'pending',
    waiting: value.waiting !== false,
  }
}
