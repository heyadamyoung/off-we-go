import type { ApiRequestOptions, AsyncStorage, AuthSession } from './shared/model/types'

const SESSION_KEY = 'wayfare-session'

export function safeOAuthContinuation(value: unknown, origin: string) {
  if (typeof value !== 'string') return null
  try {
    const destination = new URL(value, origin)
    return destination.origin === origin && destination.pathname === '/oauth/authorize'
      ? destination.pathname + destination.search : null
  } catch { return null }
}

interface ApiClientOptions {
  baseUrl: string
  storage: AsyncStorage
  fetch: typeof fetch
}

export function createApiClient({ baseUrl, storage, fetch: fetchFn }: ApiClientOptions) {
  let session: AuthSession | null = null
  let hydrated = false
  let hydration: Promise<AuthSession | null> | null = null
  const listeners = new Set<(session: AuthSession | null) => void>()
  try {
    const initial = storage.getItem(SESSION_KEY)
    if (initial && typeof initial !== 'string') {
      hydration = Promise.resolve(initial).then(value => {
        try { session = JSON.parse(value || 'null') as AuthSession | null } catch { session = null }
        hydrated = true
        return session
      })
    } else {
      session = JSON.parse((initial as string | null) || 'null') as AuthSession | null
      hydrated = true
    }
  } catch { session = null; hydrated = true }

  const emit = () => listeners.forEach(listener => listener(session))
  const hydrate = async () => {
    if (hydrated) return session
    if (hydration) await hydration
    return session
  }
  const save = async (value: AuthSession | null) => {
    session = value
    // Publish the authenticated in-memory session before waiting on the native
    // keychain. iOS may delay plugin work while the app is resuming from Mail;
    // that must not keep the sign-in screen mounted after a successful exchange.
    emit()
    if (value) await storage.setItem(SESSION_KEY, JSON.stringify(value))
    else await storage.removeItem(SESSION_KEY)
    return session
  }

  const request = async <T = any>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
    await hydrate()
    const headers: Record<string, string> = { ...Object.fromEntries(new Headers(options.headers).entries()) }
    if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`
    let body = options.body
    if (body != null && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Blob)) {
      headers['content-type'] ||= 'application/json'
      body = JSON.stringify(body)
    }
    const response = await fetchFn(baseUrl.replace(/\/$/, '') + path, {
      credentials: 'include', ...options, headers, body: body as BodyInit | null | undefined,
    })
    if (response.status === 401 && !path.startsWith('/auth/')) await save(null)
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      let code = ''
      try {
        const payload = await response.json()
        message = payload.error || message
        code = typeof payload.code === 'string' ? payload.code : ''
      } catch { const text = await response.text(); if (text) message = text }
      const error: Error & { status?: number; code?: string } = new Error(message)
      error.status = response.status
      if (code) error.code = code
      throw error
    }
    if (response.status === 204) return null as T
    const contentType = response.headers.get('content-type') || ''
    return (contentType.includes('json') ? response.json() : response.text()) as Promise<T>
  }

  return {
    request,
    getSession() { return session },
    subscribe(listener: (session: AuthSession | null) => void) { listeners.add(listener); return () => listeners.delete(listener) },
    async acceptSession(value: AuthSession) {
      return save({ accessToken: value.accessToken, user: value.user })
    },
    async exchangeLoginHandoff(token: string, binding: { client?: 'native'; verifier?: string } = {}) {
      const result = await request<AuthSession>('/auth/exchange', { method: 'POST', body: { token, ...binding } })
      return await save({ accessToken: result.accessToken, user: result.user })
    },
    async restore() {
      await hydrate()
      if (!session?.accessToken) return null
      try {
        const result = await request<{ user: AuthSession['user'] }>('/auth/session')
        return await save({ ...session, user: result.user })
      } catch { return await save(null) }
    },
    async signOut() {
      try { if (session) await request('/auth/logout', { method: 'POST' }) } finally { await save(null) }
    },
  }
}
