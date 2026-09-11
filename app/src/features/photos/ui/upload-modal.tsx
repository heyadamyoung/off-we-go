import { useEffect, useMemo, useRef, useState } from 'react'
import { isNativeApp } from '../../../mobile'
import { photoPlacement } from '../../../mobile-photos-core'
import { durationLabel } from '../../../mobile-videos-core'
import { placementSentence, summarise } from '../../../upload-summary-core'
import useMediaPicker from '../model/use-media-picker'
import { validLngLat } from '../../../shared/lib/geo'
import Icon from '../../../shared/ui/icon'
import { PlayBadge } from '../../../shared/ui/media-thumb'
import Sheet from '../../../shared/ui/sheet'
import type { Coordinates, Stop, Toast, UploadInput } from '../../../shared/model/types'

/* Choosing what to add.

   It used to be a sheet you had to read. A grid of tiles that looked like a
   selector but was an inspector — tapping one changed which photograph the map
   underneath was describing, and nothing else — then a map of that one, then
   three paragraphs about where its coordinates had come from, then two warning
   boxes, then a paragraph of policy. All of it true, most of it about
   photograph seven of twenty, and no way at all to take back the one you did
   not mean to pick.

   Now it is what a phone does: see what you chose, take out what you did not
   mean, add more if you like, write one caption, send. The batch is described
   in a sentence rather than sampled by a map, and the pictures that arrive
   without a location are not an apology any more — they can be filed at a
   place afterwards, in two taps, from the gallery. */

const noop = () => {}

interface QueuedUpload {
  key: string
  name: string
  preview?: string
  kind: 'photo' | 'video'
  input: UploadInput
}

interface UploadModalProps {
  onClose: () => void
  onAdd: (uploads: QueuedUpload[]) => void
  live: Coordinates | null
  stops: Stop[]
  toast: Toast
}

function UploadModal({ onClose, onAdd, live, stops, toast }: UploadModalProps) {
  const { files, preparing, accept, fileRef, pick, choosePhotos, chooseVideos, drop } =
    useMediaPicker({ toast })
  const [caption, setCaption] = useState('')
  const [devicePoint, setDevicePoint] = useState<Coordinates | null>(null)
  const mountedRef = useRef(true)
  const fallbackPoint = devicePoint || live
  const fallbackSource = devicePoint ? ('live' as const) : ('approximate' as const)
  const placements = useMemo(
    () =>
      files.map(value =>
        photoPlacement(value.file, { live: fallbackPoint, stops, fallbackSource }),
      ),
    [files, fallbackPoint, stops, fallbackSource],
  )
  const sentence = placementSentence(summarise(placements))
  const films = files.filter(file => file.isVideo).length
  const noun = !files.length
    ? 'photos and videos'
    : films && films < files.length
      ? 'items'
      : films
        ? films === 1
          ? 'video'
          : 'videos'
        : files.length === 1
          ? 'photo'
          : 'photos'

  /* Hand the files over and get out of the way. Sending them takes as long as
     it takes; the bar says how far the batch has got, and the trip is usable
     the whole time. */
  const submit = () => {
    if (!files.length || preparing) return
    onAdd(
      files.map((item, i) => {
        const meta = item.file.offwegoMetadata
        const resolved = placements[i]
        return {
          key: item.uploadKey,
          name: item.file.name || `${item.isVideo ? 'Video' : 'Photo'} ${i + 1}`,
          kind: item.isVideo ? ('video' as const) : ('photo' as const),
          /* Its own URL, because this modal revokes every one it made when
             it closes — which it does in the same breath as handing these
             over, leaving the bar showing broken images for the whole
             upload. The queue revokes this one when the upload is done. A
             film's tile is its poster: an <img> of an mp4 draws nothing. */
          preview: item.isVideo
            ? item.poster
              ? URL.createObjectURL(item.poster)
              : undefined
            : URL.createObjectURL(item.file),
          input: {
            /* No caption stays no caption — the UI titles it by time and place
             at render. Writing "Untitled" here would poison the data with a
             word nobody chose. */
            file: item.file,
            poster: item.poster,
            durationMs: item.durationMs,
            caption: caption.trim(),
            uploadKey: item.uploadKey,
            stopId: resolved.stopId,
            lng: resolved.point?.[0],
            lat: resolved.point?.[1],
            fallbackLng: resolved.fallbackPoint?.[0],
            fallbackLat: resolved.fallbackPoint?.[1],
            fallbackLocationSource: resolved.fallbackSource,
            locationSource: ['exif', 'live', 'approximate'].includes(resolved.source)
              ? (resolved.source as UploadInput['locationSource'])
              : undefined,
            when: meta?.takenAt || new Date().toISOString(),
            order: i,
          },
        }
      }),
    )
    onClose()
  }

  useEffect(() => {
    mountedRef.current = true
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => {
        if (
          mountedRef.current &&
          validLngLat(coords.longitude, coords.latitude) &&
          (!Number.isFinite(coords.accuracy) || coords.accuracy <= 80)
        ) {
          setDevicePoint([coords.longitude, coords.latitude])
        }
      },
      noop,
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 },
    )
    return () => {
      mountedRef.current = false
    }
  }, [])

  return (
    <Sheet
      wide
      title={files.length ? `Add ${files.length} ${noun}` : 'Add photos and videos'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent" disabled={!files.length || preparing} onClick={submit}>
            {files.length ? `Add ${files.length}` : 'Add'}
          </button>
        </>
      }>
      {!files.length ? (
        <div className="flex flex-col gap-2">
          <button
            className="flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-dashed
                       border-line2 px-5 py-7 text-center text-muted hover:border-accent
                       hover:bg-accent-soft"
            onClick={preparing ? undefined : choosePhotos}>
            <Icon n="upload" s={26} />
            <b className="text-sm text-ink">
              {preparing
                ? 'Reading what you chose…'
                : isNativeApp
                  ? 'Choose photos from your photo library'
                  : 'Choose photos or videos from this device'}
            </b>
            <span className="text-xs">
              {preparing
                ? 'HEIC photos are converted, and videos get their first frame, on this device.'
                : 'They go up in the background — you can carry on using the trip.'}
            </span>
          </button>
          {/* The native photo picker hands over the EXIF a file input drops,
              which is why photographs still go through it — but it cannot
              offer films at all, so those get their own way in. */}
          {isNativeApp && (
            <button
              className="flex items-center justify-center gap-2 rounded-2xl border-[1.5px]
                         border-dashed border-line2 px-5 py-4 text-center text-sm font-bold
                         text-ink hover:border-accent hover:bg-accent-soft"
              onClick={preparing ? undefined : chooseVideos}>
              <Icon n="video" s={18} />
              Choose videos instead
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="previews grid max-h-[280px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {files.map((file, i) => (
              <span
                key={file.uploadKey}
                className="group relative aspect-square overflow-hidden rounded-xl bg-raised">
                {file.isVideo && !file.posterUrl ? (
                  <span className="flex size-full items-center justify-center bg-ink/85">
                    <Icon n="video" s={20} c="#fff" />
                  </span>
                ) : (
                  <img
                    className="size-full object-cover"
                    src={file.isVideo ? file.posterUrl! : file.url}
                    alt=""
                  />
                )}
                {/* A film reads as a film, with the mark every camera roll in
                    the world uses and its length in the corner. */}
                {file.isVideo && file.posterUrl && <PlayBadge size={22} />}
                {file.isVideo && (
                  <span
                    className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/70
                               px-1 py-px text-[10px] font-bold tabular-nums text-white">
                    {durationLabel(file.durationMs) || 'Video'}
                  </span>
                )}
                {/* Only the exceptions are marked. A "GPS" pip on eighteen
                    tiles is eighteen pips nobody reads; the two without one
                    are the two worth pointing at. */}
                {!placements[i]?.previewPoint && (
                  <span
                    className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-black/70
                               px-1 py-px text-[10px] font-bold text-white">
                    No place
                  </span>
                )}
                <button
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-full
                             bg-black/60 text-white transition-opacity hover:bg-black/80
                             sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  onClick={() => drop(file.uploadKey)}
                  title="Take this one out"
                  aria-label={`Take out ${file.file.name || `item ${i + 1}`}`}>
                  <Icon n="x" s={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="mini" disabled={preparing} onClick={choosePhotos}>
              {preparing ? 'Reading…' : isNativeApp ? 'Add more photos' : 'Add more'}
            </button>
            {isNativeApp && (
              <button className="mini" disabled={preparing} onClick={chooseVideos}>
                Add videos
              </button>
            )}
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept={accept} multiple hidden onChange={pick} />
      <label className="field">
        {files.length > 1 ? 'Caption for all of them' : 'Caption'}
        <input
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="What is happening here?"
        />
      </label>
      {sentence && (
        <p className="hint flex items-start gap-1.5">
          <Icon n="pin" s={13} className="mt-px flex-none" />
          <span>{sentence}</span>
        </p>
      )}
    </Sheet>
  )
}

export default UploadModal
