import { useCallback, useState } from 'react'
import { shareFilename, shareNote, shareOutcome, shareWay } from '../../../share-core'
import { shareLink } from '../../../share-links'
import { srcFor } from '../../../shared/ui/img'
import { track } from '../../../shared/lib/telemetry'
import type { Id, TripPhoto } from '../../../shared/model/types'

/* Handing one photograph to somebody who is not on the trip.
 *
 * Two halves. The server mints a public link — see share-page.js for what that
 * link actually shows, which is one picture and nothing about the trip. And
 * then the operating system's own share sheet does the rest, because there is
 * no such thing as an Instagram share URL: what every app calling itself
 * "share to Instagram" does is put the image in that sheet, where Instagram is
 * a target because it is installed. The same sheet is Messages, WhatsApp, Mail
 * and AirDrop, so this is the whole list rather than one integration each.
 *
 * The ladder of what a browser will actually accept is in share-core, where it
 * can be argued with rather than discovered on somebody's phone.
 */
export default function usePhotoShare(
  tripId: Id,
  photo: TripPhoto | undefined,
  say: (message: string, tone?: 'error') => void,
) {
  const [sharing, setSharing] = useState(false)

  const share = useCallback(async () => {
    if (!photo || sharing) return
    setSharing(true)
    try {
      const url = await shareLink(tripId, photo.id)
      if (!url) {
        say('Could not make a link for that', 'error')
        return
      }

      /* The picture itself, when it is a picture. A film is shared as the link
         alone: the file is tens or hundreds of megabytes, it would be pulled
         through the phone to hand back to the sheet, and the page at the other
         end plays it anyway. */
      let file: File | null = null
      if (photo.kind !== 'video') {
        try {
          const response = await fetch(srcFor(photo, 1200, 900))
          const blob = await response.blob()
          file = new File([blob], shareFilename(photo.caption, false), {
            type: blob.type || 'image/jpeg',
          })
        } catch {
          // A picture we cannot hold is a link we can still send.
          file = null
        }
      }

      const sheet = typeof navigator.share === 'function'
      const way = shareWay({
        sheet,
        files:
          file && typeof navigator.canShare === 'function'
            ? navigator.canShare({ files: [file as File] })
            : false,
        clipboard: typeof navigator.clipboard?.writeText === 'function',
      })
      const note = shareNote(photo.caption, url)

      if (way === 'files' && file) await navigator.share({ files: [file], text: note, url })
      else if (way === 'link') await navigator.share({ text: note, url })
      else if (way === 'clipboard') await navigator.clipboard.writeText(url)

      track('photo shared', { way: way || 'none', kind: photo.kind || 'photo' })
      say(shareOutcome(way), way ? undefined : 'error')
    } catch (error) {
      /* Dismissing the sheet rejects, and is not a failure — telling somebody
         their share did not work because they changed their mind is worse
         than saying nothing. */
      if ((error as Error)?.name === 'AbortError') return
      say('That did not share', 'error')
    } finally {
      setSharing(false)
    }
  }, [tripId, photo, sharing, say])

  return { share, sharing }
}
