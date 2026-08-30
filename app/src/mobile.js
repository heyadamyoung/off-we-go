import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { App as NativeApp } from '@capacitor/app'
import { Camera } from '@capacitor/camera'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'
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
const secureReady = isNativeApp
  ? Promise.all([
      SecureStorage.setSynchronize(false),
      SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly),
    ])
  : Promise.resolve()

export const sessionStorage = isNativeApp ? {
  async getItem(key) {
    await secureReady
    const secure = await SecureStorage.getItem(key)
    if (secure != null) return secure
    const legacy = globalThis.localStorage?.getItem(key) || null
    if (legacy != null) {
      await SecureStorage.setItem(key, legacy)
      globalThis.localStorage?.removeItem(key)
    }
    return legacy
  },
  async setItem(key, value) {
    await secureReady
    await SecureStorage.setItem(key, value)
    globalThis.localStorage?.removeItem(key)
  },
  async removeItem(key) {
    await secureReady
    await SecureStorage.removeItem(key)
    globalThis.localStorage?.removeItem(key)
  },
} : (typeof localStorage === 'undefined'
  ? { getItem() { return null }, setItem() {}, removeItem() {} }
  : localStorage)

const trackingStorage = isNativeApp ? {
  async get({ key }) {
    if (!key.endsWith('.config.v1')) return Preferences.get({ key })
    await secureReady
    let value = await SecureStorage.getItem(key)
    if (value == null) {
      value = (await Preferences.get({ key })).value
      if (value != null) {
        await SecureStorage.setItem(key, value)
        await Preferences.remove({ key })
      }
    }
    return { value }
  },
  async set({ key, value }) {
    if (!key.endsWith('.config.v1')) return Preferences.set({ key, value })
    await secureReady
    await SecureStorage.setItem(key, value)
  },
  async remove({ key }) {
    if (!key.endsWith('.config.v1')) return Preferences.remove({ key })
    await secureReady
    await Promise.all([SecureStorage.removeItem(key), Preferences.remove({ key })])
  },
} : Preferences

export const mobileTracker = isNativeApp
  ? createMobileTracker({ driver: BackgroundGeolocation, storage: trackingStorage, fetch: globalThis.fetch.bind(globalThis) })
  : webTracker

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
