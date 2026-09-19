import { useCallback, useEffect, useState } from 'react'
import { hasBackend, isSample } from '../../../backend'
import {
  loadPushKey,
  removePushSubscription,
  savePushSubscription,
  type PushSubscriptionShape,
} from '../../../backend-push'
import { isNativeApp } from '../../../mobile'
import { PUSH_OFFER, REMEMBER_PUSH, applicationServerKey, pushSupport } from '../../../push-core'
import type { Id } from '../../../shared/model/types'
import { useToast } from '../../../shared/ui/toast'

/* One quiet line under the tickets: get told on this phone, or stop. Drawn
   only where it can be true — a browser with push, on a real trip, with the
   shell worker registered — so an iPhone in Safari or the native app never
   sees an offer it cannot take. Remembered per browser; on every visit a
   phone that said yes hands its address over again, because push services
   rotate them and a stale one is a phone that goes quiet. */

type State = 'hidden' | 'off' | 'on' | 'busy'

const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(REMEMBER_PUSH, '1')
    else localStorage.removeItem(REMEMBER_PUSH)
  } catch {
    /* private mode: the offer simply asks again next time */
  }
}

const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER_PUSH) === '1'
  } catch {
    return false
  }
}

const asShape = (subscription: PushSubscription): PushSubscriptionShape | null => {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  return json.endpoint && p256dh && auth
    ? { endpoint: json.endpoint, keys: { p256dh, auth } }
    : null
}

export default function PushOffer({ tripId }: { tripId: Id }) {
  const toast = useToast()
  const [state, setState] = useState<State>('hidden')

  const renew = useCallback(async () => {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    const shape = subscription && asShape(subscription)
    if (!shape) {
      remember(false)
      setState('off')
      return
    }
    await savePushSubscription(shape, navigator.userAgent).catch(() => {})
  }, [])

  useEffect(() => {
    const support = pushSupport({
      native: isNativeApp,
      sample: isSample(tripId),
      backend: hasBackend,
      worker: import.meta.env.PROD,
      pushManager: typeof window !== 'undefined' && 'PushManager' in window,
      notifications: typeof Notification !== 'undefined',
      permission: typeof Notification !== 'undefined' ? Notification.permission : undefined,
    })
    if (support !== 'ready') {
      setState('hidden')
      return
    }
    if (remembered()) {
      setState('on')
      void renew()
    } else setState('off')
  }, [tripId, renew])

  const turnOn = async () => {
    setState('busy')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast('Notifications were not allowed for this site', 'warning')
        setState('off')
        return
      }
      const key = await loadPushKey()
      const registration = await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(key),
        }))
      const shape = asShape(subscription)
      if (!shape) throw new Error('The browser gave no address to push to')
      await savePushSubscription(shape, navigator.userAgent)
      remember(true)
      setState('on')
      toast('This phone will be told about the travel day')
    } catch {
      toast('Notifications could not be turned on here — try again in a moment', 'error')
      setState('off')
    }
  }

  const turnOff = async () => {
    setState('busy')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await removePushSubscription(subscription.endpoint).catch(() => {})
        await subscription.unsubscribe().catch(() => {})
      }
    } finally {
      remember(false)
      setState('off')
      toast('This phone will not be told')
    }
  }

  if (state === 'hidden') return null
  const on = state === 'on'
  return (
    <div className="pushoffer mt-1 flex items-center justify-between gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-[11px] text-muted">
      <span className="min-w-0">{on ? PUSH_OFFER.on : PUSH_OFFER.off}</span>
      <button
        className="mini flex-none"
        disabled={state === 'busy'}
        onClick={() => void (on ? turnOff() : turnOn())}>
        {on ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  )
}
