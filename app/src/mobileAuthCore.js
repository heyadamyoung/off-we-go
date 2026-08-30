export function magicTokenFromUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.pathname !== '/auth/callback') return null
    const token = url.searchParams.get('token')
    return token && token.length >= 32 ? token : null
  } catch { return null }
}
