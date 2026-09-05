import { useCallback, useState } from 'react'
import { useCompass } from '../../map'
import type { Coordinates, Id, Stop, Toast } from '../../../shared/model/types'
import useRouteToStop from './use-route-to-stop'

/* Asking the map a question: where the long-press menu is open, which loose
   point is being measured, and the answer for whichever target currently
   holds the floor — the selected stop, or the probe when nothing is.

   "From me" means THIS device first: the person tapping is the me. A tracked
   phone's fix stands in when the browser has not said, and asking with
   neither prompts the browser for one — the button is never a grey mystery. */
export default function useMapAsk({
  tripId,
  sample,
  from,
  stop,
  toast,
}: {
  tripId: Id
  sample: boolean
  from: Coordinates | null
  stop: Stop | null
  toast: Toast
}) {
  const [menuAt, setMenuAt] = useState<Coordinates | null>(null)
  const [probe, setProbe] = useState<Coordinates | null>(null)
  const [deviceAt, setDeviceAt] = useState<Coordinates | null>(null)
  /* The route must survive its card. Selecting a stop draws the way there —
     and on a phone the card covers the map, so the only chance to actually
     LOOK at that way is after the card closes. The last routed stop is held
     past its deselection; the floating pill then owns the route, and its ✕
     is the explicit goodbye. A new question (another stop, a probe) replaces
     the held one. */
  const [held, setHeld] = useState<Stop | null>(null)
  if (stop && !probe && stop !== held) setHeld(stop)
  const origin = deviceAt ?? from
  const route = useRouteToStop({
    tripId,
    sample,
    from: origin,
    stop: stop ?? (probe ? null : held),
    point: probe,
  })
  const dismiss = useCallback(() => {
    setProbe(null)
    setHeld(null)
  }, [])
  /* The compass rides with the other by-hand map questions: which way this
     very device is facing, for the beam on the traveller's own dot. */
  const compass = useCompass({ notify: toast })

  const measureFrom = useCallback(
    (at: Coordinates) => {
      setProbe(at)
      setHeld(null)
      if (origin) return
      if (!navigator.geolocation) {
        toast('This browser cannot report a location, and no phone has shared one.', 'error')
        setProbe(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        position => setDeviceAt([position.coords.longitude, position.coords.latitude]),
        () => {
          toast(
            'Measuring needs somewhere to start — allow location, or share from a phone.',
            'error',
          )
          setProbe(null)
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 120_000 },
      )
    },
    [origin, toast],
  )

  return {
    menuAt,
    setMenuAt,
    probe,
    dismiss,
    measureFrom,
    compass,
    measure: route.measure,
    summary: route.summary,
    pending: route.pending,
    /** the floating pill: the route's own voice whenever no card speaks for it —
        a loose probe, or the way to a stop whose card has been closed */
    pill: !stop && (probe || held) ? { summary: route.summary, pending: route.pending } : null,
  }
}
