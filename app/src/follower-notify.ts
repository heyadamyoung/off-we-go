import { LocalNotifications } from '@capacitor/local-notifications'
import { isNativeApp } from './mobile'
import type { Notice } from './trip-notices-core'

/* Waking somebody who is following along.
 *
 * Local, on this device, for the same reason the travel-day countdowns are:
 * there is no push. Sending to a phone that is not running the app needs an
 * Apple push key and a Firebase project, a token per device on the server and
 * a sender beside it — none of which exist here, and none of which can be
 * conjured from this side of the App Store. So this reaches a follower whose
 * app is alive, and the notices themselves reach everybody else the moment
 * they open it, which is the part that works on every platform.
 *
 * When the certificates do exist, nothing in trip-notices-core changes: the
 * same rows go out through a different door.
 */

/* Stable per happening, so re-scheduling cannot double one up. The same hash
   the segment deadlines use, for the same reason. */
const idFor = (key: string) => {
  let hash = 0
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash) % 2_000_000_000
}

/* What is worth the buzz first. A family who have been watching a plane
   cross an ocean are not reading past the landing; somebody reaching a place
   is bigger news than the pictures they took when they got there; and the
   pictures are usually of the place anyway.

   Its own function because it is the only judgement in this file — the rest is
   a plugin call that cannot run outside a phone. */
const RANK: Record<Notice['kind'], number> = { landed: 0, arrived: 1, photos: 2 }

export function worthWaking(notices: readonly Notice[]): Notice[] {
  /* Stable within a rank: two landings stay in the order the day flew them. */
  return [...notices].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))
}

/** At most this many at once: a day's catching-up is not a day's buzzing. */
const AT_ONCE = 3

export async function tellTheFollower(notices: readonly Notice[]): Promise<number> {
  if (!isNativeApp || !notices.length) return 0
  try {
    const granted = await LocalNotifications.checkPermissions()
    if (granted.display !== 'granted') return 0
    const going = worthWaking(notices).slice(0, AT_ONCE)
    const rest = notices.length - going.length
    await LocalNotifications.schedule({
      notifications: going.map((notice, nth) => ({
        id: idFor(notice.id),
        title: notice.title,
        body:
          nth === going.length - 1 && rest > 0
            ? `and ${rest} more on the trip`
            : 'Open to see where',
      })),
    })
    return going.length
  } catch {
    /* Notifications are a courtesy. The list is in the app either way, and
       that is the part somebody actually came for. */
    return 0
  }
}
