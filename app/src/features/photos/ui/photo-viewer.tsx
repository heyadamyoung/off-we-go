import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MapCanvas } from '../../map'
import Icon from '../../../shared/ui/icon'
import Img, { SEEN, srcFor } from '../../../shared/ui/img'
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
      if (!p) continue
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
  const author = byName(photo.by)
  const here = list.filter(p => p.stopId === photo.stopId)
  const contributors = [...new Set(here.map(p => p.by))]
  const cmts = comments[photo.id] || []
  const liked = likes.has(photo.id)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const t = draft.trim()
    if (!t) return
    addComment(photo.id, t)
    setDraft('')
  }

  return (
    <div className="viewer">
      <div className="vstage">
        <div className="vtop">
          <div className="who">
            <img src={author.avatar} alt="" />
            <div>
              <b>{photo.by}</b>
              <span>
                {photo.when}
                {stop ? ' · ' + stop.name : ''}
              </span>
            </div>
          </div>
          <div className="acts">
            <button
              className={liked ? 'liked' : ''}
              onClick={() => toggleLike(photo.id)}
              title="Like">
              <Icon n="heart" s={17} c={liked ? '#fff' : '#f2f4f8'} />
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
          <Img className="main" item={photo} w={1200} h={900} alt={photo.caption} eager />
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
            {index + 1} of {list.length}
          </div>
        </div>

        <div className="vfilm">
          {list.map((p, i) => (
            <button key={p.id} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
              <Img item={p} w={300} h={200} />
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
              {mini ? (stop ? stop.name : 'On the move') : 'This photo has no coordinates'}
              {mini ? ` · ${here.length} photo${here.length === 1 ? '' : 's'}` : ''}
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
            <span>contributed photos here</span>
          </div>
          <span className="n">{here.length}</span>
        </div>

        {canEdit && (
          <div className="vedit">
            <input
              value={photo.caption || ''}
              placeholder="Caption"
              onChange={e => onPhotoChange(photo.id, { caption: e.target.value })}
            />
            <div className="row">
              <select
                value={photo.stopId || ''}
                onChange={e => onPhotoChange(photo.id, { stopId: e.target.value || null })}>
                <option value="">Not at a stop</option>
                {stops.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <HoldToDelete onDelete={() => onPhotoDelete(photo.id)} />
            </div>
          </div>
        )}

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
            placeholder={`Say something nice, ${me.name}…`}
          />
          <button type="submit" disabled={!draft.trim()}>
            <Icon n="send" s={16} c="#fff" />
          </button>
        </form>
      </div>
    </div>
  )
}

/* Deleting a photograph is the one act in this viewer with no undo, so it
   asks for commitment: press and hold while the red fills, let go early and
   nothing happens. A plain tap — the gesture that does everything else on
   this screen — can never take a picture away. */
function HoldToDelete({ onDelete }: { onDelete: () => void }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = () => {
    if (timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      onDelete()
    }, 650)
  }
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <button
      type="button"
      className={'vdel' + (holding ? ' holding' : '')}
      title="Press and hold to delete this photo"
      aria-label="Press and hold to delete this photo"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={e => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start()
      }}
      onKeyUp={cancel}
      onContextMenu={e => e.preventDefault()}>
      <span>Delete</span>
    </button>
  )
}

export default PhotoViewer
