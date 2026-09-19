import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { decidePush, HOLD_MS, flightCard } from './card.js'

/* Once a minute, beside the flight watch: every leg in the window, every
   phone on that leg's trip, and for each the card it should be showing
   against the card it was last shown. The rule is in card.js; this is the
   clock, the addresses and the bookkeeping. */

export const PUSH_EVERY_MS = 60_000
/** How far ahead a leg is looked at: the watch's own horizon. */
export const PUSH_BEFORE_MS = 30 * 3600_000
/** How far behind: a cancellation or a landing still on the lock screen. */
export const PUSH_AFTER_MS = 12 * 3600_000

/* The card itself can say "mute this leg" and report whether it was opened,
   and a service worker has no session to say it with. Each push carries a
   token signed for its own id instead: enough to speak about that one push,
   and about nothing else. */
export const signSend = (secret, id) =>
  createHmac('sha256', String(secret)).update(`push-send:${id}`).digest('base64url')

export function sendTokenValid(secret, id, token) {
  const expected = Buffer.from(signSend(secret, id))
  const given = Buffer.from(String(token || ''))
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export const legTag = segmentId => `leg-${segmentId}`

/** Where the card opens: the trip's Travel tab. */
export const cardUrl = leg => `/trips/${encodeURIComponent(leg.tripSlug || leg.tripId)}?view=travel`

/**
 * @param {object} deps
 * @param {object} deps.repository  pushLegs, pushRecipients, savePushCard, clearPushCard, recordPushSend, deletePushSubscription, notePushFailure
 * @param {{send: (subscription: object, payload: object) => Promise<{ok: boolean, gone?: boolean, status?: number}>}} deps.sender
 * @param {string} deps.secret
 * @param {number} [deps.now]
 * @param {object} [deps.log]
 */
export async function pushTick({ repository, sender, secret, now = Date.now(), log = null }) {
  const legs = await repository.pushLegs({ now, beforeMs: PUSH_BEFORE_MS, afterMs: PUSH_AFTER_MS })
  const stats = { legs: legs.length, sent: 0, woken: 0, cleared: 0, gone: 0, failed: 0 }
  for (const leg of legs) {
    try {
      /* A change is told once it has stood for a while: a gate that went
         A, B, A while the phone was not told is nothing to tell. */
      const changedAt = leg.changedAt ? Date.parse(leg.changedAt) : 0
      if (now - changedAt < HOLD_MS) continue
      const next = flightCard(leg, leg.info, now)
      const people = await repository.pushRecipients(leg.tripId, leg.id)
      for (const person of people) {
        if (person.muted) continue
        const previous = person.said || null
        if (!previous && !next) continue
        const role = person.role === 'viewer' ? 'follower' : 'traveller'
        const decision = decidePush({
          previous,
          next,
          role,
          woken: person.woken || 0,
          wokenToday: person.wokenToday || 0,
        })
        if (!decision) continue
        const tag = legTag(leg.id)
        if (decision.send === 'clear') {
          const result = await sender.send(person, { tag, clear: true })
          await repository.clearPushCard(person.subscriptionId, leg.id)
          stats.cleared += 1
          if (result.gone) {
            await repository.deletePushSubscription(person.subscriptionId)
            stats.gone += 1
          }
          continue
        }
        const sendId = randomUUID()
        const payload = {
          tag,
          title: role === 'follower' && next.who ? `${next.who} · ${next.title}` : next.title,
          body: next.body,
          silent: !decision.audible,
          kind: decision.kind,
          url: cardUrl(leg),
          sendId,
          token: signSend(secret, sendId),
        }
        const result = await sender.send(person, payload)
        if (result.gone) {
          await repository.deletePushSubscription(person.subscriptionId)
          stats.gone += 1
          continue
        }
        if (!result.ok) {
          await repository.notePushFailure(person.subscriptionId)
          stats.failed += 1
          log?.warn?.(
            { evt: 'push.failed', status: result.status ?? null, segment: leg.id },
            'a push was not delivered',
          )
          continue
        }
        await repository.savePushCard(person.subscriptionId, leg.id, {
          said: next,
          woken: (person.woken || 0) + (decision.audible ? 1 : 0),
        })
        await repository.recordPushSend({
          id: sendId,
          subscriptionId: person.subscriptionId,
          segmentId: leg.id,
          kind: decision.kind,
          audible: decision.audible,
        })
        stats.sent += 1
        if (decision.audible) stats.woken += 1
      }
    } catch (error) {
      log?.warn?.({ err: error, segment: leg.id }, 'push failed for a leg')
    }
  }
  return stats
}

/** The timer, started once on boot beside the flight watch. */
export function startPushTick({ repository, sender, secret, log, every = PUSH_EVERY_MS }) {
  let running = null
  const run = () => {
    if (running) return running
    running = pushTick({ repository, sender, secret, log })
      .then(stats => {
        if (stats.sent || stats.cleared || stats.gone || stats.failed) {
          log?.info?.({ evt: 'push.tick', ...stats }, 'the phones were told')
        }
      })
      .catch(error => log?.warn?.({ err: error }, 'push tick failed'))
      .finally(() => {
        running = null
      })
    return running
  }
  const timer = setInterval(run, every)
  timer.unref?.()
  return { run, stop: () => clearInterval(timer) }
}
