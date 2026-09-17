import { useMemo } from 'react'
import Icon from '../../../shared/ui/icon'
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
 * So this is a list, in the order somebody reaches for them, and the row IS
 * the document: tapping anywhere on it opens the thing. The sheet that existed
 * before was a filing cabinet — an editable name, an editable note, a
 * hold-to-delete, and a thirty-two-pixel chevron to actually see the paper.
 * That is the right furniture for tidying up at home and exactly the wrong
 * furniture for standing at a gate.
 */

const KIND_GLYPH: Record<string, string> = {
  pass: '🎫',
  ticket: '🎟️',
  receipt: '🧾',
  visa: '🛂',
  other: '📄',
}

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

function PaperRow({
  paper,
  lead,
  onOpen,
}: {
  paper: Paper
  lead?: boolean
  onOpen: (paper: Paper) => void
}) {
  return (
    <button className={lead ? 'pprow lead' : 'pprow'} onClick={() => onOpen(paper)}>
      <span className="ppglyph" aria-hidden="true">
        {KIND_GLYPH[paper.kind] || KIND_GLYPH.other}
      </span>
      <span className="ppbody">
        <b>{paper.name}</b>
        <span className="ppfor">{paper.for}</span>
        {paper.note && <span className="ppnote">{paper.note}</span>}
      </span>
      <span className="ppgo" aria-hidden="true">
        <Icon n="chevron" s={14} />
      </span>
    </button>
  )
}
