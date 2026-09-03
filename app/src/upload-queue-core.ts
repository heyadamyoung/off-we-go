/* What is still going up, so the screen can say so without standing in the way.

   An upload is the one thing in this app that takes long enough to notice, and
   the sheet used to sit there holding the screen until every file was done.
   The queue lives out here, as plain state moved by plain functions, so the
   indicator can be tested without a network or a camera roll. */

export type UploadState = 'waiting' | 'uploading' | 'failed'

export interface Upload {
  key: string
  name: string
  preview?: string
  state: UploadState
  error?: string
}

export const queued = (uploads: Upload[]) => uploads.filter(item => item.state !== 'failed').length
export const failed = (uploads: Upload[]) => uploads.filter(item => item.state === 'failed')

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
  return uploads.map(item => (item.key === key ? { ...item, state: 'uploading' } : item))
}

/** Done is gone: the photograph is on the map, which says more than a tick. */
export function done(uploads: Upload[], key: string): Upload[] {
  return uploads.filter(item => item.key !== key)
}

export function fail(uploads: Upload[], key: string, error: string): Upload[] {
  return uploads.map(item => (item.key === key ? { ...item, state: 'failed', error } : item))
}

/** A failure the reader has asked to try again. */
export function retry(uploads: Upload[], key: string): Upload[] {
  return uploads.map(item =>
    item.key === key ? { ...item, state: 'waiting', error: undefined } : item,
  )
}

export const dismiss = done
