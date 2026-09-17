import { useCallback, useMemo, useState } from 'react'
import type { Paper } from '../../../papers-core'
import type { PaperEditing } from '../ui/paper-view'
import type { StopDocTools } from './use-stop-docs'

interface SegmentDocTools {
  editDocument: (documentId: string, changes: { name?: string; note?: string }) => void
  removeDocument: (documentId: string) => void
}

/* The paper on screen, and which drawer it came out of.
 *
 * Held here rather than in the URL: a document is a thing you are holding up
 * to somebody, not a place you navigated to, and a back button that closed the
 * boarding pass mid-scan would be exactly the wrong behaviour.
 *
 * A paper carries the id of the leg or the stop it hangs off, which is the
 * only thing that decides where a rename is sent. The two stores take the same
 * arguments, so this is a choice between them rather than a translation — and
 * making it here is what lets the Papers tab, a leg's card, a stop's sheet and
 * the card over the map all open the same screen.
 */
export default function usePapers(
  canEdit: boolean,
  segments: SegmentDocTools,
  stops: StopDocTools,
) {
  const [paper, setPaper] = useState<Paper | null>(null)
  const close = useCallback(() => setPaper(null), [])

  const editing = useMemo<PaperEditing | undefined>(
    () =>
      canEdit
        ? {
            rename: (one, changes) => {
              /* The screen is about this document, with its name written at the
                 top of it. The trip reloads behind the rename, but what is held
                 here is the paper as it was opened — so without this the name
                 you just typed is the one thing on screen still saying the old
                 one. */
              setPaper(open => (open && open.id === one.id ? { ...open, ...changes } : open))
              if (one.segmentId) segments.editDocument(one.id, changes)
              else stops.edit(one.id, changes)
            },
            remove: one => (one.segmentId ? segments.removeDocument(one.id) : stops.remove(one.id)),
          }
        : undefined,
    [canEdit, segments, stops],
  )

  return { paper, open: setPaper, close, editing }
}
