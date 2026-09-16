import { memo } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import { dueLabel } from '../../../live-stop-progress-core'
import type { TripNow } from '../../../trip-now-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'

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
export default memo(function NowCard({
  now,
  headline,
  meta,
  travelling,
  onStop,
  onFollow,
  onPhotos,
  onClose,
}: {
  now: TripNow<Stop, TripPhoto>
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
  onClose: () => void
}) {
  const { next, done, fresh, todayCount } = now
  const late = next?.inMinutes != null && next.inMinutes < 0
  const countdown = dueLabel(next?.inMinutes ?? null)

  /* Next leads for whoever is travelling and today's pictures lead for whoever
     is watching — but both are here either way. A follower who wants to know
     where they are going next should not have to guess, and a traveller does
     look at their own photographs. */
  const nextBlock = next && (
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
      {!next && !done.length && !fresh.length && (
        <p className="ncempty">Nothing has happened today yet.</p>
      )}
    </section>
  )
})
