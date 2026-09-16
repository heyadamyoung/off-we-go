/* The mailbox, looking without being asked.
 *
 * Everything here is arranged around one judgement: reading somebody's mail on
 * a timer is a serious thing to do to them. The app has already deleted a
 * feature for doing something nobody asked for, and this is the same shape of
 * risk in a more useful coat — so the narrowness is the design, not a caveat
 * attached to it.
 *
 * It looks only for mailboxes whose owner turned this on. It looks only around
 * legs departing soon, because a change to a flight three months out does not
 * change what anybody does today. It searches for the flight number and the
 * booking reference the traveller typed onto that leg themselves. It keeps the
 * subject line and never the body. And it does not act on what it finds: the
 * email is pointed at, not interpreted, because an app that rewrites a
 * departure time from its own reading of an email is an app that will one day
 * move a flight because a newsletter mentioned one.
 *
 * What it buys is the whole difference between a delay reaching the trip when
 * the airline sends it and a delay reaching the trip when somebody already
 * suspected there was one.
 */

import { event, span } from './tracing.js'
import { marksOf, travelMail } from './travel-mail.js'

/* Long enough that a mailbox is not hammered, short enough that a gate change
   an hour before boarding is not news after boarding. */
export const LOOK_EVERY_MS = 10 * 60 * 1000

/* Nothing older than this is ever fetched, even on a first look. A mailbox
   that has just been told to watch should not hand back a fortnight of
   airline mail about flights already taken. */
const FIRST_LOOK_MS = 24 * 60 * 60 * 1000

/**
 * One pass: every watching mailbox, against the legs of the trips its owner
 * can edit.
 *
 * Failures are per mailbox. One account whose token has expired must not stop
 * the others being looked at, and the reader already marks a dead connection
 * as needing a reconnect.
 */
export async function watchTravelMail({ repository, reader, now = Date.now(), log = null }) {
  const watching = await repository.mailboxesWatchingTravel()
  if (!watching.length) return { looked: 0, found: 0 }

  let found = 0
  for (const mailbox of watching) {
    try {
      const since = mailbox.travelSeenAt
        ? new Date(mailbox.travelSeenAt).getTime()
        : now - FIRST_LOOK_MS
      const segments = await repository.segmentsForMailbox(mailbox.userId, { now })
      if (!segments?.length) {
        /* Nothing near enough to be worth a look is still a look: moving the
           watermark stops the next pass re-reading the same window. */
        await repository.markTravelMailSeen(mailbox.id, new Date(now).toISOString())
        continue
      }

      /* One search per string, on the leg's own strings. Asking for everything
         and filtering here would pull a mailbox across the wire to answer a
         question about six characters of it.

         Gathered by id, because a delay notice naming both the flight and the
         booking reference comes back from both searches and is still one
         email — counted twice it would be filed twice and read as two things
         having happened. */
      const messages = new Map()
      for (const segment of segments) {
        for (const mark of marksOf(segment)) {
          const page = await reader.listMessages(mailbox.userId, {
            mailboxId: mailbox.id,
            search: mark,
            top: 10,
          })
          for (const message of page?.messages || page || [])
            if (message?.id && !messages.has(message.id)) messages.set(message.id, message)
        }
      }

      const about = travelMail({ segments, messages: [...messages.values()], now, since })
      if (about.length) found += await repository.noteSegmentMail(mailbox.id, about)
      await repository.markTravelMailSeen(mailbox.id, new Date(now).toISOString())
    } catch (error) {
      /* Named, not swallowed: a watch that silently stopped working is a watch
         that quietly stops keeping its promise. */
      log?.warn?.({ err: error, mailbox: mailbox.id }, 'travel mail watch failed')
      event('travel.watch.failed', { 'mailbox.id': mailbox.id, 'error.message': error?.message })
    }
  }
  return { looked: watching.length, found }
}

/** The timer, started once on boot beside the others. */
export function startTravelWatch({ repository, reader, log, every = LOOK_EVERY_MS }) {
  const run = () =>
    span('travel.watch', {}, () => watchTravelMail({ repository, reader, log }))
      .then(({ looked, found }) => {
        if (found) log?.info?.({ evt: 'travel.watch', looked, found }, 'travel mail noticed')
      })
      .catch(error => log?.warn?.({ err: error }, 'travel mail watch failed'))
  const timer = setInterval(run, every)
  timer.unref?.()
  return { run, stop: () => clearInterval(timer) }
}
