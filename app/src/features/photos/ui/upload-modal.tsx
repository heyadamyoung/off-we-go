import { useEffect, useMemo, useRef, useState } from 'react'
import { isNativeApp } from '../../../mobile'
import { photoPlacement } from '../../../mobile-photos-core'
import { durationLabel } from '../../../mobile-videos-core'
import useMediaPicker from '../model/use-media-picker'
import { MapCanvas } from '../../map'
import { coordinateLabel, validLngLat } from '../../../shared/lib/geo'
import Icon from '../../../shared/ui/icon'
import Sheet from '../../../shared/ui/sheet'
import type { MapTint } from '../../map'
import type { Coordinates, Stop, Toast, UploadInput } from '../../../shared/model/types'

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
  theme: string
  tint?: MapTint | null
}

function UploadModal({ onClose, onAdd, live, stops, toast, theme, tint }: UploadModalProps) {
  const { files, preparing, accept, fileRef, pick, choosePhotos, chooseVideos } = useMediaPicker({
    toast,
  })
  const [selected, setSelected] = useState(0)
  const [caption, setCaption] = useState('')
  const [devicePoint, setDevicePoint] = useState<Coordinates | null>(null)
  const mountedRef = useRef(true)
  const fallbackPoint = devicePoint || live
  const fallbackSource = devicePoint ? ('live' as const) : ('approximate' as const)
  const placements = useMemo(
    () =>
      files.map(value =>
        photoPlacement(value.file, {
          live: fallbackPoint,
          stops,
          fallbackSource,
        }),
      ),
    [files, fallbackPoint, stops, fallbackSource],
  )
  // A fresh selection is shorter than the last one often enough to matter.
  const at = Math.min(selected, Math.max(files.length - 1, 0))
  const placement = placements[at]
  const chosen = files[at]
  const anyVideo = files.some(file => file.isVideo)
  const noun = !files.length
    ? 'photos and videos'
    : anyVideo && files.some(file => !file.isVideo)
      ? 'photos and videos'
      : anyVideo
        ? files.length === 1
          ? 'video'
          : 'videos'
        : files.length === 1
          ? 'photo'
          : 'photos'
  const previewStop = placement?.stopId ? stops.find(stop => stop.id === placement.stopId) : null
  const previewMapPoint: Coordinates | null = previewStop
    ? [previewStop.lng, previewStop.lat]
    : (placement?.previewPoint ?? null)
  /* The map preview draws a picture, so a film stands in with its poster; one
     that would not decode simply has no pin picture, not a broken one. */
  const previewPhoto =
    placement?.previewPoint && chosen && (!chosen.isVideo || chosen.posterUrl)
      ? {
          id: `upload-${at}`,
          by: '',
          src: chosen.isVideo ? chosen.posterUrl! : chosen.url,
          lng: placement.previewPoint[0],
          lat: placement.previewPoint[1],
          stopId: placement.stopId,
        }
      : null
  const previewView = useMemo(
    () => (previewMapPoint ? { center: previewMapPoint, zoom: 15 } : null),

    [previewMapPoint?.[0], previewMapPoint?.[1]],
  )

  /* Hand the files over and get out of the way. Sending them took as long as it
     took while this sheet sat on top of the trip; the tray in the corner says
     what is going up, and the map is usable while it does. */
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
             over, leaving the tray showing broken images for the whole
             upload. The tray revokes this one when the upload is done. A
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
      title="Add photos and videos"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent" disabled={!files.length || preparing} onClick={submit}>
            {`Add ${files.length || ''} to the map`}
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
                : 'Up to 20 at a time. Each one’s map position is shown before it uploads.'}
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
          <div className="previews grid max-h-[260px] grid-cols-3 gap-2 overflow-auto">
            {files.map((file, i) => (
              <button
                key={file.uploadKey}
                onClick={() => setSelected(i)}
                className={
                  'relative overflow-hidden rounded-xl border-2 ' +
                  (i === at ? 'on border-accent' : 'border-transparent')
                }
                aria-label={`Inspect selected ${file.isVideo ? 'video' : 'photo'} ${i + 1}`}>
                {file.isVideo && !file.posterUrl ? (
                  <span className="preview flex h-28 w-full items-center justify-center bg-ink/85">
                    <Icon n="video" s={20} c="#fff" />
                  </span>
                ) : (
                  <img
                    className="preview h-28 w-full object-cover"
                    src={file.isVideo ? file.posterUrl! : file.url}
                    alt={`Selected ${i + 1}`}
                  />
                )}
                {file.isVideo && (
                  <span
                    className="absolute left-1 top-1 flex items-center gap-1 rounded-full
                                   bg-black/75 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                    <Icon n="video" s={10} c="#fff" />
                    {durationLabel(file.durationMs) || 'Video'}
                  </span>
                )}
                <span
                  className="absolute bottom-1 right-1 rounded-full bg-black/75 px-1.5 py-0.5
                                 text-[10px] font-extrabold text-white">
                  {placements[i]?.hasEmbeddedGps ? 'GPS' : 'No GPS'}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="mini" disabled={preparing} onClick={choosePhotos}>
              Choose different {isNativeApp ? 'photos' : 'files'}
            </button>
            {isNativeApp && (
              <button className="mini" disabled={preparing} onClick={chooseVideos}>
                Choose videos
              </button>
            )}
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept={accept} multiple hidden onChange={pick} />
      <label className="field">
        Caption
        <input
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="What is happening here?"
        />
      </label>
      {placement && previewView && previewPhoto && (
        <div
          className="grid overflow-hidden rounded-xl border border-line bg-raised
                        sm:grid-cols-[minmax(0,1.35fr)_minmax(180px,.65fr)]">
          <div className="relative h-[190px] overflow-hidden">
            <MapCanvas
              theme={theme}
              tint={tint}
              interactive={false}
              view={previewView}
              onView={noop}
              route={[]}
              stops={previewStop ? [previewStop] : []}
              photos={[previewPhoto]}
            />
          </div>
          <div className="flex flex-col justify-center gap-1.5 p-3.5">
            <b className="flex items-center gap-1.5 text-xs text-accent">
              <Icon n="pin" s={14} />{' '}
              {placement.hasEmbeddedGps
                ? 'Embedded photo GPS'
                : chosen?.isVideo
                  ? 'Videos carry no GPS'
                  : 'No embedded GPS'}
            </b>
            <strong className="tnum text-sm">{coordinateLabel(placement.previewPoint!)}</strong>
            {placement.source === 'history' ? (
              <p className="hint">
                Trip history will be checked first; the{' '}
                {placement.fallbackSource === 'live' ? 'current phone position' : 'trip position'}{' '}
                shown here is the fallback.
              </p>
            ) : (
              <p className="hint">
                {placement.stopName
                  ? `This will be grouped at ${placement.stopName}.`
                  : placement.source === 'exif'
                    ? 'This is where the photo was taken.'
                    : placement.source === 'live'
                      ? 'This is the current phone position.'
                      : 'This is the trip’s latest known position.'}
              </p>
            )}
          </div>
        </div>
      )}
      {/* A film this device could not draw a frame from is a film it could not
          decode, and the people on the trip are mostly holding the same kind
          of phone. Better said now than discovered on the map. */}
      {chosen?.isVideo && !chosen.posterUrl && (
        <div className="rounded-xl border border-line bg-raised p-4">
          <b className="flex items-center gap-1.5 text-xs text-muted">
            <Icon n="video" s={14} /> No preview frame
          </b>
          <p className="hint mt-1">
            This device could not decode a frame from this video, so it will have no picture on the
            map and may not play for everyone. It uploads exactly as filmed either way.
          </p>
        </div>
      )}
      {files.length > 0 && placement && !placement.previewPoint && (
        <div className="rounded-xl border border-line bg-raised p-4">
          <b className="flex items-center gap-1.5 text-xs text-muted">
            <Icon n="pin" s={14} /> No reliable location available
          </b>
          <p className="hint mt-1">
            This {chosen?.isVideo ? 'video' : 'photo'} has no embedded GPS and no phone has shared a
            fresh, accurate position. It will upload without a map location.
          </p>
        </div>
      )}
      <p className="hint">
        {`Your ${noun} go on the map for everyone on the trip, under the day they were taken.`}{' '}
        Followers can like and comment; only travellers can add or remove them. Videos are kept
        exactly as filmed.
      </p>
    </Sheet>
  )
}

export default UploadModal
