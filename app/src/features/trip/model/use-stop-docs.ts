import { useMemo } from 'react'
import { deleteStopDocument, updateStopDocument, uploadStopDocument } from '../../../backend'
import { track } from '../../../shared/lib/telemetry'
import type { Id } from '../../../shared/model/types'

export interface StopDocTools {
  attach: (stopId: string, file: File) => void
  edit: (documentId: string, changes: { name?: string; note?: string }) => void
  remove: (documentId: string) => void
}

/* A stop's paperwork, managed: upload, rename, note, delete — each lands on
   the server and the trip reloads, so the card under the sheet tells the
   truth straight away. */
export default function useStopDocs(
  tripId: Id,
  reload: () => void,
  toast: (message: string, tone?: 'success' | 'error') => void,
): StopDocTools {
  return useMemo(
    () => ({
      attach: (stopId, file) =>
        uploadStopDocument(tripId, stopId, file)
          .then(() => {
            track('attach document', { home: 'stop' })
            reload()
          })
          .catch(error => toast(error.message || 'The document could not be attached', 'error')),
      edit: (documentId, changes) =>
        updateStopDocument(tripId, documentId, changes)
          .then(reload)
          .catch(error => toast(error.message || 'The document could not be updated', 'error')),
      remove: documentId =>
        deleteStopDocument(tripId, documentId)
          .then(reload)
          .catch(error => toast(error.message || 'The document could not be removed', 'error')),
    }),
    [tripId, reload, toast],
  )
}
