function parsedMagicUrl(value) {
  try {
    const url = new URL(value)
    const token = url.searchParams.get('token')
    return token && token.length >= 32 ? { url, token } : null
  } catch { return null }
}

export function magicTokenFromUrl(value) {
  const parsed = parsedMagicUrl(value)
  if (!parsed) return null
  const { url, token } = parsed
  const isUniversalLink = url.protocol === 'https:' &&
    (url.pathname === '/auth/callback' || url.pathname === '/auth/native')
  const isCustomScheme = url.protocol === 'wayfare:' && url.hostname === 'auth'
  return isUniversalLink || isCustomScheme ? token : null
}

export function browserMagicTokenFromUrl(value) {
  const parsed = parsedMagicUrl(value)
  return parsed?.url.protocol === 'https:' && parsed.url.pathname === '/auth/callback'
    ? parsed.token : null
}

export function nativeAppUrlFromUrl(value) {
  const parsed = parsedMagicUrl(value)
  if (!parsed || !['http:', 'https:'].includes(parsed.url.protocol) || parsed.url.pathname !== '/auth/native') return null
  const destination = new URL('wayfare://auth')
  destination.searchParams.set('token', parsed.token)
  return destination.href
}

export interface NativeLoginState {
  status: 'exchanging' | 'complete' | 'error'
  error: string | null
}

interface NativeAuthClient {
  exchangeMagicToken(token: string): Promise<unknown>
}

export async function completeNativeLogin(
  value: string,
  authClient: NativeAuthClient | null | undefined,
  onState: (state: NativeLoginState) => void = () => {},
) {
  const token = magicTokenFromUrl(value)
  if (!token || !authClient) return false
  onState({ status: 'exchanging', error: null })
  try {
    await authClient.exchangeMagicToken(token)
    onState({ status: 'complete', error: null })
    return true
  } catch (caught) {
    const error = caught instanceof Error && caught.message
      ? caught.message : 'Could not finish signing in'
    onState({ status: 'error', error })
    return false
  }
}


