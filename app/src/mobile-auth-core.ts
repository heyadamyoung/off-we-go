function parsedLoginUrl(value: string) {
  try {
    const url = new URL(value)
    const token = url.searchParams.get('token')
    const error = String(url.searchParams.get('error') || '').slice(0, 200)
    return token && token.length >= 32
      ? { url, token, error: null }
      : error
        ? { url, token: null, error }
        : null
  } catch {
    return null
  }
}

export function loginHandoffFromUrl(value: string) {
  const parsed = parsedLoginUrl(value)
  if (!parsed?.token) return null
  const { url, token } = parsed
  const isUniversalLink =
    url.protocol === 'https:' &&
    (url.pathname === '/auth/callback' || url.pathname === '/auth/native')
  const isCustomScheme = url.protocol === 'wayfare:' && url.hostname === 'auth'
  return isUniversalLink || isCustomScheme ? token : null
}

export function browserLoginHandoffFromUrl(value: string) {
  const parsed = parsedLoginUrl(value)
  return parsed?.url.protocol === 'https:' && parsed.url.pathname === '/auth/callback'
    ? parsed.token
    : null
}

export function nativeAppUrlFromUrl(value: string) {
  const parsed = parsedLoginUrl(value)
  if (
    !parsed ||
    !['http:', 'https:'].includes(parsed.url.protocol) ||
    parsed.url.pathname !== '/auth/native'
  )
    return null
  const destination = new URL('wayfare://auth')
  if (parsed.token) destination.searchParams.set('token', parsed.token)
  else destination.searchParams.set('error', parsed.error || 'unknown')
  return destination.href
}

export interface NativeLoginState {
  status: 'exchanging' | 'complete' | 'error'
  error: string | null
}

interface NativeAuthClient {
  exchangeLoginHandoff(token: string): Promise<unknown>
}

export async function completeNativeLogin(
  value: string,
  authClient: NativeAuthClient | null | undefined,
  onState: (state: NativeLoginState) => void = () => {},
) {
  const parsed = parsedLoginUrl(value)
  const isNativeReturn =
    parsed &&
    ((parsed.url.protocol === 'https:' &&
      ['/auth/callback', '/auth/native'].includes(parsed.url.pathname)) ||
      (parsed.url.protocol === 'wayfare:' && parsed.url.hostname === 'auth'))
  if (isNativeReturn && parsed.error) {
    onState({ status: 'error', error: parsed.error })
    return true
  }
  const token = loginHandoffFromUrl(value)
  if (!token || !authClient) return false
  onState({ status: 'exchanging', error: null })
  try {
    await authClient.exchangeLoginHandoff(token)
    onState({ status: 'complete', error: null })
    return true
  } catch (caught) {
    const error =
      caught instanceof Error && caught.message ? caught.message : 'Could not finish signing in'
    onState({ status: 'error', error })
    return false
  }
}
