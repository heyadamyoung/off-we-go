const SESSION_KEY = 'wayfare-session'

export function createApiClient({ baseUrl, storage, fetch: fetchFn }) {
  let session = null
  const listeners = new Set()
  try { session = JSON.parse(storage.getItem(SESSION_KEY) || 'null') } catch { session = null }

  const emit = () => listeners.forEach(listener => listener(session))
  const save = value => {
    session = value
    if (value) storage.setItem(SESSION_KEY, JSON.stringify(value))
    else storage.removeItem(SESSION_KEY)
    emit()
    return session
  }

  const request = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) }
    if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`
    let body = options.body
    if (body != null && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Blob)) {
      headers['content-type'] ||= 'application/json'
      body = JSON.stringify(body)
    }
    const response = await fetchFn(baseUrl.replace(/\/$/, '') + path, { ...options, headers, body })
    if (response.status === 401 && !path.startsWith('/auth/')) save(null)
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
      return save({ accessToken: result.accessToken, user: result.user })
    },
    async restore() {
      if (!session?.accessToken) return null
      try {
        const result = await request('/auth/session')
        return save({ ...session, user: result.user })
      } catch { return save(null) }
    },
    async signOut() {
      try { if (session) await request('/auth/logout', { method: 'POST' }) } finally { save(null) }
    },
  }
}
