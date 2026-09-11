/* What is still going up, so the screen can say so without standing in the way.

   An upload is the one thing in this app that takes long enough to notice, and
   the sheet used to sit there holding the screen until every file was done.
   The queue lives out here, as plain state moved by plain functions, so the
   indicator can be tested without a network or a camera roll. */

/* `retrying` is its own state and not a kind of failure: the tray must not
   offer a Retry button for something already coming round again, nor count it
   among the ones that did not go up. */
export type UploadState = 'waiting' | 'uploading' | 'retrying' | 'failed'

export interface Upload {
  key: string
  name: string
  preview?: string
  /** What is going up, so the tray can say "3 videos" and draw the right
      stand-in for one whose opening frame would not decode. */
  kind?: 'photo' | 'video'
  state: UploadState
  error?: string
  /** How many times it has been sent, so a flaky line gets a few goes on its
      own before a person is asked to care. */
  attempts?: number
  /** Bytes handed to the socket so far, and how many there are in total.
      `total` is null when the browser will not say, which draws as a bar
      that moves without claiming a number rather than as nought per cent. */
  sent?: number
  total?: number | null
}

/* How many go at once.

   One at a time was honest and slow: on a hotel connection a phone spends
   most of each upload waiting for round trips rather than filling the pipe,
   and photograph twenty sits untouched behind nineteen others with nothing
   said about it. All at once is worse — twenty parallel uploads on one bar of
   signal is how every one of them times out together.

   A few, then. Three is enough to keep the line busy and few enough that each
   one still finishes in a sensible order, so the gallery fills in roughly the
   order somebody chose. Films are the exception: one at a time, because a
   single 200MB video is already the whole uplink and putting two beside it
   just makes all three slower and likelier to drop. */
export const AT_ONCE = 3
export const FILMS_AT_ONCE = 1

/* A refusal worth repeating unprompted. A 400 means the server looked at this
   upload and said no — sending it again changes nothing and only burns a
   traveller's data. A dropped connection, a gateway hiccup or a rate limit is
   the line, not the file, and the line is usually better a moment later.
   Nothing is a likelier place to lose a holiday video than one bar of signal
   on a hillside, so those are retried without troubling anybody. */
export function worthRetrying(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  if (status == null) return true // no response at all: the network, not us
  return status === 408 || status === 429 || status >= 500
}

/** How long to wait before try number `attempt` (1-based): 2s, 6s, 18s. */
export const retryDelay = (attempt: number) =>
  Math.min(30_000, 2_000 * 3 ** Math.max(0, attempt - 1))

export const queued = (uploads: Upload[]) => uploads.filter(item => item.state !== 'failed').length
export const failed = (uploads: Upload[]) => uploads.filter(item => item.state === 'failed')

/** What to call what is going up: films, pictures, or a mix of the two. */
export function countable(uploads: Upload[]): string {
  const going = uploads.filter(item => item.state !== 'failed')
  const videos = going.filter(item => item.kind === 'video').length
  const one = going.length === 1
  if (videos && videos === going.length) return one ? 'video' : 'videos'
  if (videos) return 'items'
  return one ? 'photo' : 'photos'
}

/** Adds files to the back of the queue, keeping whatever is already going. */
export function enqueue(uploads: Upload[], additions: Array<Omit<Upload, 'state'>>): Upload[] {
  const known = new Set(uploads.map(item => item.key))
  return [
    ...uploads,
    ...additions
      .filter(item => item.key && !known.has(item.key))
      .map(item => ({ ...item, state: 'waiting' as UploadState })),
  ]
}

const inFlight = (uploads: Upload[]) => uploads.filter(item => item.state === 'uploading')

/**
 * What may start now: whatever is waiting, in the order it was chosen, up to
 * the limits above and counting what is already going.
 *
 * Returns a list rather than one item so the decision is made once, from one
 * view of the queue, instead of by a caller looping and re-reading state it
 * has already changed.
 */
export function startable(
  uploads: Upload[],
  { atOnce = AT_ONCE, filmsAtOnce = FILMS_AT_ONCE }: { atOnce?: number; filmsAtOnce?: number } = {},
): Upload[] {
  const going = inFlight(uploads)
  let room = atOnce - going.length
  let filmRoom = filmsAtOnce - going.filter(item => item.kind === 'video').length
  if (room <= 0) return []
  const starting: Upload[] = []
  for (const item of uploads) {
    if (room <= 0) break
    if (item.state !== 'waiting') continue
    if (item.kind === 'video') {
      if (filmRoom <= 0) continue
      filmRoom -= 1
    }
    starting.push(item)
    room -= 1
  }
  return starting
}

/**
 * How far along the whole lot is, as one number a bar can draw.
 *
 * By bytes where every item knows its size, because forty photographs and one
 * film are not forty-one equal things and a bar that treats them as such sits
 * still through the film. Where a size is missing the item counts as one whole
 * unit of work, which is the honest fallback rather than nothing.
 *
 * `done` counts what has left the queue, so the caption can say "8 of 20"
 * across the whole batch rather than resetting as each one finishes.
 */
/* How much of an item's own bytes count while it is still in flight.

   Sent is not stored. The last byte reaches the socket and the server has
   still to decode the picture, resize it, write it and answer — which on a
   real connection is a second and on a tired one is ten. A bar that reaches
   the end and then sits there is the complaint this was all written to fix,
   so an upload in flight can approach its own weight without arriving at it.
   The last of it is paid when the response does. */
const IN_FLIGHT_CEILING = 0.95

export function overall(
  uploads: Upload[],
  finished = 0,
): { fraction: number; done: number; total: number; failed: number; working: number } {
  const live = uploads.filter(item => item.state !== 'failed')
  const total = finished + live.length
  /* A byte weight per item: its real size where it has said, and otherwise
     the size of the ones that have.

     A fixed guess was wrong in a way that showed: a notional megabyte against
     four-megabyte photographs made the denominator shrink every time an
     upload started and grow again the moment its real size arrived — so the
     bar ran forwards and then visibly backwards, several times a batch.
     Photographs from one camera roll are much of a size, so the ones already
     measured are the best estimate of the ones not yet. */
  const sized = live.filter(item => item.total && item.total > 0)
  const typical = sized.length
    ? sized.reduce((sum, item) => sum + (item.total as number), 0) / sized.length
    : 1_000_000
  const weight = (item: Upload) => (item.total && item.total > 0 ? item.total : typical)
  const outstanding = live.reduce((sum, item) => sum + weight(item), 0)
  const carried = live.reduce(
    (sum, item) => sum + Math.min(item.sent ?? 0, weight(item) * IN_FLIGHT_CEILING),
    0,
  )
  /* Everything already gone counts as fully done. Its true size is no longer
     known, so it is worth the average of what is left — which keeps the bar
     moving forward rather than jumping when a big one lands. */
  const each = live.length ? outstanding / live.length : 1_000_000
  const behind = finished * each
  const whole = behind + outstanding
  return {
    fraction: whole > 0 ? Math.min(1, (behind + carried) / whole) : 0,
    done: finished,
    total,
    failed: failed(uploads).length,
    /* Which one the caption is about. With three in flight, "1 of 6" under-
       reports what is happening by two thirds and reads as stuck beside a bar
       that is plainly half full; the highest one started is the number every
       phone shows. Never past the total, and never nought while there is
       still something to do. */
    working: Math.min(total, Math.max(finished + inFlight(uploads).length, total ? 1 : 0)),
  }
}

/** What the bar has to say when the bytes are not knowable. */
export const measurable = (uploads: Upload[]) =>
  uploads.some(item => item.state === 'uploading' && item.total != null)

/**
 * What to draw, given what was drawn a moment ago.
 *
 * `overall` is arithmetic over what is known right now, and what is known
 * changes shape as sizes arrive and uploads leave the queue — so it can fall
 * slightly even while the batch is plainly getting on with it. A progress bar
 * that goes backwards is the one thing a progress bar must never do: it reads
 * as work being undone.
 *
 * So the drawn value only ever climbs, and resets when the batch does.
 */
export const furthest = (drawn: number, measured: number, going: boolean) =>
  going ? Math.max(drawn, measured) : 0

export function begin(uploads: Upload[], key: string): Upload[] {
  return uploads.map(item =>
    item.key === key
      ? // Bytes reset with the attempt: a retry that kept the old count would
        // draw a bar starting at ninety per cent and going nowhere.
        { ...item, state: 'uploading', attempts: (item.attempts || 0) + 1, sent: 0, total: null }
      : item,
  )
}

/** Bytes reported by the transport, on their way out. */
export function progressed(
  uploads: Upload[],
  key: string,
  sent: number,
  total: number | null,
): Upload[] {
  return uploads.map(item => (item.key === key ? { ...item, sent, total } : item))
}

/** Done is gone: the photograph is on the map, which says more than a tick. */
export function done(uploads: Upload[], key: string): Upload[] {
  return uploads.filter(item => item.key !== key)
}

export function fail(uploads: Upload[], key: string, error: string): Upload[] {
  return uploads.map(item => (item.key === key ? { ...item, state: 'failed', error } : item))
}

/** Failed, but going round again on its own; the note says why the wait. */
export function hold(uploads: Upload[], key: string, note: string): Upload[] {
  return uploads.map(item =>
    item.key === key ? { ...item, state: 'retrying', error: note } : item,
  )
}

/** A failure the reader has asked to try again — their patience resets ours. */
export function retry(uploads: Upload[], key: string): Upload[] {
  return uploads.map(item =>
    item.key === key
      ? { ...item, state: 'waiting', error: undefined, attempts: 0, sent: 0, total: null }
      : item,
  )
}

/** Every failure at once, which is what a person means by "try again". */
export const retryAll = (uploads: Upload[]): Upload[] =>
  failed(uploads).reduce((list, item) => retry(list, item.key), uploads)

/** Back to the queue on its own, keeping the count of what has been tried. */
export function requeue(uploads: Upload[], key: string): Upload[] {
  return uploads.map(item =>
    item.key === key ? { ...item, state: 'waiting', error: undefined } : item,
  )
}

export const dismiss = done
