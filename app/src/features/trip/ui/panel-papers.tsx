import { useMemo } from 'react'
import PaperRow from '../../../shared/ui/paper-row'
import { papersOnTrip, type Paper } from '../../../papers-core'
import type { Segment } from '../../../segments-core'
import type { Stop } from '../../../shared/model/types'

/* Everything you are carrying, in one place.
 *
 * The feature this app already had, minus the front door. Documents have been
 * storable, cached before anybody opens them, and reachable — through the stop
 * or the leg they hang off, which means through remembering which one that
 * was. On a real trip nobody used it, because at a desk with a queue behind
 * you, "which leg did I file the boarding pass on" is a slower question than
 * searching your email.
 *
 * So this is a list, in the order somebody reaches for them, and the row is
 * the document: see paper-row, which the leg's own card and the stop's sheet
 * now draw too.
 */

export interface PapersProps {
  stops: Stop[]
  segments?: readonly Segment[]
  /** the page's own clock, so "next" means next */
  now?: number
  /** open the paper itself, full screen */
  onOpen: (paper: Paper) => void
}

export default function PanelPapers({ stops, segments, now = Date.now(), onOpen }: PapersProps) {
  const papers = useMemo(() => papersOnTrip({ stops, segments }, now), [stops, segments, now])

  if (!papers.length)
    return (
      <p className="hint p-4">
        Nothing filed yet. Tickets, passes and bookings live here — add one on a stop or a travel
        leg, or ask the assistant to pull it out of your email.
      </p>
    )

  /* The first one is the one somebody opened this screen for: it is for the
     next thing that happens. It gets the room to say so. */
  const [first, ...rest] = papers
  return (
    <div className="ppl">
      <PaperRow paper={first} lead onOpen={onOpen} />
      {rest.map(paper => (
        <PaperRow key={paper.id} paper={paper} onOpen={onOpen} />
      ))}
    </div>
  )
}
