/* Giving a stop a picture out of the trip's own photographs.

   A stop could already wear a picture, but only one it was handed: the
   Wikipedia lookup finds a stock photograph of the place and fills the field
   in on load. That is a good start and a poor finish — the trip is full of
   pictures of these places, taken by the people who went, and none of them
   could be used. The only thing the editor could do with the field was empty
   it.

   Pure, because what may stand for a stop is a rule and not a screen: which
   pictures can be offered, which order they are worth offering in, and what
   gets written when somebody picks one. */

import type { Id, TripPhoto } from './shared/model/types'

type Still = Pick<TripPhoto, 'kind' | 'src' | 'posterSrc'>

/**
 * The still a photograph or a film can offer, or null when it has none.
 *
 * A film is a perfectly good answer to what a place looks like — its poster is
 * a frame of it, taken there, by somebody on the trip. One still being made
 * has no poster yet, and offering it would give the stop a picture that is not
 * anywhere.
 */
export const stillOf = (photo?: Still | null): string | null =>
  (photo?.kind === 'video' ? photo?.posterSrc : photo?.src) || null

/* A stop's picture is stored on the server and drawn for everyone on the trip.
   A blob: or data: URL is this tab and this tab only — it is how a photograph
   still going up is drawn before it lands — so storing one gives the stop a
   picture that is broken for everybody else, and for this person the moment
   they reload. */
const shareable = (src: string) => !src.startsWith('blob:') && !src.startsWith('data:')

export interface PictureChoice {
  id: Id
  src: string
  /** already filed at this stop, so far more likely to be a picture of it */
  here: boolean
  caption: string
}

/**
 * The trip's pictures, the ones worth offering first.
 *
 * Those already filed at this stop lead, newest first, then everything else in
 * the same order. Somebody put the first group there, and a picture of the
 * place is the whole point of the field — on a trip with two thousand
 * photographs, scrolling to find one of this castle is not a feature.
 */
export function pictureChoices(photos?: TripPhoto[] | null, stopId?: Id | null): PictureChoice[] {
  const choices: PictureChoice[] = []
  for (const photo of photos || []) {
    const src = stillOf(photo)
    if (!src || !shareable(src)) continue
    choices.push({
      id: photo.id,
      src,
      here: !!stopId && photo.stopId === stopId,
      caption: photo.caption || '',
    })
  }
  const seq = new Map((photos || []).map(photo => [photo.id, photo.seq ?? 0]))
  return choices.sort((a, b) => {
    if (a.here !== b.here) return a.here ? -1 : 1
    const order = (seq.get(b.id) as number) - (seq.get(a.id) as number)
    // Ties keep a stable order rather than shuffling between renders.
    return order || String(a.id).localeCompare(String(b.id))
  })
}

/**
 * What to write into the draft when somebody picks one, or null if they
 * somehow picked something that cannot be stored.
 *
 * `sourceUrl` goes with it. The stop may be wearing a Wikipedia picture, and
 * that link is drawn as a caption beside it — left behind, somebody's own
 * photograph ends up credited to somebody else.
 */
export function chosenPicture(src?: string | null): { src: string; sourceUrl: null } | null {
  const still = src || ''
  return still && shareable(still) ? { src: still, sourceUrl: null } : null
}
