import { useEffect, useState } from 'react'
import { pendingEdits, refreshPendingEdits, subscribeToPendingEdits } from '../../../offline-edits'
import { syncTripEdits } from '../../../sync-edits'
import type { Toast } from '../../../shared/model/types'

interface OfflineEditsOptions {
  toast: Toast
  /* The server is the authority once it has heard everything: a stop created
     here under a made-up name has a real one now, and the screen should be
     holding that rather than ours. */
  onSynced: () => void
}

/* Empties the queue when there is a connection again, and says what happened.
   Also on mount, because the last session may have ended mid-flight. */
export default function useOfflineEdits({ toast, onSynced }: OfflineEditsOptions) {
  const [waiting, setWaiting] = useState(pendingEdits())

  useEffect(() => subscribeToPendingEdits(setWaiting), [])

  useEffect(() => {
    let alive = true
    const sync = async () => {
      const before = await refreshPendingEdits()
      if (!before || !alive) return
      const said = await syncTripEdits()
      if (!alive || !said) return
      toast(said)
      onSynced()
    }
    void sync()
    window.addEventListener('online', sync)
    return () => {
      alive = false
      window.removeEventListener('online', sync)
    }
  }, [toast, onSynced])

  return waiting
}
