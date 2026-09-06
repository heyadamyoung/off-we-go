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

export type CompassMode = 'off' | 'beam' | 'heading'

const remember = (mode: CompassMode) => {
  try {
    if (mode === 'off') localStorage.removeItem(REMEMBER_KEY)
    else localStorage.setItem(REMEMBER_KEY, mode === 'heading' ? '2' : '1')
  } catch {}
}

export default function useCompass({ notify }: { notify: (m: string, tone?: 'error') => void }) {
  const [mode, setMode] = useState<CompassMode>('off')
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
    setMode('off')
    setFacing(null)
    setAt(null)
    remember('off')
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
          remember('off')
          return
        }
      }

      let heard = false
      /* The sensor speaks at up to 60Hz and every word was a re-render. A
         reading has to be either fresh enough in time or different enough in
         angle to be worth repainting a beam or turning a map for. */
      let spokeAt = 0
      let spokeDeg = -999
      const onReading = (event: DeviceOrientationEvent) => {
        const heading = headingFromEvent(event, screenAngle())
        if (heading == null) return
        heard = true
        const now = performance.now()
        const turned = Math.abs(((heading - spokeDeg + 540) % 360) - 180)
        if (now - spokeAt < 120 && turned < 2) return
        spokeAt = now
        spokeDeg = heading
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
      setMode(current => {
        const next = current === 'off' ? 'beam' : current
        remember(next)
        return next
      })
      track('toggle compass', { engaged: 'true' })
    },
    [notify, stop],
  )

  /* A traveller who turned the beam on wants it on tomorrow too — and one who
     walked with the map turning under their thumbs wants that back as well.
     Quietly: a silent failure just means the button waits for its tap. */
  const wanted = useRef(false)
  useEffect(() => {
    if (wanted.current) return
    wanted.current = true
    try {
      const stored = localStorage.getItem(REMEMBER_KEY)
      if (stored === '1' || stored === '2') {
        void start(true).then(() => {
          if (stored === '2') setMode(current => (current === 'beam' ? 'heading' : current))
        })
      }
    } catch {}
    return () => teardown.current()
  }, [start])

  /* One button, three gaits, the Google cadence: off arms the beam; the beam
     hands the map its bearing; heading stands everything down. */
  const toggle = useCallback(() => {
    if (mode === 'off') {
      void start()
      return
    }
    if (mode === 'beam') {
      setMode('heading')
      remember('heading')
      track('toggle compass', { engaged: 'heading' })
      return
    }
    track('toggle compass', { engaged: 'false' })
    stop()
  }, [mode, start, stop])

  return { on: mode !== 'off', mode, facing, at, selfKey, toggle }
}
