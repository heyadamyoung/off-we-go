import { useCallback, useEffect, useState } from 'react'
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
import type { Id } from '../../../shared/model/types'
import { scheduleSegmentNotifications } from './notify'

/* The trip's travel legs, kept in step with the server: fetched on mount,
   refetched when the trip stream announces a segments change from anywhere —
   another phone, the assistant amending a gate off an airline email. */
export default function useSegments(tripId: Id, toast: (m: string, t?: 'error') => void) {
  const [segments, setSegments] = useState<Segment[]>([])

  const refetch = useCallback(() => {
    loadSegments(tripId)
      .then(found => {
        setSegments(found)
        // The phone in a pocket is the real UI on travel day.
        scheduleSegmentNotifications(found)
      })
      .catch(() => {})
  }, [tripId])

  useEffect(() => {
    refetch()
    return subscribeToTrip(tripId, refetch)
  }, [tripId, refetch])

  const saveSegment = useCallback(
    async (draft: Partial<Segment> & { id?: string }) => {
      try {
        if (draft.id) await updateSegment(tripId, draft.id, draft)
        else {
          await createSegment(tripId, draft)
          track('add segment', { mode: String(draft.mode || '') })
        }
        refetch()
        return true
      } catch (error) {
        toast((error as Error).message || 'The leg could not be saved', 'error')
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
      } catch (error) {
        toast((error as Error).message || 'The leg could not be removed', 'error')
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
      } catch (error) {
        toast((error as Error).message || 'The document could not be attached', 'error')
      }
    },
    [tripId, refetch, toast],
  )

  const removeDocument = useCallback(
    async (documentId: string) => {
      try {
        await deleteSegmentDocument(tripId, documentId)
        refetch()
      } catch (error) {
        toast((error as Error).message || 'The document could not be removed', 'error')
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
        toast((error as Error).message || 'The document could not be updated', 'error')
      }
    },
    [tripId, refetch, toast],
  )

  return { segments, saveSegment, removeSegment, attachDocument, editDocument, removeDocument }
}
