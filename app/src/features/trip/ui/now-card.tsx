import { memo } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import { dueLabel } from '../../../live-stop-progress-core'
import { papersOfStop, type Paper } from '../../../papers-core'
import type { FlightTone } from '../../../flight-day-core'
import type { TripNow } from '../../../trip-now-core'
import type { Notice } from '../../../trip-notices-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'

/* The live leg on a travel day: the ticket's headline and its columns in a
   line, and the papers for it — one tap from the Travel tab where the whole
   ticket is. */
export interface LegBlock {
  title: string
  headline: string
  tone: FlightTone
  /** "T3 · gate E19 · Zone 3 · Desks 13–20" */
  line: string
  /** "Schiphol · 2 min ago", or null when no board has spoken */
  source: string | null
  papers: Paper[]
  /** the make-it meter, a line a person: where they are against the doors */
  pace: PaceLine[]
  /** "9 min from the door to the gate, counted", when the board says how far */
  walkNote: string | null
}

export interface PaceLine {
  name: string
  state: 'here' | 'ok' | 'tight' | 'late'
  /** "10 min away · on pace" */
  words: string
  /** "leave by 11:30", or null once they are here */
  leaveBy: string | null
}

const PACE_DOT: Record<PaceLine['state'], string> = {
  here: 'bg-ok',
  ok: 'bg-ok',
  tight: 'bg-accent',
  late: 'bg-tight',
}

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
/* The same glyphs the papers list uses: a boarding pass should look like the
   same object wherever it turns up. */
const DOT: Record<string, string> = {
  flight: 'ncndot on',
  landed: 'ncndot land',
  arrived: 'ncndot on',
  photos: 'ncndot',
}

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
  leg = null,
  travelling,
  onNotice,
  onStop,
  onFollow,
  onPhotos,
  onPaper,
  onTravel,
  onClose,
}: {
  now: TripNow<Stop, TripPhoto>
  /** the live leg on a travel day, leading the card; null on any other day */
  leg?: LegBlock | null
  /** the Travel tab, where the whole ticket is */
  onTravel?: () => void
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
  /** Open the paper itself, full screen — the same view every other door uses. */
  onPaper: (paper: Paper) => void
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
  const papers: Paper[] = next ? papersOfStop(next.stop) : []

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
          {/* In the app, not out of it. These used to be links into another
              tab, which is a tab with no offline copy of the document in it —
              so the one paper somebody taps from the map was the one paper
              that needed signal. */}
          {papers.map(paper => (
            <button
              key={paper.id}
              className="ncpaper"
              onClick={() => onPaper(paper)}
              aria-label={`Open ${paper.name}`}>
              <span aria-hidden="true">{PAPER_GLYPH[paper.kind] || PAPER_GLYPH.other}</span>
              <span className="truncate">{paper.name}</span>
            </button>
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
              {/* A landing is the loudest thing on the list and reads that way:
                  a family who have watched a plane cross an ocean are not
                  looking for it among the photographs. */}
              <span className={DOT[notice.kind] || 'ncndot'} />
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

      {/* The leg first on a travel day, for everybody: the traveller is in
          the queue it describes and the follower is waiting on it. */}
      {leg && (
        <div className="ncleg" data-tone={leg.tone}>
          <button className="ncrow" onClick={onTravel}>
            <span className="ncwhen" aria-hidden="true">
              ✈
            </span>
            <span className="ncbody">
              <b>{leg.title}</b>
              <span className="nclegline">{leg.headline}</span>
              {leg.line && <span className="ncmeta">{leg.line}</span>}
              {leg.source && <span className="ncmeta ncsrc">{leg.source}</span>}
            </span>
          </button>
          {/* The make-it meter, where the pill opens rather than boxed over
              the map: everyone's distance against the doors, and when
              whoever is still away has to leave. */}
          {leg.pace.length > 0 && (
            <div className="ncpace flex flex-col gap-1 px-3 pb-2 text-[11px] text-muted">
              {leg.walkNote && <span className="text-faint">{leg.walkNote}</span>}
              {leg.pace.map(person => (
                <div key={person.name} className="flex items-center gap-2">
                  <span
                    className={'h-1.5 w-1.5 flex-none rounded-full ' + PACE_DOT[person.state]}
                  />
                  <b className="text-ink">{person.name}</b>
                  <span>{person.words}</span>
                  {person.leaveBy && (
                    <span className="mkleave ml-auto font-mono text-faint">{person.leaveBy}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {travelling && leg.papers.length > 0 && (
            <div className="ncpapers">
              {leg.papers.map(paper => (
                <button
                  key={paper.id}
                  className="ncpaper"
                  onClick={() => onPaper(paper)}
                  aria-label={`Open ${paper.name}`}>
                  <span aria-hidden="true">{PAPER_GLYPH[paper.kind] || PAPER_GLYPH.other}</span>
                  <span className="truncate">{paper.name}</span>
                </button>
              ))}
            </div>
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
      {!next && !done.length && !fresh.length && !notices.length && !leg && (
        <p className="ncempty">Nothing has happened today yet.</p>
      )}
    </section>
  )
})
