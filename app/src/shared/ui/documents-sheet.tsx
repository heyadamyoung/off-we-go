import { useRef, useState, type ChangeEvent } from 'react'
import HoldToDelete from './hold-delete'
import Icon from './icon'
import Sheet from './sheet'

/* The paperwork manager, one for both homes: a travel leg's passes and a
   stop's tickets open into the same sheet. Every document is a row — open
   it, rename it in place, note where the QR hides, hold to delete it — and
   Add takes the next file. Pure hands: whoever opens the sheet wires the
   backend; this component only knows documents. */

export interface ManagedDocument {
  id: string
  name: string
  kind: string
  mime: string
  note?: string | null
  src?: string
}

const KIND_GLYPH: Record<string, string> = {
  pass: '🎫',
  ticket: '🎟️',
  receipt: '🧾',
  visa: '🛂',
  other: '📄',
}

export default function DocumentsSheet({
  title,
  documents,
  canEdit,
  onClose,
  onAdd,
  onEdit,
  onRemove,
}: {
  title: string
  documents: ManagedDocument[]
  canEdit: boolean
  onClose: () => void
  onAdd?: (file: File) => void
  onEdit?: (id: string, changes: { name?: string; note?: string }) => void
  onRemove?: (id: string) => void
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
      {documents.length === 0 && (
        <p className="m-0 text-xs text-muted">
          No papers here yet — tickets, passes and bookings all live in one place.
          {canEdit ? ' Add one below, or ask the AI to pull it out of your email.' : ''}
        </p>
      )}
      {documents.map(doc => (
        <DocumentRow key={doc.id} doc={doc} canEdit={canEdit} onEdit={onEdit} onRemove={onRemove} />
      ))}
    </Sheet>
  )
}

function DocumentRow({
  doc,
  canEdit,
  onEdit,
  onRemove,
}: {
  doc: ManagedDocument
  canEdit: boolean
  onEdit?: (id: string, changes: { name?: string; note?: string }) => void
  onRemove?: (id: string) => void
}) {
  const [name, setName] = useState(doc.name)
  const [note, setNote] = useState(doc.note || '')
  const commitName = () => {
    const next = name.trim()
    if (!next) setName(doc.name)
    else if (next !== doc.name) onEdit?.(doc.id, { name: next })
  }
  const commitNote = () => {
    if (note.trim() !== (doc.note || '')) onEdit?.(doc.id, { note: note.trim() })
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-raised p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{KIND_GLYPH[doc.kind] || KIND_GLYPH.other}</span>
        {canEdit ? (
          <input
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5
                       py-1 text-sm font-semibold outline-none focus:border-accent
                       focus:bg-canvas"
            value={name}
            aria-label="Document name"
            onChange={event => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={event => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
        ) : (
          <b className="min-w-0 flex-1 truncate text-sm">{doc.name}</b>
        )}
        <a
          className="grid size-8 flex-none place-items-center rounded-lg text-muted
                     hover:bg-raised2 hover:text-ink"
          href={doc.src}
          target="_blank"
          rel="noreferrer"
          title="Open"
          aria-label={`Open ${doc.name}`}>
          <Icon n="chevron" s={14} />
        </a>
      </div>
      {canEdit ? (
        <input
          className="rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-xs
                     text-muted outline-none placeholder:text-faint focus:border-accent
                     focus:bg-canvas"
          value={note}
          placeholder="Add a note — “QR is on the last page”"
          aria-label="Document note"
          onChange={event => setNote(event.target.value)}
          onBlur={commitNote}
          onKeyDown={event => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
      ) : (
        doc.note && <p className="m-0 px-1.5 text-xs text-muted">{doc.note}</p>
      )}
      {canEdit && onRemove && (
        <div className="flex justify-end">
          <HoldToDelete what={doc.name} onDelete={() => onRemove(doc.id)} />
        </div>
      )}
    </div>
  )
}
