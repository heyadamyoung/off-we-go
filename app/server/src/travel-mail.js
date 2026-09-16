/* Which of somebody's emails are about this trip's legs.
 *
 * The connector has been able to read a mailbox for a while, and the assistant
 * knows what to do with an airline email when it finds one — but only when
 * somebody thinks to ask. So the delay reaches the trip when the traveller
 * already suspects there is one, which is the moment they least need telling.
 *
 * This is the half that can be done without a model and without guessing: of
 * the mail that has arrived, which pieces are plainly about a leg of this
 * journey. What the email SAYS is left to whoever reads it. That line is
 * deliberate — an app that quietly rewrites somebody's departure time from its
 * own reading of an email is an app that will one day move a flight because a
 * newsletter mentioned one.
 *
 * And it is narrow on purpose. It matches on the flight number and the booking
 * reference the traveller themselves typed into the leg: the things that are
 * theirs and specific. Reading a mailbox on a timer is a serious thing to do
 * to somebody, and the only defensible version of it looks for the handful of
 * strings that could only be about their own journey.
 */

/* Only around the legs that matter. A flight three months out does not need
   its mailbox watched, and one a fortnight past is somebody else's problem —
   the window is "near enough that a change would still change what you do". */
export const WATCH_BEFORE_MS = 48 * 60 * 60 * 1000
export const WATCH_AFTER_MS = 6 * 60 * 60 * 1000

const at = value => {
  const when = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(when) ? when : null
}

/* "KL 677", "KL677" and "kl-677" are one flight to everybody except a string
   comparison. Folded to letters and digits so the comparison agrees. */
const fold = value =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

/**
 * The strings that could only be about this leg: its flight or service number,
 * and the booking reference somebody typed onto it.
 *
 * A carrier on its own is never one of them. "KLM" matches a fare sale.
 */
export function marksOf(segment) {
  const marks = []
  const number = fold(segment?.number)
  if (number.length >= 3) {
    marks.push(number)
    /* The carrier and number together, for a subject that writes them apart —
       "KLM 677" folds to the same thing either way, so this only adds reach
       when the leg's own number field holds the digits alone. */
    const carrier = fold(segment?.carrier)
    if (carrier && !number.startsWith(carrier)) marks.push(carrier + number)
  }
  /* A booking reference is six characters of nothing else in the world. Below
     that it is a word, and a word matches half a mailbox. */
  const ref = fold(segment?.ref)
  if (ref.length >= 5) marks.push(ref)
  return marks
}

/**
 * Which legs each message is plainly about.
 *
 * @param {{segments?: readonly object[], messages?: readonly object[], now?: number,
 *          since?: number|null}} input
 * @returns {Array<{segmentId: string, messageId: string, subject: string, received: string,
 *          from: string|null, mark: string}>}
 */
export function travelMail({ segments = [], messages = [], now = Date.now(), since = null } = {}) {
  const watched = []
  for (const segment of segments) {
    const departs = at(segment?.departsAt ?? segment?.departs_at)
    if (departs === null) continue
    if (departs - now > WATCH_BEFORE_MS) continue
    if (now - departs > WATCH_AFTER_MS) continue
    const marks = marksOf(segment)
    if (marks.length) watched.push({ segment, marks })
  }
  if (!watched.length) return []

  const found = []
  for (const message of messages) {
    const when = at(message?.received)
    /* Nothing that arrived before the last look: this runs on a timer, and a
       job that re-reports the same email every few minutes is a job somebody
       turns off. */
    if (since !== null && (when === null || when <= since)) continue
    const haystack = fold(`${message?.subject ?? ''} ${message?.preview ?? ''}`)
    if (!haystack) continue
    for (const { segment, marks } of watched) {
      const mark = marks.find(one => haystack.includes(one))
      if (!mark) continue
      found.push({
        segmentId: segment.id,
        messageId: message.id,
        /* The subject as written, never the body. What a traveller needs to
           decide whether to open it, and nothing more of their mail than
           that. */
        subject: String(message.subject ?? '').slice(0, 200),
        received: message.received ?? null,
        from: message.from?.address ?? message.from?.name ?? null,
        mark,
      })
      break
    }
  }
  /* Newest first: the last thing the airline said is the thing that is true. */
  return found.sort((a, b) => (at(b.received) ?? 0) - (at(a.received) ?? 0))
}
