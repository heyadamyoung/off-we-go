import {
  Capacitor,
  CapacitorHttp,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { App as NativeApp } from '@capacitor/app'
import { Camera } from '@capacitor/camera'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Browser } from '@capacitor/browser'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'
import {
  createMobileTracker,
  type LocationDriver,
  type MobileTracker,
  type TrackerState,
  type TrackerStorage,
} from './mobile-tracking-core'
import { galleryPhotosToFiles } from './mobile-photos-core'
import { completeNativeLogin, type NativeLoginState } from './mobile-auth-core'
import { createNativeLocationDriver, createNativeTrackingFetch } from './mobile-platform-core'
import { beginOidcLogin, beginOidcLogout, NATIVE_OIDC_VERIFIER_KEY } from './login-core'
import type { AsyncStorage } from './shared/model/types'

export const isNativeApp = Capacitor.isNativePlatform()
export const mobilePlatform = Capacitor.getPlatform()
if (isNativeApp) document.documentElement.classList.add('native-app', `native-${mobilePlatform}`)

const unavailableState: TrackerState = {
  status: 'unavailable',
  configured: false,
  deviceId: null,
  name: null,
  queued: 0,
  lastSentAt: null,
  error: null,
}

/* The same surface as the real tracker, every path a polite refusal: a web tab
   cannot track in the background, and pretending otherwise would only lose
   fixes silently. */
const webTracker: MobileTracker = {
  async configure() {
    throw new Error('Background tracking is available in the native app')
  },
  async restore() {
    return false
  },
  async start() {
    throw new Error('Background tracking is available in the native app')
  },
  async stop() {},
  async forget() {},
  getState() {
    return { ...unavailableState }
  },
  subscribe(listener: (state: TrackerState) => void) {
    listener({ ...unavailableState })
    return () => {}
  },
}

const BackgroundGeolocation = isNativeApp
  ? registerPlugin<LocationDriver>('BackgroundGeolocation')
  : null
const locationDriver =
  isNativeApp && BackgroundGeolocation
    ? createNativeLocationDriver({
        backgroundGeolocation: BackgroundGeolocation,
        localNotifications: LocalNotifications,
        platform: mobilePlatform,
      })
    : null
const trackingFetch = createNativeTrackingFetch({
  nativeHttp: CapacitorHttp,
  platform: mobilePlatform,
  webFetch: globalThis.fetch.bind(globalThis),
})
const secureReady = isNativeApp
  ? Promise.all([
      SecureStorage.setSynchronize(false),
      SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly),
    ])
  : Promise.resolve()

export const sessionStorage: AsyncStorage = isNativeApp
  ? {
      async getItem(key: string) {
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
      async setItem(key: string, value: string) {
        await secureReady
        await SecureStorage.setItem(key, value)
        globalThis.localStorage?.removeItem(key)
      },
      async removeItem(key: string) {
        await secureReady
        await SecureStorage.removeItem(key)
        globalThis.localStorage?.removeItem(key)
      },
    }
  : typeof localStorage === 'undefined'
    ? {
        getItem() {
          return null
        },
        setItem() {},
        removeItem() {},
      }
    : localStorage

/* Ordinary device storage, for things that are merely a copy of what the
   server already told us — the offline trip cache. Deliberately not the
   keychain: this is not a credential, and the secure store is slow enough that
   putting a whole trip through it would be felt on every load. */
export const deviceStorage: AsyncStorage = isNativeApp
  ? {
      async getItem(key: string) {
        return (await Preferences.get({ key })).value
      },
      async setItem(key: string, value: string) {
        await Preferences.set({ key, value })
      },
      async removeItem(key: string) {
        await Preferences.remove({ key })
      },
    }
  : sessionStorage

const trackingStorage: TrackerStorage = isNativeApp
  ? {
      async get({ key }: { key: string }) {
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
      async set({ key, value }: { key: string; value: string }) {
        if (!key.endsWith('.config.v1')) return Preferences.set({ key, value })
        await secureReady
        await SecureStorage.setItem(key, value)
      },
      async remove({ key }: { key: string }) {
        if (!key.endsWith('.config.v1')) return Preferences.remove({ key })
        await secureReady
        await Promise.all([SecureStorage.removeItem(key), Preferences.remove({ key })])
      },
    }
  : Preferences

export const mobileTracker: MobileTracker =
  isNativeApp && locationDriver
    ? createMobileTracker({
        driver: locationDriver,
        storage: trackingStorage,
        fetch: trackingFetch,
      })
    : webTracker

export async function pickNativePhotos() {
  if (!isNativeApp) return null
  const selected = await Camera.pickImages({ quality: 92, correctOrientation: true, limit: 20 })
  return galleryPhotosToFiles(selected.photos, { fetch: globalThis.fetch.bind(globalThis) })
}

let appUrlListener: Promise<PluginListenerHandle> | null = null
let nativeOidcPending = false
let nativeLoginState: NativeLoginState | null = null
const nativeLoginListeners = new Set<(state: NativeLoginState) => void>()

function publishNativeLogin(state: NativeLoginState) {
  nativeLoginState = state
  nativeLoginListeners.forEach(listener => {
    listener(state)
  })
}

export function subscribeToNativeLogin(listener: (state: NativeLoginState) => void) {
  nativeLoginListeners.add(listener)
  if (nativeLoginState) listener(nativeLoginState)
  return () => {
    nativeLoginListeners.delete(listener)
  }
}

export function startOidcLogin(apiBaseUrl: string) {
  if (isNativeApp) nativeOidcPending = true
  return beginOidcLogin({
    apiBaseUrl,
    native: isNativeApp,
    location: window.location,
    browser: Browser,
    storage: sessionStorage,
  }).catch(error => {
    nativeOidcPending = false
    throw error
  })
}

export function startOidcLogout(apiBaseUrl: string) {
  nativeOidcPending = false
  return beginOidcLogout({
    apiBaseUrl,
    native: isNativeApp,
    location: window.location,
    browser: Browser,
  })
}

/* All the tracker needs of the API client: the one call that turns a login
   hand-off token into a session. */
interface HandoffAuthClient {
  exchangeLoginHandoff(
    token: string,
    options?: { client?: string; verifier?: string },
  ): Promise<unknown>
}

/* A custom-scheme URL (wayfare://auth?token=…) can be fired by any app on the
   device, so a hand-off arriving that way is only trusted when this app can
   prove it started the sign-in, with the verifier it stored at the time. A
   universal link is domain-verified by the OS, so it stands on its own — and
   that is the path an emailed sign-in link takes. */
const nativeBoundAuthClient = (authClient: HandoffAuthClient, viaCustomScheme = false) => ({
  async exchangeLoginHandoff(token: string) {
    const verifier = await sessionStorage.getItem(NATIVE_OIDC_VERIFIER_KEY)
    if (viaCustomScheme && !verifier) {
      throw new Error('Start signing in from the app')
    }
    try {
      return await authClient.exchangeLoginHandoff(
        token,
        verifier ? { client: 'native', verifier } : {},
      )
    } finally {
      await sessionStorage.removeItem(NATIVE_OIDC_VERIFIER_KEY)
    }
  },
})

const isCustomScheme = (url: string) => {
  try {
    return new URL(url).protocol === 'wayfare:'
  } catch {
    return false
  }
}

/* A universal link into /pair is the QR pairing handshake, not a sign-in;
   hand it to the pair screen with its fragment intact. */
function routePairUrl(url: string) {
  try {
    const opened = new URL(url)
    if (opened.pathname === '/pair') {
      window.location.assign(`/pair${opened.hash || ''}`)
      return true
    }
  } catch {
    /* not parseable; the login handler will say so */
  }
  return false
}

export async function initializeNativeServices(authClient: HandoffAuthClient) {
  if (!isNativeApp) return
  if (!appUrlListener) {
    appUrlListener = NativeApp.addListener('appUrlOpen', ({ url }) => {
      nativeOidcPending = false
      void Browser.close().catch(() => {})
      if (routePairUrl(url)) return
      void completeNativeLogin(
        url,
        nativeBoundAuthClient(authClient, isCustomScheme(url)),
        publishNativeLogin,
      )
    })
    void Browser.addListener('browserFinished', () => {
      if (!nativeOidcPending) return
      nativeOidcPending = false
      publishNativeLogin({ status: 'error', error: 'Sign-in was cancelled' })
    })
    const launch = await NativeApp.getLaunchUrl()
    if (launch?.url && !routePairUrl(launch.url)) {
      await completeNativeLogin(
        launch.url,
        nativeBoundAuthClient(authClient, isCustomScheme(launch.url)),
        publishNativeLogin,
      )
    }
  }
  await mobileTracker.restore().catch(() => {})
}
