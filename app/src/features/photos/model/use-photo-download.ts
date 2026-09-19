import { useCallback, useState } from 'react'
import {
  downloadManyOutcome,
  downloadName,
  downloadOutcome,
  downloadUrl,
  downloadWay,
  oursToServe,
  type DownloadWay,
} from '../../../download-core'
import { isNativeApp, mobilePlatform, saveToDevice } from '../../../mobile'
import { srcFor } from '../../../shared/ui/img'
import { track, trackError } from '../../../shared/lib/telemetry'
import type { TripPhoto } from '../../../shared/model/types'

/* Keeping a copy of a photograph — the one you are looking at, or every one
 * you have chosen.
 *
 * The button this drives used to exist with no onClick on it at all — it sat
 * in the viewer looking like a feature and did nothing, which is worse than
 * not offering it. So the rule here is that every path either saves something
 * or says why it could not.
 *
 * What gets saved is the display copy, which is the largest one there is: the
 * original is not kept. A three-thousand-pixel phone photograph is stored at
 * two thousand and forty-eight, and that is what a download is. A film is
 * itself, whole.
 */

type Say = (message: string, tone?: 'error') => void

/** One photograph, saved by whichever way this device has; the way it went,
    or null with the reason said. Says nothing on success — the caller does,
    once, for however many there were. */
export async function savePhoto(photo: TripPhoto, say: Say): Promise<DownloadWay | null> {
  /* A film is the file itself; a photograph is whichever copy is biggest,
     which srcFor answers for a real one and invents for the sample trip. */
  const video = photo.kind === 'video'
  const source = video ? photo.src : srcFor(photo, 2048, 2048)
  if (!source) {
    say(video ? 'That film is still being prepared' : 'There is nothing to save yet', 'error')
    return null
  }
  const way = downloadWay({ native: isNativeApp, anchor: typeof document !== 'undefined' })
  if (!way) {
    say(downloadOutcome(null), 'error')
    return null
  }
  const name = downloadName({
    caption: photo.caption,
    id: photo.id,
    takenAt: photo.takenAt || photo.when,
    mime: video ? photo.mime : 'image/jpeg',
    video,
  })
  if (oursToServe(source)) {
    /* The ordinary case, and the only one a real trip takes: our own
       server names the file and the bytes never enter the page. */
    const link = downloadUrl(source, name)
    if (way === 'device') await saveToDevice(name, link)
    else clickThrough(link, name)
  } else if (way === 'device') {
    await saveToDevice(name, source)
  } else {
    /* The sample trip draws from somebody else's server, which will not
       set a disposition header however nicely we ask. Holding it as a blob
       is what makes the name stick — and a demo picture is small. */
    await saveByHolding(source, name)
  }
  track('photo downloaded', { way, kind: photo.kind || 'photo' })
  return way
}

export default function usePhotoDownload(photo: TripPhoto | undefined, say: Say) {
  const [saving, setSaving] = useState(false)

  const download = useCallback(async () => {
    if (!photo || saving) return
    setSaving(true)
    try {
      const way = await savePhoto(photo, say)
      if (way) say(downloadOutcome(way, mobilePlatform))
    } catch (error) {
      /* A save that failed silently is the complaint this whole change is
         about, so it is said out loud and recorded where it can be queried. */
      trackError('download photo', error, { kind: photo.kind || 'photo' })
      say('That did not save', 'error')
    } finally {
      setSaving(false)
    }
  }, [photo, saving, say])

  return { download, saving }
}

/** How long between one file and the next: a browser handed forty links
    in the same tick keeps one and asks about the rest. */
const BETWEEN_MS = 350

/* Every chosen photograph, one after another, and one line at the end
   saying how many went where — never forty toasts. The ones that fail are
   counted rather than stopping the rest: the person asked for all of them. */
export function usePhotosDownload(say: Say) {
  const [saving, setSaving] = useState(false)

  const downloadAll = useCallback(
    async (photos: readonly TripPhoto[]) => {
      if (!photos.length || saving) return
      setSaving(true)
      let saved = 0
      let failed = 0
      let way: DownloadWay | null = null
      const quiet: Say = () => {}
      try {
        for (const [index, photo] of photos.entries()) {
          try {
            const went = await savePhoto(photo, quiet)
            if (went) {
              way = went
              saved += 1
            } else failed += 1
          } catch (error) {
            trackError('download photos', error, { kind: photo.kind || 'photo' })
            failed += 1
          }
          if (index < photos.length - 1) await new Promise(r => setTimeout(r, BETWEEN_MS))
        }
      } finally {
        setSaving(false)
      }
      say(downloadManyOutcome(saved, failed, way, mobilePlatform), saved ? undefined : 'error')
    },
    [saving, say],
  )

  return { downloadAll, saving }
}

/* A link the page clicks at itself. The download attribute is honoured for
   our own origin and ignored across origins, where the server's header does
   the same job — so both routes end in a file either way. */
function clickThrough(url: string, name: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

async function saveByHolding(url: string, name: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`media ${response.status}`)
  const held = URL.createObjectURL(await response.blob())
  try {
    clickThrough(held, name)
  } finally {
    /* Not immediately: revoking while the browser is still reading the blob
       cancels the very download that was asked for. */
    setTimeout(() => URL.revokeObjectURL(held), 60_000)
  }
}
