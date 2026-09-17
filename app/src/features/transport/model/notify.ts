import { LocalNotifications } from '@capacitor/local-notifications'
import { isNativeApp } from '../../../mobile'
import { DEADLINE_LABELS, type Segment, type SegmentDeadlines } from '../../../segments-core'

/* Travel-day deadlines as phone notifications: the feature that works with
   the phone in a pocket. Local, per device, no server push — whoever carries
   this phone is on this trip, so they get its countdowns. Rescheduled
   wholesale whenever segments change; ids are stable hashes so yesterday's
   schedule is simply replaced, never doubled. */

const WORTH_WAKING = new Set<keyof SegmentDeadlines>([
  'checkinOpensAt',
  'bagsCloseAt',
  'boardingAt',
])

const idFor = (segmentId: string, key: string) => {
  let hash = 0
  for (const ch of segmentId + ':' + key) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash) % 2_000_000_000
}

let lastIds: number[] = []

/* What an airport's board just said about a leg — a gate that moved, a
   delay, a cancellation — said on the phone as it happens. Decided in
   flight-word-core; this is the plugin call, which cannot run outside a
   phone. Ids are hashes of the words, so the same word is never said twice. */
export async function sayTheAirportsWord(
  words: readonly { segmentId: string; title: string; body: string }[],
) {
  if (!isNativeApp || !words.length) return
  try {
    const granted = await LocalNotifications.checkPermissions()
    if (granted.display !== 'granted') return
    await LocalNotifications.schedule({
      notifications: words.map(word => ({
        id: idFor(word.segmentId, 'word:' + word.body),
        title: word.title,
        body: word.body,
        schedule: { at: new Date(Date.now() + 1000) },
      })),
    })
  } catch {
    /* a courtesy; the card says it anyway */
  }
}

export async function scheduleSegmentNotifications(segments: Segment[]) {
  if (!isNativeApp) return
  try {
    const granted = await LocalNotifications.checkPermissions()
    if (granted.display !== 'granted') return
    if (lastIds.length) {
      await LocalNotifications.cancel({ notifications: lastIds.map(id => ({ id })) })
    }
    const now = Date.now()
    const upcoming = []
    for (const segment of segments) {
      const label = [segment.carrier, segment.number].filter(Boolean).join(' ') || segment.toName
      for (const [key, at] of Object.entries(segment.deadlines || {})) {
        if (!WORTH_WAKING.has(key as keyof SegmentDeadlines)) continue
        const when = new Date(at as string).getTime()
        if (!Number.isFinite(when) || when <= now) continue
        upcoming.push({
          id: idFor(segment.id, key),
          title: `${DEADLINE_LABELS[key as keyof SegmentDeadlines]} — ${label}`,
          body: `${segment.fromName} → ${segment.toName}`,
          schedule: { at: new Date(when) },
        })
      }
    }
    lastIds = upcoming.map(n => n.id)
    if (upcoming.length) await LocalNotifications.schedule({ notifications: upcoming })
  } catch {
    /* notifications are a courtesy; the card still counts down */
  }
}
