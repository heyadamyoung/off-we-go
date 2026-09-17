import Icon from './icon'
import type { Paper } from '../../papers-core'

/* One document, as a thing you tap.
 *
 * The row IS the paper: anywhere on it opens the document itself. What stood
 * here before was a filing cabinet — an editable name, an editable note, a
 * hold-to-delete, and a thirty-two-pixel chevron to actually see the thing —
 * which is the right furniture for a quiet evening at home and exactly the
 * wrong furniture for standing at a gate.
 *
 * Shared on purpose. The Papers tab, a travel leg's card and a stop's sheet
 * are three doors to the same document, and three doors that look and behave
 * differently is how somebody learns not to trust any of them.
 */

const KIND_GLYPH: Record<string, string> = {
  pass: '🎫',
  ticket: '🎟️',
  receipt: '🧾',
  visa: '🛂',
  other: '📄',
}

export default function PaperRow({
  paper,
  /** the one this screen was opened for: it gets the room to say so */
  lead,
  /** on a leg's own card the row already knows what it is for */
  showFor = true,
  onOpen,
}: {
  paper: Paper
  lead?: boolean
  showFor?: boolean
  onOpen: (paper: Paper) => void
}) {
  return (
    <button className={lead ? 'pprow lead' : 'pprow'} onClick={() => onOpen(paper)}>
      <span className="ppglyph" aria-hidden="true">
        {KIND_GLYPH[paper.kind] || KIND_GLYPH.other}
      </span>
      <span className="ppbody">
        <b>{paper.name}</b>
        {showFor && <span className="ppfor">{paper.for}</span>}
        {paper.note && <span className="ppnote">{paper.note}</span>}
      </span>
      <span className="ppgo" aria-hidden="true">
        <Icon n="chevron" s={14} />
      </span>
    </button>
  )
}
