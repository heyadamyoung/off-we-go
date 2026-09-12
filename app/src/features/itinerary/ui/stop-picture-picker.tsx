import Icon from '../../../shared/ui/icon'
import { srcFor } from '../../../shared/ui/img'
import MediaThumb from '../../../shared/ui/media-thumb'
import { pictureChoices } from '../../../stop-picture-core'
import type { Id, TripPhoto } from '../../../shared/model/types'

/* Big enough to be the stop's picture rather than the thumbnail of it: the
   detail card draws it at 720 across the top of the card. */
const STORE_BOX = 1200

/* Choosing a stop's picture from the trip's own photographs.

   The pictures already filed at this stop come first and are marked, because
   on a trip with a thousand photographs the one of this castle is the whole
   problem — scrolling for it is not a feature. A film is offered too, as its
   poster frame with the play mark still on it, so it is clear which frame is
   being taken and where from. */
export default function StopPicturePicker({
  photos,
  stopId,
  onPick,
  onClose,
}: {
  photos: TripPhoto[]
  /** absent on a stop that has not been saved yet; then nothing is "here" */
  stopId?: Id | null
  onPick: (src: string) => void
  onClose: () => void
}) {
  const byId = new Map(photos.map(photo => [photo.id, photo]))
  /* What the app would actually draw for each one, which is not always what is
     stored on it: a photograph that has not finished going up is a blob, and a
     bundled sample photograph has no file at all and is drawn from a keyword.
     Resolving it here keeps the rule about what may be stored in one place —
     the core refuses the blob — without the core having to know how a picture
     gets drawn. */
  const choices = pictureChoices(
    photos.map(photo => ({ ...photo, src: srcFor(photo, STORE_BOX, STORE_BOX) })),
    stopId,
  )
  const here = choices.filter(choice => choice.here).length
  return (
    <div className="epick">
      <div className="epickh">
        <span>{here ? `${here} from this stop, first` : 'From this trip'}</span>
        <button type="button" onClick={onClose} title="Close">
          <Icon n="x" s={13} w={2} />
        </button>
      </div>
      {choices.length ? (
        <div className="epickg">
          {choices.map(choice => {
            const photo = byId.get(choice.id)
            return photo ? (
              <button
                key={choice.id}
                type="button"
                className={choice.here ? 'on' : ''}
                title={choice.caption || 'Use this picture'}
                onClick={() => onPick(choice.src)}>
                <MediaThumb item={photo} w={160} h={160} badge={18} />
              </button>
            ) : null
          })}
        </div>
      ) : (
        <p className="epicknone">
          No pictures on this trip yet. Add some and any of them can stand for a stop.
        </p>
      )}
    </div>
  )
}
