import type {
  LocationDriver,
  NativeLocation,
  TrackingFetch,
  WatcherOptions,
} from './mobile-tracking-core'

interface NotificationPermissions {
  display: string
}

interface LocalNotificationsLike {
  checkPermissions(): Promise<NotificationPermissions>
  requestPermissions(): Promise<NotificationPermissions>
}

interface NativeHttpLike {
  request(options: {
    url: string
    method: string
    headers: Record<string, string>
    data?: unknown
  }): Promise<{ status: number; headers?: Record<string, string> }>
}

export function createNativeLocationDriver({
  backgroundGeolocation,
  localNotifications,
  platform,
}: {
  backgroundGeolocation: LocationDriver
  localNotifications: LocalNotificationsLike
  platform: string
}): LocationDriver {
  if (platform !== 'android') return backgroundGeolocation

  return {
    async addWatcher(
      options: WatcherOptions,
      listener: (location: NativeLocation | null | undefined, error?: Error) => void,
    ) {
      let current = await localNotifications.checkPermissions()
      if (current.display === 'prompt' || current.display === 'prompt-with-rationale') {
        current = await localNotifications.requestPermissions()
      }
      if (current.display !== 'granted') {
        throw new Error('Allow notifications so Android can keep location sharing active')
      }
      return backgroundGeolocation.addWatcher(options, listener)
    },
    removeWatcher(options: { id: string }) {
      return backgroundGeolocation.removeWatcher(options)
    },
    openSettings() {
      return backgroundGeolocation.openSettings?.()
    },
  }
}

export function createNativeTrackingFetch({
  nativeHttp,
  platform,
  webFetch,
}: {
  nativeHttp: NativeHttpLike
  platform: string
  webFetch: TrackingFetch
}): TrackingFetch {
  if (platform !== 'android') return webFetch

  return async (url, options = {}) => {
    const result = await nativeHttp.request({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      data: options.body ? JSON.parse(options.body) : undefined,
    })
    const headers = Object.fromEntries(
      Object.entries(result.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
    )
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      headers: {
        get(name: string) {
          return headers[String(name).toLowerCase()] ?? null
        },
      },
    }
  }
}
