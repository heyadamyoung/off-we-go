import { useEffect, useState } from 'react'
import { loginHandoffFromUrl, nativeAppUrlFromUrl } from '../../../mobile-auth-core'
import { authCallbackMessage } from '../../../auth-messages-core'
import { Screen } from '../../../shared/ui/brand'

export default function NativeLoginHandoff() {
  /* Read once the page is in a browser: the SPA shell is rendered without one,
     and reading the location while rendering takes the whole route down. */
  const [current, setCurrent] = useState('')
  useEffect(() => setCurrent(window.location.href), [])
  if (!current) return null
  const appUrl = nativeAppUrlFromUrl(current)
  const token = appUrl ? loginHandoffFromUrl(appUrl) : null
  const rawError = String(new URL(current).searchParams.get('error') || '').slice(0, 200) || null
  const error = rawError ? authCallbackMessage(rawError) : null
  const webUrl = token ? `/auth/callback?token=${encodeURIComponent(token)}` : '/'

  return (
    <Screen>
      <h1 className="text-2xl font-extrabold tracking-tight">
        {error
          ? 'Sign-in did not finish'
          : appUrl
            ? 'Open Off We Go'
            : 'That sign-in return is invalid'}
      </h1>
      <p className="hint max-w-[380px]">
        {error ||
          (appUrl
            ? 'Your secure sign-in returned in this browser. Tap below to finish in the Off We Go app.'
            : 'Start a fresh secure sign-in from the Off We Go app and try again.')}
      </p>
      <div className="mt-2 flex flex-col items-stretch gap-2 self-stretch">
        {appUrl && (
          <a className="btn btn-accent justify-center py-3" href={appUrl}>
            Open Off We Go app
          </a>
        )}
        <a className="btn btn-ghost justify-center py-3" href={webUrl}>
          {appUrl ? 'Sign in on the website instead' : 'Go to Off We Go'}
        </a>
      </div>
    </Screen>
  )
}
