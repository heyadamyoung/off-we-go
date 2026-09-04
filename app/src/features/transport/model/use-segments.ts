import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSegment,
  deleteSegment,
  deleteSegmentDocument,
  loadSegments,
  updateSegmentDocument,
  subscribeToTrip,
  updateSegment,
  uploadSegmentDocument,
} from '../../../backend'
import type { Segment } from '../../../segments-core'
import { track } from '../../../shared/lib/telemetry'
import { appErrorMessage } from '../../../user-messages-core'
import type { Id } from '../../../shared/model/types'
import { scheduleSegmentNotifications } from './notify'

/* The trip's travel legs, kept in step with the server: fetched on mount,
   refetched when the trip stream announces a segments change from anywhere —
   another phone, the assistant amending a gate off an airline email. */
export default function useSegments(tripId: Id, toast: (m: string, t?: 'error') => void) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const warned = useRef(false)

  const refetch = useCallback(() => {
    loadSegments(tripId)
      .then(found => {
        setSegments(found)
        setLoadFailed(false)
        warned.current = false
        // The phone in a pocket is the real UI on travel day.
        scheduleSegmentNotifications(found)
      })
      .catch(error => {
        /* An empty Travel tab must never be a silent lie: the failure is
           said once (stream retries would nag), and the panel is told so
           its empty state reads "could not load", not "no legs". */
        setLoadFailed(true)
        if (!warned.current) {
          warned.current = true
          toast(appErrorMessage(error, 'load-segments'), 'error')
        }
      })
  }, [tripId, toast])

  useEffect(() => {
    refetch()
    return subscribeToTrip(tripId, refetch)
  }, [tripId, refetch])

  /* Every mutation speaks: the mapped, human copy on failure — never the
     server's raw line — and a word of confirmation where the result is not
     already on screen by itself. */
  const saveSegment = useCallback(
    async (draft: Partial<Segment> & { id?: string }) => {
      try {
        if (draft.id) await updateSegment(tripId, draft.id, draft)
        else {
          await createSegment(tripId, draft)
          track('add segment', { mode: String(draft.mode || '') })
        }
        refetch()
        toast(draft.id ? 'Leg saved' : 'Leg added')
        return true
      } catch (error) {
        toast(appErrorMessage(error, 'save-leg'), 'error')
        return false
      }
    },
    [tripId, refetch, toast],
  )

  const removeSegment = useCallback(
    async (segmentId: string) => {
      try {
        await deleteSegment(tripId, segmentId)
        refetch()
        toast('Leg removed')
      } catch (error) {
        toast(appErrorMessage(error, 'delete-leg'), 'error')
      }
    },
    [tripId, refetch, toast],
  )

  const attachDocument = useCallback(
    async (segmentId: string, file: File, fields: { name?: string; personId?: string | null }) => {
      try {
        await uploadSegmentDocument(tripId, segmentId, file, fields)
        track('attach document', { kind: file.type === 'application/pdf' ? 'pdf' : 'image' })
        refetch()
        toast('Document added')
      } catch (error) {
        toast(appErrorMessage(error, 'attach-document'), 'error')
      }
    },
    [tripId, refetch, toast],
  )

  const removeDocument = useCallback(
    async (documentId: string) => {
      try {
        await deleteSegmentDocument(tripId, documentId)
        refetch()
        toast('Document removed')
      } catch (error) {
        toast(appErrorMessage(error, 'remove-document'), 'error')
      }
    },
    [tripId, refetch, toast],
  )

  const editDocument = useCallback(
    async (documentId: string, changes: { name?: string; note?: string }) => {
      try {
        await updateSegmentDocument(tripId, documentId, changes)
        refetch()
      } catch (error) {
        toast(appErrorMessage(error, 'update-document'), 'error')
      }
    },
    [tripId, refetch, toast],
  )

  return {
    segments,
    loadFailed,
    saveSegment,
    removeSegment,
    attachDocument,
    editDocument,
    removeDocument,
  }
}
