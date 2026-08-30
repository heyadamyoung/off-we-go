import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { App as NativeApp } from '@capacitor/app'
import { Camera } from '@capacitor/camera'
import { createMobileTracker } from './mobileTrackingCore'
import { galleryPhotosToFiles } from './mobilePhotosCore'
import { magicTokenFromUrl } from './mobileAuthCore'

export const isNativeApp = Capacitor.isNativePlatform()
if (isNativeApp) document.documentElement.classList.add('native-ios')

const unavailableState = {
  status: 'unavailable', configured: false, deviceId: null, name: null,
  queued: 0, lastSentAt: null, error: null,
}

const webTracker = {
  async configure() { throw new Error('Background tracking is available in the iPhone app') },
  async restore() { return false },
  async start() { throw new Error('Background tracking is available in the iPhone app') },
  async stop() {},
  async forget() {},
  getState() { return { ...unavailableState } },
  subscribe(listener) { listener({ ...unavailableState }); return () => {} },
}

const BackgroundGeolocation = isNativeApp ? registerPlugin('BackgroundGeolocation') : null

export const mobileTracker = isNativeApp
  ? createMobileTracker({ driver: BackgroundGeolocation, storage: Preferences, fetch: globalThis.fetch.bind(globalThis) })
  : webTracker

export const authRedirectUrl = () => isNativeApp
  ? 'wayfare://auth'
  : window.location.origin + window.location.pathname

export async function pickNativePhotos() {
  if (!isNativeApp) return null
  const selected = await Camera.pickImages({ quality: 92, correctOrientation: true, limit: 20 })
  return galleryPhotosToFiles(selected.photos, { fetch: globalThis.fetch.bind(globalThis) })
}

let appUrlListener = null

async function completeNativeLogin(url, authClient) {
  const token = magicTokenFromUrl(url)
  if (token) await authClient?.exchangeMagicToken(token)
}

export async function initializeNativeServices(authClient) {
  if (!isNativeApp) return
  if (!appUrlListener) {
    appUrlListener = NativeApp.addListener('appUrlOpen', ({ url }) => completeNativeLogin(url, authClient))
    const launch = await NativeApp.getLaunchUrl()
    if (launch?.url) await completeNativeLogin(launch.url, authClient)
  }
  await mobileTracker.restore().catch(() => {})
}
