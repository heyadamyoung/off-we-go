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
  const origin = deviceAt ?? from
  const route = useRouteToStop({ tripId, sample, from: origin, stop, point: probe })
  /* The compass rides with the other by-hand map questions: which way this
     very device is facing, for the beam on the traveller's own dot. */
  const compass = useCompass({ notify: toast })

  const measureFrom = useCallback(
    (at: Coordinates) => {
      setProbe(at)
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
    setProbe,
    measureFrom,
    compass,
    measure: route.measure,
    summary: route.summary,
    pending: route.pending,
    /** the floating pill: text, or a measuring beat, when a loose point holds the floor */
    pill: probe && !stop ? { summary: route.summary, pending: route.pending } : null,
  }
}
