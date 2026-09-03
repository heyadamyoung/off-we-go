import { useEffect } from 'react'
import type { StopDraft } from '../../../shared/model/types'

/* One Escape, one step back, in the order things stack on screen: the photo
   viewer first because it covers everything, then pin placing, then the stop
   editor, then the assistant, then the selected stop,
   then the terminal map (which itself steps back through its gate route
   first). The selection outranks the terminal because selecting an airport is
   what auto-opens its terminal — the card is the newer thing on screen, and
   Escape unwinds newest-first. Kept in one place so the order stays a
   decision, not an accident. */
export default function useTripEscape({
  viewerOpen,
  closeViewer,
  placing,
  setPlacing,
  draft,
  setDraft,
  asking,
  setAsking,
  indoor,
  selected,
  patch,
}: {
  viewerOpen: boolean
  closeViewer: () => void
  placing: { move?: string } | null
  setPlacing: (placing: null) => void
  draft: StopDraft | null
  setDraft: (draft: null) => void
  asking: boolean
  setAsking: (asking: boolean) => void
  indoor: { active: boolean; close: () => void }
  selected?: string
  patch: (changes: Record<string, unknown>) => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (viewerOpen) closeViewer()
      else if (placing) setPlacing(null)
      else if (draft) setDraft(null)
      else if (asking) setAsking(false)
      else if (selected) patch({ sel: undefined })
      else if (indoor.active) indoor.close()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [
    viewerOpen,
    closeViewer,
    placing,
    draft,
    asking,
    indoor.active,
    indoor.close,
    selected,
    patch,
    setDraft,
    setPlacing,
    setAsking,
  ])
}
