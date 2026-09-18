import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/* The moments a page comes back.

   To the foreground from another app, online after the terminal's Wi-Fi let
   go, out of the back-forward cache: each is a moment when whatever the page
   was holding open may be dead and whatever it was told may be stale. The
   native shell says so through its own event as well as the document's,
   since a WebView put to sleep does not always say so as a document; a
   listener that hears both is told twice, which is why the caller coalesces. */
export function onWake(run: () => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
  const visible = () => {
    if (document.visibilityState === 'visible') run()
  }
  const shown = (event: PageTransitionEvent) => {
    if (event.persisted) run()
  }
  document.addEventListener('visibilitychange', visible)
  window.addEventListener('online', run)
  window.addEventListener('pageshow', shown)
  const native = Capacitor.isNativePlatform() ? NativeApp.addListener('resume', run) : null
  return () => {
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('online', run)
    window.removeEventListener('pageshow', shown)
    native?.then(handle => handle.remove()).catch(() => {})
  }
}
