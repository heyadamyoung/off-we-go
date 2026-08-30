const SESSION_KEY = 'wayfare-session'

export function safeOAuthContinuation(value, origin) {
  if (typeof value !== 'string') return null
  try {
    const destination = new URL(value, origin)
    return destination.origin === origin && destination.pathname === '/oauth/authorize'
      ? destination.pathname + destination.search : null
  } catch { return null }
}

export function createApiClient({ baseUrl, storage, fetch: fetchFn }) {
  let session = null
  let hydrated = false
  let hydration = null
  const listeners = new Set()
  try {
    const initial = storage.getItem(SESSION_KEY)
    if (initial && typeof initial.then === 'function') {
      hydration = Promise.resolve(initial).then(value => {
        try { session = JSON.parse(value || 'null') } catch { session = null }
        hydrated = true
        return session
      })
    } else {
      session = JSON.parse(initial || 'null')
      hydrated = true
    }
  } catch { session = null; hydrated = true }

  const emit = () => listeners.forEach(listener => listener(session))
  const hydrate = async () => {
    if (hydrated) return session
    if (hydration) await hydration
    return session
  }
  const save = async value => {
    session = value
    if (value) await storage.setItem(SESSION_KEY, JSON.stringify(value))
    else await storage.removeItem(SESSION_KEY)
    emit()
    return session
  }

  const request = async (path, options = {}) => {
    await hydrate()
    const headers = { ...(options.headers || {}) }
    if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`
    let body = options.body
    if (body != null && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Blob)) {
      headers['content-type'] ||= 'application/json'
      body = JSON.stringify(body)
    }
    const response = await fetchFn(baseUrl.replace(/\/$/, '') + path, { ...options, headers, body })
    if (response.status === 401 && !path.startsWith('/auth/')) await save(null)
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try {
        const payload = await response.json()
        message = payload.error || message
      } catch { const text = await response.text(); if (text) message = text }
      const error = new Error(message)
      error.status = response.status
      throw error
    }
    if (response.status === 204) return null
    const contentType = response.headers.get('content-type') || ''
    return contentType.includes('json') ? response.json() : response.text()
  }

  return {
    request,
    getSession() { return session },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async exchangeMagicToken(token) {
      const result = await request('/auth/exchange', { method: 'POST', body: { token } })
      return await save({ accessToken: result.accessToken, user: result.user })
    },
    async restore() {
      await hydrate()
      if (!session?.accessToken) return null
      try {
        const result = await request('/auth/session')
        return await save({ ...session, user: result.user })
      } catch { return await save(null) }
    },
    async signOut() {
      try { if (session) await request('/auth/logout', { method: 'POST' }) } finally { await save(null) }
    },
  }
}
