import { useCallback, useEffect, useRef, useState } from 'react'
import { headingFromEvent } from '../../../compass-core'
import { mobileTracker } from '../../../mobile'
import { track } from '../../../shared/lib/telemetry'
import type { Coordinates } from '../../../shared/model/types'

/* The phone's own compass, so the traveller's dot can say which way they are
   FACING — GPS course only knows which way they have been moving, which is no
   help to someone standing still and turning on the spot to get their
   bearings. iOS gates the sensor behind a tap-born permission prompt, so the
   whole feature arms from a button rather than ambushing on page load. */

interface OrientationPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const REMEMBER_KEY = 'wayfare.compass.on'

const needsGesture = () =>
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission ===
    'function'

const screenAngle = () => {
  try {
    return window.screen?.orientation?.angle ?? 0
  } catch {
    return 0
  }
}

const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(REMEMBER_KEY, '1')
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {}
}

export default function useCompass({ notify }: { notify: (m: string, tone?: 'error') => void }) {
  const [on, setOn] = useState(false)
  const [facing, setFacing] = useState<number | null>(null)
  const [at, setAt] = useState<Coordinates | null>(null)
  /* Which reporting phone is THIS device, so its avatar can wear the beam.
     Only the native app registers as a phone; a web tab stays null and gets
     its own small dot instead. */
  const [selfKey, setSelfKey] = useState<string | null>(null)
  useEffect(() => mobileTracker.subscribe(state => setSelfKey(state.deviceId)), [])

  const teardown = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    teardown.current()
    teardown.current = () => {}
    setOn(false)
    setFacing(null)
    setAt(null)
    remember(false)
  }, [])

  const start = useCallback(
    async (quiet = false) => {
      /* iOS answers requestPermission only from a user gesture the first time;
         once granted it resolves silently, which is what lets a remembered
         choice re-arm on the next visit without a tap. */
      if (needsGesture()) {
        let verdict = 'denied'
        try {
          verdict = await (
            DeviceOrientationEvent as unknown as Required<OrientationPermission>
          ).requestPermission()
        } catch {}
        if (verdict !== 'granted') {
          if (!quiet) notify('The compass needs permission — allow motion access', 'error')
          remember(false)
          return
        }
      }

      let heard = false
      const onReading = (event: DeviceOrientationEvent) => {
        const heading = headingFromEvent(event, screenAngle())
        if (heading == null) return
        heard = true
        setFacing(heading)
      }
      /* Chrome fires the absolute stream; Safari only the plain one, but with
         webkitCompassHeading aboard. Listening to both and letting
         headingFromEvent keep whichever reading is trustworthy covers the two
         without sniffing anybody. */
      window.addEventListener('deviceorientationabsolute', onReading as EventListener)
      window.addEventListener('deviceorientation', onReading as EventListener)

      /* Position rides along whenever the compass is on: the beam sits on the
         traveller's avatar when this device reports as a phone, and on this
         plain fix otherwise — the map decides which to draw, not this hook. */
      let watch: number | null = null
      if (navigator.geolocation) {
        watch = navigator.geolocation.watchPosition(
          position => setAt([position.coords.longitude, position.coords.latitude]),
          () => {
            if (!quiet)
              notify('Your position is not available, so the beam has nowhere to sit', 'error')
          },
          { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
        )
      }

      /* Desktops listen politely and hear nothing: say so instead of a button
         that lights up and does nothing visible. */
      const silence = window.setTimeout(() => {
        if (!heard) {
          if (!quiet) notify('No compass on this device', 'error')
          stop()
        }
      }, 3_000)

      teardown.current = () => {
        window.removeEventListener('deviceorientationabsolute', onReading as EventListener)
        window.removeEventListener('deviceorientation', onReading as EventListener)
        if (watch != null) navigator.geolocation?.clearWatch(watch)
        window.clearTimeout(silence)
      }
      setOn(true)
      remember(true)
      track('toggle compass', { engaged: 'true' })
    },
    [notify, stop],
  )

  /* A traveller who turned the beam on wants it on tomorrow too. Quietly: a
     silent failure here just means the button waits for its tap again. */
  const wanted = useRef(false)
  useEffect(() => {
    if (wanted.current) return
    wanted.current = true
    try {
      if (localStorage.getItem(REMEMBER_KEY) === '1') void start(true)
    } catch {}
    return () => teardown.current()
  }, [start])

  const toggle = useCallback(() => {
    if (on) {
      track('toggle compass', { engaged: 'false' })
      stop()
      return
    }
    void start()
  }, [on, start, stop])

  return { on, facing, at, selfKey, toggle }
}
