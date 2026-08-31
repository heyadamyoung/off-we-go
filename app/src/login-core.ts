interface LoginLocation {
  assign(value: string): void
}

interface LoginBrowser {
  open(options: { url: string; presentationStyle: 'popover' }): Promise<unknown>
}

interface LoginStorage {
  setItem(key: string, value: string): void | Promise<void>
}

export const NATIVE_OIDC_VERIFIER_KEY = 'wayfare-oidc-verifier'

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function nativeBinding() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export async function beginOidcLogin({ apiBaseUrl, native, location, browser, storage }: {
  apiBaseUrl: string
  native: boolean
  location: LoginLocation
  browser: LoginBrowser
  storage?: LoginStorage
}) {
  const root = apiBaseUrl.replace(/\/$/, '')
  let url = `${root}/auth/oidc/start?client=${native ? 'native' : 'web'}`
  if (native) {
    if (!storage) throw new Error('Secure storage is required for native sign-in')
    const { verifier, challenge } = await nativeBinding()
    await storage.setItem(NATIVE_OIDC_VERIFIER_KEY, verifier)
    url += `&challenge=${encodeURIComponent(challenge)}`
    await browser.open({ url, presentationStyle: 'popover' })
    return
  }
  location.assign(url)
}

export function beginOidcLogout({ apiBaseUrl, native, location, browser }: {
  apiBaseUrl: string
  native: boolean
  location: LoginLocation
  browser: LoginBrowser
}) {
  const root = apiBaseUrl.replace(/\/$/, '')
  const url = `${root}/auth/oidc/logout?client=${native ? 'native' : 'web'}`
  if (native) return browser.open({ url, presentationStyle: 'popover' })
  location.assign(url)
  return new Promise<never>(() => {})
}
