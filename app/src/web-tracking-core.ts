import type { LocationDriver, NativeLocation, WatcherOptions } from './mobile-tracking-contract'

/* A browser as a location driver: the same shape the native plugin has, on
   the Geolocation API. It shares while the page is open and the browser is
   awake — no more than that, and the screen says so — but a phone with no
   app on it can still put itself on the map. */

export interface CoordsLike {
  latitude: number
  longitude: number
  accuracy?: number | null
  altitude?: number | null
  speed?: number | null
  heading?: number | null
}

export interface PositionLike {
  coords: CoordsLike
  timestamp?: number
}

export interface PositionErrorLike {
  code: number
  message?: string
}

export interface GeolocationLike {
  watchPosition(
    success: (position: PositionLike) => void,
    error?: (error: PositionErrorLike) => void,
    options?: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
  ): number
  clearWatch(id: number): void
}

/** Metres between two points on the ground. */
export function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLng = (b.longitude - a.longitude) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/* Denied is a decision the person can undo in the browser; unavailable is
   the phone's; a timeout is neither, and is waited through. */
export function describePositionError(error: PositionErrorLike): string | null {
  switch (error.code) {
    case 1:
      return 'Allow location access for Off We Go in the browser, then try again'
    case 2:
      return 'The phone could not find its position'
    default:
      return null
  }
}

/** A fix worth sending: far enough from the last, or long enough after it. */
export const STILL_MS = 60_000

export function createWebLocationDriver(
  geolocation: GeolocationLike | null | undefined,
  now: () => number = Date.now,
): LocationDriver {
  const watches = new Map<string, number>()
  let serial = 0
  return {
    async addWatcher(
      options: WatcherOptions,
      listener: (location: NativeLocation | null | undefined, error?: Error) => void,
    ) {
      if (!geolocation) throw new Error('This browser cannot share its location')
      const minMetres = options.distanceFilter ?? 10
      let last: { latitude: number; longitude: number; at: number } | null = null
      const id = String(++serial)
      const handle = geolocation.watchPosition(
        position => {
          const coords = position.coords
          const at = position.timestamp || now()
          if (last && metresBetween(last, coords) < minMetres && at - last.at < STILL_MS) return
          last = { latitude: coords.latitude, longitude: coords.longitude, at }
          listener({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy ?? null,
            altitude: coords.altitude ?? null,
            speed: coords.speed ?? null,
            bearing: coords.heading ?? null,
            time: at,
          })
        },
        error => {
          const words = describePositionError(error)
          if (words) listener(null, new Error(words))
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
      )
      watches.set(id, handle)
      return id
    },
    removeWatcher({ id }: { id: string }) {
      const handle = watches.get(id)
      if (handle != null) geolocation?.clearWatch(handle)
      watches.delete(id)
    },
  }
}
