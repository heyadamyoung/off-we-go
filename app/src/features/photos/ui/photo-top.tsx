import Icon from '../../../shared/ui/icon'
import type { Person, Stop, TripPhoto } from '../../../shared/model/types'

/* The bar across the top of the viewer: who took this and when, and the things
   you can do to it. Its own file because the viewer went past the 400-line
   review boundary when sharing arrived, and this is the part of it that is
   about the chrome rather than about the photograph. */

/* One heart, drawn filled: rose in the chrome when liked, white in the burst
   over the photograph — the modern like, never an orange block. */
const HEART_PATH =
  'M12 21c-.4 0-.8-.15-1.1-.44C6.6 16.8 2.5 13.2 2.5 9.1 2.5 6.3 4.7 4 7.4 4c1.8 0 3.4 1 4.6 2.6C13.2 5 14.8 4 16.6 4c2.7 0 4.9 2.3 4.9 5.1 0 4.1-4.1 7.7-8.4 11.46-.3.29-.7.44-1.1.44Z'

export function FilledHeart({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" role="presentation">
      <path fill={color} d={HEART_PATH} />
    </svg>
  )
}

export default function PhotoTop({
  photo,
  author,
  stop,
  taken,
  video,
  liked,
  canEdit,
  sharing,
  onDetails,
  onLike,
  onShare,
  onClose,
}: {
  photo: TripPhoto
  author: Person
  stop?: Stop
  /* The wire carries an ISO instant and a person gets their locale's words;
     an unparseable one comes back as whatever was stored, which may be
     nothing at all. */
  taken: string | undefined
  video: boolean
  liked: boolean
  canEdit: boolean
  sharing: boolean
  onDetails: () => void
  onLike: () => void
  onShare: () => void
  onClose: () => void
}) {
  return (
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
          <button onClick={onDetails} title={video ? 'Edit video details' : 'Edit photo details'}>
            <Icon n="pencil" s={16} c="#f2f4f8" />
          </button>
        )}
        <button className={liked ? 'liked' : ''} onClick={onLike} title={liked ? 'Unlike' : 'Like'}>
          {liked ? (
            <FilledHeart size={18} color="#ff4d6d" />
          ) : (
            <Icon n="heart" s={17} c="#f2f4f8" />
          )}
        </button>
        {/* Sharing opens the phone's own sheet, which is where Instagram,
            Messages and everything else already live. Disabled while it is
            minting the link, because tapping twice would be two requests for
            the one link the server would hand back either way. */}
        <button onClick={onShare} disabled={sharing} title="Share">
          <Icon n="share" s={17} c="#f2f4f8" />
        </button>
        <button onClick={onClose} title="Close (Esc)">
          <Icon n="x" s={17} c="#f2f4f8" w={2} />
        </button>
      </div>
    </div>
  )
}
