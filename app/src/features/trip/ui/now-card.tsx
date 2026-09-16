import { memo } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import { dueLabel } from '../../../live-stop-progress-core'
import type { TripNow } from '../../../trip-now-core'
import type { Notice } from '../../../trip-notices-core'
import type { Stop, StopDocument, TripPhoto } from '../../../shared/model/types'

/* What is happening, opened out.
 *
 * The map screen has always been reactive: it answers what you tap and says
 * nothing on its own. The capsule over the map was the one exception and it
 * only ever had room for a line — "At the harbour", "Heading to the ferry" —
 * so the map showed where everything was and nothing said what was going on.
 *
 * This is that capsule with the rest of the answer under it, still floating
 * over the map, still one tap from gone. The map stays the hero; it simply
 * stops being the only thing that talks.
 *
 * Two people read it. Somebody at home wants to know where the party is, what
 * they have done today and what they have photographed. Somebody standing in
 * the rain wants to know what is next and whether they are late for it. Same
 * facts either way — trip-now-core gathers them once — and the difference is
 * only which of them leads.
 */
/* The same glyphs the documents sheet uses: a boarding pass should look like
   the same object wherever it turns up. */
const PAPER_GLYPH: Record<string, string> = {
  pass: '🎫',
  ticket: '🎟️',
  receipt: '🧾',
  visa: '🛂',
  other: '📄',
}

export default memo(function NowCard({
  now,
  notices,
  headline,
  meta,
  travelling,
  onNotice,
  onStop,
  onFollow,
  onPhotos,
  onClose,
}: {
  now: TripNow<Stop, TripPhoto>
  /** What has happened since this person last looked. Empty for a traveller:
      they were there. */
  notices: readonly Notice[]
  /** The live layer's own line, which is already the best first sentence. */
  headline: string
  meta?: string
  /** Whether this person is on the trip or following it. */
  travelling: boolean
  /** Show a stop on the map, which is where the answer lives. */
  onStop: (stop: Stop) => void
  /** Take the map to the live dot and keep it there — what the pill used to
      do silently, said out loud. */
  onFollow: () => void
  /** Open the gallery at today's newest. */
  onPhotos: (photo: TripPhoto) => void
  /** Go to where a notice happened, and count the lot of them as read. */
  onNotice: (notice: Notice) => void
  onClose: () => void
}) {
  const { next, done, fresh, todayCount } = now
  const late = next?.inMinutes != null && next.inMinutes < 0
  const countdown = dueLabel(next?.inMinutes ?? null)

  /* Next leads for whoever is travelling and today's pictures lead for whoever
     is watching — but both are here either way. A follower who wants to know
     where they are going next should not have to guess, and a traveller does
     look at their own photographs. */
  /* The papers for the next thing, on the next thing. A boarding pass filed
     under the flight it belongs to is filed correctly and reached slowly, and
     the one moment it is wanted is the moment somebody is at a desk with a
     queue behind them. */
  const papers: StopDocument[] = next?.stop.documents || []

  const nextBlock = next && (
    <div className="ncnext">
      <button className="ncrow" onClick={() => onStop(next.stop)}>
        <span className="ncwhen">
          <Icon n="chev" s={12} />
        </span>
        <span className="ncbody">
          <b>{next.stop.name}</b>
          <span className={late ? 'nclate' : 'ncmeta'}>
            {countdown ? (late ? `due ${countdown}` : countdown) : 'Later on the trip'}
          </span>
        </span>
      </button>
      {travelling && papers.length > 0 && (
        <div className="ncpapers">
          {papers.map(doc => (
            <a
              key={doc.id}
              className="ncpaper"
              href={doc.src}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${doc.name}`}>
              <span aria-hidden="true">{PAPER_GLYPH[doc.kind] || PAPER_GLYPH.other}</span>
              <span className="truncate">{doc.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )

  const photoBlock = fresh.length > 0 && (
    <div className="ncshots">
      <div className="ncshead">
        <span>Today’s pictures</span>
        <span className="ncmeta tnum">{todayCount}</span>
      </div>
      <div className="ncstrip">
        {fresh.map(photo => (
          <button key={photo.id} className="ncshot" onClick={() => onPhotos(photo)}>
            <MediaThumb item={photo} w={240} h={240} badge={16} now />
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <section className="nowcard glass" aria-label="What is happening now">
      <div className="nchead">
        <button className="ncgo" onClick={onFollow}>
          <b aria-live="polite">{headline}</b>
          {meta && <span className="ncmeta">{meta}</span>}
        </button>
        <button className="ncx hitslop" onClick={onClose} title="Close" aria-label="Close">
          <Icon n="x" s={14} w={2} />
        </button>
      </div>

      {/* What was missed, first and once. Somebody who opened the app because
          their phone buzzed came for this line, and burying it under the
          itinerary would be answering a different question. */}
      {notices.length > 0 && (
        <div className="ncnew">
          {notices.slice(0, 4).map(notice => (
            <button key={notice.id} className="ncnrow" onClick={() => onNotice(notice)}>
              <span className={notice.kind === 'arrived' ? 'ncndot on' : 'ncndot'} />
              <span className="ncbody">
                <b>{notice.title}</b>
              </span>
            </button>
          ))}
          {notices.length > 4 && (
            <span className="ncmeta">and {notices.length - 4} more since you last looked</span>
          )}
        </div>
      )}

      {travelling ? (
        <>
          {nextBlock}
          {photoBlock}
        </>
      ) : (
        <>
          {photoBlock}
          {nextBlock}
        </>
      )}

      {done.length > 0 && (
        <div className="ncdone">
          <span className="ncmeta">Done today</span>
          <span className="ncdonelist">
            {done.map(stop => (
              <button key={stop.id} className="ncchip" onClick={() => onStop(stop)}>
                {stop.name}
              </button>
            ))}
          </span>
        </div>
      )}

      {/* An honest empty rather than a card that opens onto nothing: a trip
          that has not started yet has a headline and no day behind it. */}
      {!next && !done.length && !fresh.length && !notices.length && (
        <p className="ncempty">Nothing has happened today yet.</p>
      )}
    </section>
  )
})
