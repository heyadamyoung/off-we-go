import { useEffect, useRef, useState } from 'react'
import { mobileTracker } from '../../../mobile'
import { trackError } from '../../../shared/lib/telemetry'

/* The tracker's state for the screen, with the observability rule attached:
   the transition into error is recorded once — the trail failing to send is
   the product failing at its one job, and it must not fail only onto a
   status pill nobody is looking at. */
export default function useTrackerState() {
  const [tracking, setTracking] = useState(() => mobileTracker.getState())
  const hadError = useRef(false)
  useEffect(
    () =>
      mobileTracker.subscribe(state => {
        if (state.error && !hadError.current) {
          trackError('send position', new Error(String(state.error)), {
            status: String(state.status),
          })
        }
        hadError.current = !!state.error
        setTracking(state)
      }),
    [],
  )
  return tracking
}
