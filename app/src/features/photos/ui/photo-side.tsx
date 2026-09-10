import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react'
import { MapCanvas } from '../../map'
import Icon from '../../../shared/ui/icon'
import type { MapTint } from '../../map'
import type {
  Coordinates,
  Id,
  Person,
  Stop,
  TripComment,
  TripPhoto,
} from '../../../shared/model/types'

/* Everything beside the photograph: where it was taken, who else was there,
   and what anybody has said about it.
 *
 * Its own file because the viewer is a screen with two halves and they answer
 * different questions — one is for looking, the other for reading — and
 * because a component that holds both was over the 400-line boundary this
 * repository keeps. Nothing in here reads a gesture; the stage owns those. */
export default function PhotoSide({
  photo,
  stop,
  here,
  mini,
  theme,
  tint,
  video,
  byName,
  contributors,
  comments,
  canEdit,
  me,
  onCommentDelete,
  draft,
  setDraft,
  submit,
  inputRef,
  firstName,
}: {
  photo: TripPhoto
  stop?: Stop
  here: TripPhoto[]
  mini: { center: Coordinates; zoom: number } | null
  theme: string
  tint?: MapTint | null
  video: boolean
  byName: (name: string) => Person
  contributors: string[]
  comments: (TripComment & { pending?: boolean })[]
  canEdit: boolean
  me: Person
  onCommentDelete: (photoId: Id, commentId: Id) => void
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  submit: (event: FormEvent<HTMLFormElement>) => void
  inputRef: RefObject<HTMLInputElement | null>
  firstName: string | null
}) {
  const noop = () => {}
  return (
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
        {comments.length === 0 && (
          <div className="vnone">No notes yet. Be the first to say something.</div>
        )}
        {comments.map(c => (
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
  )
}
