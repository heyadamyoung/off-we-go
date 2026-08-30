export function magicTokenFromUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.pathname !== '/auth/callback') return null
    const token = url.searchParams.get('token')
    return token && token.length >= 32 ? token : null
  } catch { return null }
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


