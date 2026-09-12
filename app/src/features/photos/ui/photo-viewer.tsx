import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Icon from '../../../shared/ui/icon'
import Img, { SEEN, srcFor } from '../../../shared/ui/img'
import { useToast } from '../../../shared/ui/toast'
import MediaThumb from '../../../shared/ui/media-thumb'
import PhotoDetails from './photo-details'
import PhotoFilm from './photo-film'
import PhotoTop, { FilledHeart } from './photo-top'
import PhotoSide from './photo-side'
import PhotoZoom from './photo-zoom'
import VideoFrame from './video-frame'
import { durationLabel } from '../../../mobile-videos-core'
import { pageBy, warmAround } from '../../../swipe-core'
import usePhotoShare from '../model/use-photo-share'
import useViewerGestures from '../model/use-viewer-gestures'

/* How many photographs either side to have ready. Three covers a fast thumb
   — the strip already holds one each way, so this is really about the ones
   after that — and stops well short of a trip. */
const WARM_REACH = 3
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

interface PhotoViewerProps {
  tripId: Id
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
  tripId,
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
  /* The photograph on its own, big. The viewer is a good place to read a trip
     and a poor place to look at a picture — caption, comments and a map are
     all competing with it for a phone screen. */
  const [zoomed, setZoomed] = useState(false)
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

  /* A few either way, nearest first, on every page turn.

     The two beside this one are already on the screen in the strip, so what
     this buys is the one after that: somebody paging quickly through a day's
     photographs is always one ahead of what the strip holds, and without this
     they out-run it and watch each picture arrive. Not the whole trip —
     that is a data allowance and a browser's memory spent on photographs
     nobody has asked to see. */
  useEffect(() => {
    for (const i of warmAround(index, list.length, WARM_REACH)) {
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
  /* A tap never UN-likes — losing a heart to a stray touch would sting; the
     chrome's heart stays the deliberate way back. Reads the set rather than
     closing over a `liked` computed further down, so the gesture handlers can
     be declared before the render body needs them. */
  const like = useCallback(() => {
    const id = photo?.id
    if (!id) return
    if (!likes.has(id)) toggleLike(id)
    setBurst(value => value + 1)
  }, [likes, toggleLike, photo?.id])

  const notify = useToast()
  const { share, sharing } = usePhotoShare(tripId, photo, notify)

  const openZoom = useCallback(() => setZoomed(true), [])
  const gestures = useViewerGestures({
    index,
    length: list.length,
    setIndex,
    onLike: like,
    onOpen: openZoom,
  })

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
        <PhotoTop
          photo={photo}
          author={author}
          stop={stop}
          taken={taken}
          video={video}
          liked={liked}
          canEdit={canEdit}
          sharing={sharing}
          onDetails={() => setDetails(true)}
          onLike={() => {
            if (!liked) setBurst(value => value + 1)
            toggleLike(photo.id)
          }}
          onShare={share}
          onClose={onClose}
        />

        {/* The stage reads the finger. On the whole stage rather than on the
            photograph, because a phone's picture rarely fills it and a swipe
            that starts in the letterbox is still a swipe. */}
        <div className="vbody" {...gestures.handlers}>
          {list.length > 1 && (
            <button className="vnav p" onClick={() => gestures.turn(-1)}>
              <Icon n="chevl" s={20} c="#fff" w={2} />
            </button>
          )}
          {/* DOUBLE tap hearts it, and answers with the big heart — the way
              every thumb already expects, and the only like gesture that
              cannot be mistaken for something else. A single tap used to do
              it, which meant there was no gesture left for paging: a swipe
              across a phone ends as a tap, so every attempt to move through a
              trip hearted the picture instead.

              Keyboard and pointer come in by different doors. The button's
              onClick is the keyboard's (and a mouse's double click); the
              pointer handlers on the stage own touch, because only they can
              tell a swipe from a tap.

              A film is not tappable at all: on a video the touch belongs to
              play, pause and the scrubber, so the heart in the chrome is its
              only way in. */}
          {/* The strip. Three photographs side by side — the one before, the
              one you are on, the one after — and it is the strip that moves,
              not the picture. Under the finger the next one comes in at the
              edge; let go and the strip carries on to it in one movement.

              Nothing is swapped and nothing reloads: the photograph that
              arrives has been on the screen the whole time, just past the
              edge of it. Each pane is keyed by its slot, which never wraps,
              so a turn moves the panes rather than rebuilding them — a
              rebuilt pane is a photograph fetched again. */}
          <div
            className="vtrack"
            style={{
              transform: `translate3d(${gestures.shift}, 0, 0)`,
              transition: gestures.easing
                ? `transform ${gestures.ms}ms cubic-bezier(.22,.61,.36,1)`
                : 'none',
            }}
            onTransitionEnd={gestures.onTransitionEnd}>
            {gestures.slots.map(at => {
              const here = gestures.at(at)
              const shown = list[here]
              const middle = at === gestures.slot
              if (!shown) return null
              return (
                <div
                  key={at}
                  className={middle ? 'vpane on' : 'vpane'}
                  style={{ transform: `translate3d(${(at - gestures.slot) * 100}%, 0, 0)` }}
                  aria-hidden={middle ? undefined : true}>
                  {/* Only the one you are on is a film. A neighbour mounted as
                      a video would fetch a stream and hold a decoder for
                      something nobody has asked to watch; its poster is the
                      same picture the grid draws. */}
                  {shown.kind === 'video' && middle ? (
                    <VideoFrame photo={shown} />
                  ) : shown.kind === 'video' ? (
                    <MediaThumb item={shown} w={1200} h={900} badge={48} className="main" />
                  ) : (
                    <button
                      type="button"
                      className={middle ? 'vmaintap' : 'vmaintap vaside'}
                      tabIndex={middle ? undefined : -1}
                      aria-label={middle ? (liked ? 'Liked' : 'Like this photo') : ''}
                      onDoubleClick={middle ? like : undefined}
                      onClick={event => {
                        // detail 0 is a click the keyboard made; a pointer's is 1
                        // or more, and a pointer has already been read by the
                        // stage's handlers.
                        if (middle && event.detail === 0) setZoomed(true)
                      }}>
                      <Img
                        className="main"
                        item={shown}
                        w={1200}
                        h={900}
                        alt={middle ? shown.caption : ''}
                        eager
                      />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
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
            <button className="vnav n" onClick={() => gestures.turn(1)}>
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

        {zoomed && !video && (
          <PhotoZoom
            photo={photo}
            siblings={list.length > 1}
            onClose={() => setZoomed(false)}
            onPage={way => setIndex(pageBy(way, index, list.length))}
          />
        )}

        <PhotoFilm list={list} index={index} setIndex={setIndex} />
      </div>

      <PhotoSide
        photo={photo}
        stop={stop}
        here={here}
        mini={mini}
        theme={theme}
        tint={tint}
        video={video}
        byName={byName}
        contributors={contributors}
        comments={cmts}
        canEdit={canEdit}
        me={me}
        onCommentDelete={onCommentDelete}
        draft={draft}
        setDraft={setDraft}
        submit={submit}
        inputRef={inputRef}
        firstName={firstName}
      />
    </div>
  )
}

export default PhotoViewer
