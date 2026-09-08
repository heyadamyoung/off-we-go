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
}

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

/** The next thing to send: one at a time, so a phone on a slow line copes. */
export const next = (uploads: Upload[]) => uploads.find(item => item.state === 'waiting') || null

export function begin(uploads: Upload[], key: string): Upload[] {
  return uploads.map(item =>
    item.key === key ? { ...item, state: 'uploading', attempts: (item.attempts || 0) + 1 } : item,
  )
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
    item.key === key ? { ...item, state: 'waiting', error: undefined, attempts: 0 } : item,
  )
}

/** Back to the queue on its own, keeping the count of what has been tried. */
export function requeue(uploads: Upload[], key: string): Upload[] {
  return uploads.map(item =>
    item.key === key ? { ...item, state: 'waiting', error: undefined } : item,
  )
}

export const dismiss = done
