import { useEffect } from 'react'
import Icon from '../../../shared/ui/icon'
import type { Paper } from '../../../papers-core'

/* The paper, as the thing itself.
 *
 * At a desk with a queue behind you the document IS the interface. Everything
 * else on this screen — the name, the note, the tidying — is for a quiet
 * evening at home, and it had been sitting on top of the one thing anybody
 * actually needs.
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
export default function PaperView({ paper, onClose }: { paper: Paper; onClose: () => void }) {
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
        <button className="ppvx hitslop" onClick={onClose} title="Close" aria-label="Close">
          <Icon n="x" s={16} w={2} />
        </button>
      </div>

      {paper.showable ? (
        <div className="ppvpaper">
          <img src={paper.src} alt={paper.name} />
        </div>
      ) : (
        <div className="ppvfile">
          <p className="m-0 text-sm text-muted">
            This one is a {paper.mime.includes('pdf') ? 'PDF' : 'file'} — it opens in its own
            viewer.
          </p>
          <a className="btn pri" href={paper.src} target="_blank" rel="noreferrer">
            Open {paper.name}
          </a>
        </div>
      )}
    </div>
  )
}
