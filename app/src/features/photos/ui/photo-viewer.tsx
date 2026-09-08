import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MapCanvas } from '../../map'
import Icon from '../../../shared/ui/icon'
import Img, { SEEN, srcFor } from '../../../shared/ui/img'
import MediaThumb from '../../../shared/ui/media-thumb'
import PhotoDetails from './photo-details'
import VideoFrame from './video-frame'
import { durationLabel } from '../../../mobile-videos-core'
import { validLngLat } from '../../../shared/lib/geo'
import type { MapTint } from '../../map'
import type {
  Coordinates,
  Id,
  Person,
  Stop,
  TripComment,
  TripPhoto,
} from '../../../shared/model/types'

/* One heart, drawn filled: rose in the chrome when liked, white in the burst
   over the photograph — the modern like, never an orange block. */
const HEART_PATH =
  'M12 21c-.4 0-.8-.15-1.1-.44C6.6 16.8 2.5 13.2 2.5 9.1 2.5 6.3 4.7 4 7.4 4c1.8 0 3.4 1 4.6 2.6C13.2 5 14.8 4 16.6 4c2.7 0 4.9 2.3 4.9 5.1 0 4.1-4.1 7.7-8.4 11.46-.3.29-.7.44-1.1.44Z'

function FilledHeart({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" role="presentation">
      <path fill={color} d={HEART_PATH} />
    </svg>
  )
}

interface PhotoViewerProps {
  list: TripPhoto[]
  index: number
  setIndex: (index: number) => void
  onClose: () => void
  stops: Stop[]
  byName: (name: string) => Person
  comments: Record<Id, TripComment[]>
  addComment: (photoId: Id, body: string) => void
  likes: Set<Id>
  toggleLike: (photoId: Id) => void
  theme: string
  tint?: MapTint | null
  me: Person
  canEdit: boolean
  onPhotoChange: (id: Id, fields: Partial<TripPhoto>) => void
  onPhotoDelete: (id: Id) => void
  onCommentDelete: (photoId: Id, commentId: Id) => void
}

function PhotoViewer({
  list,
  index,
  setIndex,
  onClose,
  stops,
  byName,
  comments,
  addComment,
  likes,
  toggleLike,
  theme,
  tint,
  me,
  canEdit,
  onPhotoChange,
  onPhotoDelete,
  onCommentDelete,
}: PhotoViewerProps) {
  const photo = list[index]
  const stop = stops.find(s => s.id === photo?.stopId)
  const [draft, setDraft] = useState('')
  const [details, setDetails] = useState(false)
  const [burst, setBurst] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    /* Escape is not handled here: useTripEscape owns the whole stack, and a
       second listener closed the sheet behind this one at the same time. */
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return
      if (e.key === 'ArrowLeft') setIndex((index - 1 + list.length) % list.length)
      if (e.key === 'ArrowRight') setIndex((index + 1) % list.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, list.length, setIndex])

  // Warm the neighbours so arrow-key paging is instant instead of a blank beat.
  useEffect(() => {
    if (list.length < 2) return
    for (const i of [(index + 1) % list.length, (index - 1 + list.length) % list.length]) {
      const p = list[i]
      /* Warming a film would pull tens of megabytes nobody has asked to
         watch; its poster is already in the strip. */
      if (!p || p.kind === 'video') continue
      const url = srcFor(p, 1200, 900)
      if (SEEN.has(url)) continue
      const im = new Image()
      im.decoding = 'async'
      im.onload = () => SEEN.add(url)
      im.src = url
    }
  }, [index, list])

  const mapPoint: Coordinates | null =
    stop && validLngLat(stop.lng, stop.lat)
      ? [stop.lng, stop.lat]
      : validLngLat(photo?.lng, photo?.lat)
        ? [photo!.lng!, photo!.lat!]
        : null
  const mini = useMemo(
    () => (mapPoint ? { center: mapPoint, zoom: 16 } : null),

    [mapPoint?.[0], mapPoint?.[1]],
  )
  const noop = useCallback(() => {}, [])

  if (!photo) return null
  const video = photo.kind === 'video'
  const length = video ? durationLabel(photo.durationMs) : null
  const author = byName(photo.by)
  const here = list.filter(p => p.stopId === photo.stopId)
  const contributors = [...new Set(here.map(p => p.by))]
  const cmts = comments[photo.id] || []
  const liked = likes.has(photo.id)
  /* The wire carries ISO instants; a person gets their locale's words. A
     fresh upload once printed 2026-09-04T17:16:41.000Z under its author. */
  const taken = (() => {
    const at = new Date(photo.when || '')
    return Number.isFinite(at.getTime())
      ? at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : photo.when
  })()
  /* "Say something nice, adam.young1986." — an email localpart is not a
     name; personalise only when a human first name is actually known. */
  const firstName = /^[A-Za-z]{2,}$/.test(me.name?.split(' ')[0] || '')
    ? me.name.split(' ')[0]
    : null

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const t = draft.trim()
    if (!t) return
    addComment(photo.id, t)
    setDraft('')
  }

  return (
    <div className="viewer">
      {details && canEdit && (
        <PhotoDetails
          photo={photo}
          stops={stops}
          onClose={() => setDetails(false)}
          onChange={onPhotoChange}
          onDelete={onPhotoDelete}
        />
      )}
      <div className="vstage">
        <div className="vtop">
          <div className="who">
            <img src={author.avatar} alt="" />
            <div>
              <b>{photo.by}</b>
              <span>
                {taken}
                {stop ? ' · ' + stop.name : ''}
              </span>
            </div>
          </div>
          <div className="acts">
            {canEdit && (
              <button
                onClick={() => setDetails(true)}
                title={video ? 'Edit video details' : 'Edit photo details'}>
                <Icon n="pencil" s={16} c="#f2f4f8" />
              </button>
            )}
            <button
              className={liked ? 'liked' : ''}
              onClick={() => {
                if (!liked) setBurst(value => value + 1)
                toggleLike(photo.id)
              }}
              title={liked ? 'Unlike' : 'Like'}>
              {liked ? (
                <FilledHeart size={18} color="#ff4d6d" />
              ) : (
                <Icon n="heart" s={17} c="#f2f4f8" />
              )}
            </button>
            <button title="Download">
              <Icon n="download" s={17} c="#f2f4f8" />
            </button>
            <button onClick={onClose} title="Close (Esc)">
              <Icon n="x" s={17} c="#f2f4f8" w={2} />
            </button>
          </div>
        </div>

        <div className="vbody">
          {list.length > 1 && (
            <button
              className="vnav p"
              onClick={() => setIndex((index - 1 + list.length) % list.length)}>
              <Icon n="chevl" s={20} c="#fff" w={2} />
            </button>
          )}
          {/* The photograph is the like button: a tap hearts it and answers
              with the big heart, the way every thumb already expects. A tap
              never UN-likes — losing a heart to a stray touch would sting;
              the chrome's heart stays the deliberate way back.

              A film is not: on a video the tap belongs to play, pause and the
              scrubber, so the heart in the chrome is its only way in. */}
          {video ? (
            <VideoFrame photo={photo} />
          ) : (
            <button
              type="button"
              className="vmaintap"
              aria-label={liked ? 'Liked' : 'Like this photo'}
              onClick={() => {
                if (!liked) toggleLike(photo.id)
                setBurst(value => value + 1)
              }}>
              <Img className="main" item={photo} w={1200} h={900} alt={photo.caption} eager />
            </button>
          )}
          {burst > 0 && (
            <span
              key={burst}
              className="vheart"
              aria-hidden="true"
              onAnimationEnd={() => setBurst(0)}>
              <FilledHeart size={96} color="#ff4d6d" />
            </span>
          )}
          {list.length > 1 && (
            <button className="vnav n" onClick={() => setIndex((index + 1) % list.length)}>
              <Icon n="chev" s={20} c="#fff" w={2} />
            </button>
          )}
        </div>

        {/* One quiet line under the photo: the caption if it has one, and the
            count. Who, when and where already live in the top bar — repeating
            them here (with raw coordinates, of all things) was chrome eating
            the photograph. */}
        <div className="vcap">
          <h2>{photo.caption || ''}</h2>
          <div className="ct">
            {length ? `${length} · ` : ''}
            {index + 1} of {list.length}
          </div>
        </div>

        <div className="vfilm">
          {list.map((p, i) => (
            <button key={p.id} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
              <MediaThumb item={p} w={300} h={200} badge={20} />
            </button>
          ))}
        </div>
      </div>

      <div className="vside">
        <div className="vminimap">
          {mini && (
            <MapCanvas
              theme={theme}
              tint={tint}
              interactive={false}
              view={mini}
              onView={noop}
              route={[]}
              stops={stop ? [stop] : []}
              photos={here}
              highlight={photo.id}
            />
          )}
          <div className="cap">
            <b>{mini ? 'Taken here' : 'Location unavailable'}</b>
            <span>
              {mini
                ? stop
                  ? stop.name
                  : 'On the move'
                : `This ${video ? 'video' : 'photo'} has no coordinates`}
              {mini ? ` · ${here.length} here` : ''}
            </span>
          </div>
        </div>

        {stop && (
          <div className="vinfo">
            <div className="k">
              {stop.status === 'now'
                ? 'Happening now'
                : stop.status === 'done'
                  ? 'Visited'
                  : 'Planned'}{' '}
              · {stop.time}
            </div>
            <h3>{stop.name}</h3>
            <p>{stop.note}</p>
          </div>
        )}

        <div className="vcontrib">
          <div className="st">
            {contributors.map(n => (
              <img key={n} src={byName(n).avatar} alt="" />
            ))}
          </div>
          <div className="t">
            <b>{contributors.join(', ')}</b>
            <span>contributed photos and videos here</span>
          </div>
          <span className="n">{here.length}</span>
        </div>

        <div className="vcomments">
          {cmts.length === 0 && (
            <div className="vnone">No notes yet. Be the first to say something.</div>
          )}
          {cmts.map(c => (
            <div className={'cmt' + (c.pending ? ' pending' : '')} key={c.id}>
              <img src={byName(c.by).avatar} alt="" />
              <div className="t">
                <b>{c.by}</b>
                <em>{c.when}</em>
                <p>{c.text}</p>
              </div>
              {(canEdit || c.by === me.name) && !c.pending && (
                <button
                  className="cdel"
                  title="Delete"
                  onClick={() => onCommentDelete(photo.id, c.id)}>
                  <Icon n="x" s={12} w={2} />
                </button>
              )}
            </div>
          ))}
        </div>

        <form className="vinput" onSubmit={submit}>
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={firstName ? `Say something nice, ${firstName}…` : 'Say something nice…'}
          />
          <button type="submit" disabled={!draft.trim()}>
            <Icon n="send" s={16} c="#fff" />
          </button>
        </form>
      </div>
    </div>
  )
}

export default PhotoViewer
