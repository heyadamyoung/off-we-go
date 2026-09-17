import { registerPlugin } from '@capacitor/core'
import { useEffect, useRef } from 'react'
import {
  sameActivity,
  travelActivity,
  type ActivityAttributes,
  type ActivityState,
  type TravelActivity,
} from '../../../live-activity-core'
import { isNativeApp, mobilePlatform } from '../../../mobile'
import type { Segment, Traveller } from '../../../segments-core'
import type { LiveFix } from '../../../shared/model/types'

/* The travel-day card on the Lock Screen, kept true.
 *
 * Every minute, and every time the legs or the family's positions change,
 * the card for this moment is worked out; only when it differs from the one
 * that is up does anything cross the bridge. The countdown ticks by itself.
 *
 * iOS only, and only in the app: the Dynamic Island and the Lock Screen are
 * Apple's, and a browser tab has neither. Everywhere else this is a no-op
 * rather than a refusal, like the deadline notifications next door.
 *
 * While the app is open or tracking in the background — which on a travel
 * day it is, for the live map — updates arrive from here. A phone with the
 * app killed still shows the card and its countdown but will not learn of a
 * delay until the app runs again; that is what server push is for, and this
 * plugin is written so that arrives as a pushType rather than a rewrite.
 */

interface LiveActivityPlugin {
  start(options: { attributes: ActivityAttributes; state: ActivityState }): Promise<{ id: string }>
  update(options: { state: ActivityState }): Promise<void>
  end(options: { state?: ActivityState }): Promise<void>
  current(): Promise<{ id: string | null; segmentId: string | null }>
}

const LiveActivity =
  isNativeApp && mobilePlatform === 'ios'
    ? registerPlugin<LiveActivityPlugin>('LiveActivity')
    : null

export default function useLiveActivity({
  segments,
  travellers,
  fixes,
  now,
}: {
  segments: readonly Segment[]
  travellers: readonly Traveller[]
  fixes: readonly LiveFix[]
  now: number
}) {
  const shown = useRef<TravelActivity | null>(null)
  /* One call at a time: an update racing the start it follows would land on
     a card that is not there yet. */
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!LiveActivity) return
    const next = travelActivity(segments, travellers, fixes, now)
    if (sameActivity(shown.current, next)) return
    const previous = shown.current
    shown.current = next
    const plugin = LiveActivity
    queue.current = queue.current.then(async () => {
      try {
        if (!next) {
          if (previous) await plugin.end({})
        } else if (next.state.phase === 'landed') {
          /* The card that was up says Landed and lingers; a card that was
             never up does not appear only to say so. */
          if (previous?.attributes.segmentId === next.attributes.segmentId)
            await plugin.end({ state: next.state })
          else await plugin.end({})
        } else if (previous?.attributes.segmentId === next.attributes.segmentId) {
          await plugin.update({ state: next.state })
        } else {
          await plugin.start(next)
        }
      } catch {
        /* Switched off in Settings, or an older iOS. The screen still counts
           down; the card was a courtesy. */
      }
    })
  }, [segments, travellers, fixes, now])
}
