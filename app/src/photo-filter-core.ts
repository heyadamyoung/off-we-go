/* Which of a trip's photographs are on the screen.

   The gallery holds everything anybody added, and two weeks away is a
   thousand things of two different kinds. A film is not a photograph you
   happen to scroll past — it is the forty seconds of the funicular, or the
   one where she finally let go of the handlebars, and it is looked for on
   purpose. Scrolling a wall of stills to find it is the whole problem, and it
   is the same problem the faces beside this already solve for people.

   So the band above the grid can narrow to one kind as well as to one person,
   and the two compose: Maya's films is a reasonable thing to ask for.

   Offered only when it would divide something. A trip with no films has no
   use for a Videos button whose only outcome is an empty screen, and the row
   above the grid has exactly one row to spend on a phone.

   Pure, and it stays that way. What is shown is a rule about rows; nothing
   here knows there is a grid underneath, which is why the rule can be checked
   without one. */

export type MediaKind = 'all' | 'photo' | 'video'

export interface FilterablePhoto {
  by?: string | null
  /* Either `'video'` or something that is not. A row written before the
     column existed, or by a client that never knew about it, carries nothing
     here and is a still — which is why every question below is asked as "is
     this a film" and never as "is this a photograph". */
  kind?: string | null
}

/** Whether this one moves. */
export const isVideo = (photo?: FilterablePhoto | null): boolean => photo?.kind === 'video'

export interface KindTally {
  photo: number
  video: number
}

/** How much of each kind there is, counting anything that is not a film as one. */
export function tallyKinds(photos?: readonly FilterablePhoto[] | null): KindTally {
  const tally: KindTally = { photo: 0, video: 0 }
  for (const photo of photos || []) {
    if (isVideo(photo)) tally.video += 1
    else tally.photo += 1
  }
  return tally
}

/**
 * Whether narrowing by kind is worth offering at all.
 *
 * Both kinds have to be here for the control to divide anything, which is the
 * same rule the faces are offered under: a trip everybody but one person
 * photographed is not a trip with a person filter, and a trip of nothing but
 * stills is not a trip with a Videos button.
 */
export const worthFiltering = (tally: KindTally): boolean => tally.photo > 0 && tally.video > 0

/**
 * The kind actually in force, which is not always the one chosen.
 *
 * The control is drawn only while it divides something, so deleting the last
 * film takes it off the screen — and a choice that outlived its control would
 * leave the gallery empty with nothing on it to undo that.
 */
export const kindInForce = (tally: KindTally, chosen: MediaKind): MediaKind =>
  worthFiltering(tally) ? chosen : 'all'

export interface Narrowing {
  /** One person's, or everybody's when absent. */
  by?: string | null
  kind?: MediaKind
}

/**
 * The photographs a narrowing leaves, in the order they arrived.
 *
 * Order is left alone on purpose: grouping and sorting happen downstream, and
 * two things deciding the reading order is how a gallery and the viewer it
 * opens end up disagreeing about what comes next.
 *
 * Under no narrowing this is the very same array, not a copy of it. The grid
 * below re-groups, re-measures and re-windows whenever it is handed a
 * different array, and an unfiltered gallery must not pay that on every
 * render.
 */
export function narrowPhotos<P extends FilterablePhoto>(
  photos: P[],
  { by, kind = 'all' }: Narrowing = {},
): P[] {
  if (!by && kind === 'all') return photos
  const wantsFilm = kind === 'video'
  return photos.filter(
    photo => (!by || photo.by === by) && (kind === 'all' || isVideo(photo) === wantsFilm),
  )
}

/**
 * What an emptied gallery says about why it is empty.
 *
 * Naming the narrowing rather than the trip: "nothing here" about a screen
 * somebody has just filtered reads as a trip that lost its photographs.
 */
export function nothingShown({ by, kind = 'all' }: Narrowing = {}): string {
  const what = kind === 'video' ? 'videos' : kind === 'photo' ? 'photos' : null
  if (by) return what ? `No ${what} from ${by} on this trip.` : `Nothing from ${by} on this trip.`
  return what ? `No ${what} on this trip yet.` : 'Nothing on this trip yet.'
}
