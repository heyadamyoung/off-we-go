import { segmentName } from './segments-core'

/* What the airports have said since somebody last looked, pure.
 *
 * The server writes a board's news onto the leg as its status note — "AC872
 * has moved from gate C34 to D12. Toronto Pearson, 13:30." — and the card
 * shows it. This decides which of those notes is worth a buzz on the phone:
 * a note that CHANGED on a leg the phone already knew. The first sight of a
 * leg is the card's to show, not a notification's; a note going quiet is
 * nothing; and a note that is the same as last time has been said. Kept as
 * a difference against a map of what was seen, the same way the trip
 * notices are, so it needs nothing the server does not already send. */

export interface WordOf {
  segmentId: string
  title: string
  body: string
}

/** Each leg's note the last time the phone looked. */
export type SaidNotes = Record<string, string | null>

export interface LegWithWord {
  id: string
  carrier?: string | null
  number?: string | null
  fromName?: string
  toName?: string
  statusNote?: string | null
}

export function airportsWord(
  previous: SaidNotes | null,
  segments: readonly LegWithWord[],
): { said: WordOf[]; notes: SaidNotes } {
  const notes: SaidNotes = {}
  const said: WordOf[] = []
  for (const segment of segments) {
    const note = segment.statusNote?.trim() || null
    notes[segment.id] = note
    if (!previous || !(segment.id in previous)) continue
    if (!note || previous[segment.id] === note) continue
    said.push({
      segmentId: segment.id,
      title:
        segment.number || segment.carrier
          ? segmentName({ carrier: segment.carrier, number: segment.number })
          : 'Your flight',
      body: note,
    })
  }
  return { said, notes }
}
