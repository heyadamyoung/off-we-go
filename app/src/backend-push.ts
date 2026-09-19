import { authClient } from './backend-base'

/* The push subscription: the address the browser's push service gave this
   phone, handed to the server, and taken back. */

export interface PushSubscriptionShape {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function loadPushKey(): Promise<string> {
  const result = await authClient.request<{ key: string }>('/push/key')
  return result.key
}

export async function savePushSubscription(
  subscription: PushSubscriptionShape,
  userAgent?: string,
): Promise<void> {
  await authClient.request('/push/subscriptions', {
    method: 'PUT',
    body: { ...subscription, userAgent },
  })
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await authClient.request('/push/subscriptions', { method: 'DELETE', body: { endpoint } })
}
