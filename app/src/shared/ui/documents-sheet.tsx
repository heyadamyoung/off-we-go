import { useRef, type ChangeEvent } from 'react'
import PaperRow from './paper-row'
import Sheet from './sheet'
import type { Paper } from '../../papers-core'

/* A stop's papers, as a list you tap.
 *
 * This used to be a filing cabinet: every document a row of text inputs, a
 * hold-to-delete and a thirty-two-pixel chevron that opened the file in
 * another tab — so the smallest target on the row was the only one that
 * produced the document, and the largest was the one that renamed it. At a
 * hotel desk that is backwards. Renaming and removing live on the paper's own
 * screen now, where you can see which paper you are renaming; this is a list
 * and a way to add one.
 *
 * A travel leg draws its papers on the card itself rather than behind a sheet,
 * because the card is already open and already about that leg.
 */
export default function DocumentsSheet({
  title,
  papers,
  canEdit,
  onClose,
  onOpen,
  onAdd,
}: {
  title: string
  papers: Paper[]
  canEdit: boolean
  onClose: () => void
  onOpen: (paper: Paper) => void
  onAdd?: (file: File) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onAdd?.(file)
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        canEdit && onAdd ? (
          <>
            <input
              ref={picker}
              type="file"
              accept="image/*,application/pdf"
              hidden
              onChange={pick}
            />
            <button className="mini mini-accent" onClick={() => picker.current?.click()}>
              Add a document
            </button>
          </>
        ) : undefined
      }>
      {papers.length === 0 && (
        <p className="m-0 text-xs text-muted">
          No papers here yet — tickets, passes and bookings all live in one place.
          {canEdit ? ' Add one below, or ask the AI to pull it out of your email.' : ''}
        </p>
      )}
      {/* What each one is for is the title of this sheet. */}
      {papers.map(paper => (
        <PaperRow key={paper.id} paper={paper} showFor={false} onOpen={onOpen} />
      ))}
    </Sheet>
  )
}
