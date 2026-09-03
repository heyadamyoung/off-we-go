/* The contracts the tracker runs on. The native app passes Capacitor plugins;
   the tests pass hand-rolled fakes; both fit these shapes. */
export interface NativeLocation {
  latitude: number
  longitude: number
  accuracy?: number | null
  altitude?: number | null
  speed?: number | null
  bearing?: number | null
  time?: number | null
}

export interface WatcherOptions {
  backgroundTitle?: string
  backgroundMessage?: string
  requestPermissions?: boolean
  stale?: boolean
  distanceFilter?: number
}

export interface LocationDriver {
  addWatcher(
    options: WatcherOptions,
    listener: (location: NativeLocation | null | undefined, error?: Error) => void,
  ): Promise<string>
  removeWatcher(options: { id: string }): Promise<void> | void
  openSettings?(): Promise<void> | void
}

export interface TrackerStorage {
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void> | void
  remove(options: { key: string }): Promise<void> | void
}

export interface TrackingResponse {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
}

export type TrackingFetch = (
  url: string,
  options?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  },
) => Promise<TrackingResponse>

export interface TrackingConfig {
  endpoint: string
  token: string
  deviceId: string
  name?: string | null
  enabled?: boolean
}

export interface TrackerState {
  status: 'stopped' | 'starting' | 'tracking' | 'waiting' | 'error' | 'unavailable'
  configured: boolean
  deviceId: string | null
  name: string | null
  queued: number
  lastSentAt: number | null
  error: string | null
}
