import { useEffect, useState } from 'react'
import HoldToDelete from '../../../shared/ui/hold-delete'
import Icon from '../../../shared/ui/icon'
import usePaperSource from '../model/use-paper-source'
import type { Paper } from '../../../papers-core'

/* The paper, as the thing itself.
 *
 * At a desk with a queue behind you the document IS the interface. Everything
 * else on this screen — the name, the note, the tidying — is for a quiet
 * evening at home, and it had been sitting on top of the one thing anybody
 * actually needs. So the tidying is here, behind one control, on the screen
 * where you can see which document you are renaming: a list of text inputs
 * where every row looks like every other row is how a boarding pass ends up
 * named after a hotel.
 *
 * A picture is drawn as a picture, as big as the screen allows, on white.
 * White because the thing being shown is very often a barcode, and a scanner
 * reading a dark-themed page through a phone's glass is a scanner that beeps
 * twice and a queue that does not move. The app's own dark theme is right
 * everywhere except here.
 *
 * A PDF is handed over rather than pretended at: drawing one needs a renderer
 * this app does not carry, and a viewer that shows a grey box with a spinner
 * would be worse than the browser's own.
 */

export interface PaperEditing {
  rename: (paper: Paper, changes: { name?: string; note?: string }) => void
  remove: (paper: Paper) => void
}

export default function PaperView({
  paper,
  editing,
  onClose,
}: {
  paper: Paper
  /** absent for a follower, and for anybody who cannot edit this trip */
  editing?: PaperEditing
  onClose: () => void
}) {
  const [tidying, setTidying] = useState(false)
  const [broken, setBroken] = useState(false)
  /* The copy on the phone before the one on the network. Everything about this
     screen assumes no signal; asking the internet for bytes already in the
     offline pack would make that assumption a lie. */
  const { url, held } = usePaperSource(paper.src)

  /* Escape closes it — claimed in the capture phase and marked answered, which
     is how everything that opens over the trip takes the key. The screen's own
     ladder unwinds newest-first and would otherwise close the view behind this
     one as well, so the document would vanish AND the panel with it. See
     use-trip-escape. */
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  return (
    <div className="ppview" role="dialog" aria-label={paper.name}>
      <div className="ppvbar">
        <span className="min-w-0">
          <b className="block truncate text-sm">{paper.name}</b>
          <span className="block truncate text-[11px] text-muted">{paper.for}</span>
        </span>
        <span className="flex flex-none items-center gap-1">
          {editing && (
            <button
              className={tidying ? 'ppvx is-on hitslop' : 'ppvx hitslop'}
              onClick={() => setTidying(!tidying)}
              title="Rename, note or remove"
              aria-label="Rename, note or remove"
              aria-pressed={tidying}>
              <Icon n="pencil" s={15} />
            </button>
          )}
          <button className="ppvx hitslop" onClick={onClose} title="Close" aria-label="Close">
            <Icon n="x" s={16} w={2} />
          </button>
        </span>
      </div>

      {editing && tidying && <Tidy paper={paper} editing={editing} onClose={onClose} />}

      {paper.showable ? (
        <div className="ppvpaper">
          {/* Nothing is drawn until the cache has answered, and a picture that
              will not load says so: a broken-image glyph at a gate reads as
              "the app is wrong" rather than "this one was never kept". */}
          {url && !broken && <img src={url} alt={paper.name} onError={() => setBroken(true)} />}
          {broken && (
            <p className="ppvgone">
              This one would not load{held ? '' : ' — there is no copy of it on this phone yet'}.
            </p>
          )}
        </div>
      ) : (
        <div className="ppvfile">
          <p className="m-0 text-sm text-muted">
            This one is a {paper.mime.includes('pdf') ? 'PDF' : 'file'} — it opens in its own
            viewer.
          </p>
          <a className="btn pri" href={url || paper.src} target="_blank" rel="noreferrer">
            Open {paper.name}
          </a>
        </div>
      )}
    </div>
  )
}

/* Renaming what you can see. The document stays on screen above this, which is
   the whole reason it is here rather than in a list. */
function Tidy({
  paper,
  editing,
  onClose,
}: {
  paper: Paper
  editing: PaperEditing
  onClose: () => void
}) {
  const [name, setName] = useState(paper.name)
  const [note, setNote] = useState(paper.note || '')

  const commitName = () => {
    const next = name.trim()
    if (!next) setName(paper.name)
    else if (next !== paper.name) editing.rename(paper, { name: next })
  }
  const commitNote = () => {
    if (note.trim() !== (paper.note || '')) editing.rename(paper, { note: note.trim() })
  }

  return (
    <div className="ppvtidy">
      <input
        className="ppvin"
        value={name}
        aria-label="Document name"
        onChange={event => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={event => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
      />
      <input
        className="ppvin ppvin-note"
        value={note}
        placeholder="A note — “QR is on the last page”"
        aria-label="Document note"
        onChange={event => setNote(event.target.value)}
        onBlur={commitNote}
        onKeyDown={event => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
      />
      <HoldToDelete
        what={paper.name}
        onDelete={() => {
          /* The screen is about a document that is about to stop existing. */
          editing.remove(paper)
          onClose()
        }}
      />
    </div>
  )
}
