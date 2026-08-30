export function createNativeLocationDriver({ backgroundGeolocation, localNotifications, platform }: any) {
  if (platform !== 'android') return backgroundGeolocation

  return {
    async addWatcher(options, listener) {
      let current = await localNotifications.checkPermissions()
      if (current.display === 'prompt' || current.display === 'prompt-with-rationale') {
        current = await localNotifications.requestPermissions()
      }
      if (current.display !== 'granted') {
        throw new Error('Allow notifications so Android can keep location sharing active')
      }
      return backgroundGeolocation.addWatcher(options, listener)
    },
    removeWatcher(options) {
      return backgroundGeolocation.removeWatcher(options)
    },
    openSettings() {
      return backgroundGeolocation.openSettings()
    },
  }
}

export function createNativeTrackingFetch({ nativeHttp, platform, webFetch }: any) {
  if (platform !== 'android') return webFetch

  return async (url, options: any = {}) => {
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
      headers: { get(name) { return headers[String(name).toLowerCase()] ?? null } },
    }
  }
}
