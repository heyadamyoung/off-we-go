import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { isNativeApp, pickNativePhotos } from '../../../mobile'
import {
  photoPlacement,
  preparePhotoFilesForUpload,
  type MetadataFile,
} from '../../../mobile-photos-core'
import { MapCanvas } from '../../map'
import { coordinateLabel, validLngLat } from '../../../shared/lib/geo'
import Icon from '../../../shared/ui/icon'
import Sheet from '../../../shared/ui/sheet'
import { appErrorMessage } from '../../../user-messages-core'
import type { MapTint } from '../../map'
import {
  errorMessage,
  type Coordinates,
  type Stop,
  type Toast,
  type UploadInput,
} from '../../../shared/model/types'

const noop = () => {}

interface QueuedUpload {
  key: string
  name: string
  preview: string
  input: UploadInput
}

interface ChosenFile {
  file: MetadataFile
  url: string
  uploadKey: string
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
  const [files, setFiles] = useState<ChosenFile[]>([])
  const [selected, setSelected] = useState(0)
  const fileUrls = useRef<string[]>([])
  const [caption, setCaption] = useState('')
  const [devicePoint, setDevicePoint] = useState<Coordinates | null>(null)
  const [preparing, setPreparing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(true)
  const selectionRef = useRef(0)
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
  const placement = placements[selected]
  const selectedFile = files[selected]
  const previewStop = placement?.stopId ? stops.find(stop => stop.id === placement.stopId) : null
  const previewMapPoint: Coordinates | null = previewStop
    ? [previewStop.lng, previewStop.lat]
    : (placement?.previewPoint ?? null)
  const previewPhoto =
    placement?.previewPoint && selectedFile
      ? {
          id: `upload-${selected}`,
          by: '',
          src: selectedFile.url,
          lng: placement.previewPoint[0],
          lat: placement.previewPoint[1],
          stopId: placement.stopId,
        }
      : null
  const previewView = useMemo(
    () => (previewMapPoint ? { center: previewMapPoint, zoom: 15 } : null),

    [previewMapPoint?.[0], previewMapPoint?.[1]],
  )

  const setPicked = async (chosen: MetadataFile[]) => {
    const selection = ++selectionRef.current
    setPreparing(true)
    try {
      const prepared = await preparePhotoFilesForUpload(chosen)
      if (!mountedRef.current || selection !== selectionRef.current) return
      fileUrls.current.forEach(URL.revokeObjectURL)
      fileUrls.current = prepared.map(file => URL.createObjectURL(file))
      setSelected(0)
      setFiles(
        prepared.map((file, i) => ({
          file,
          url: fileUrls.current[i],
          uploadKey:
            globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        })),
      )
    } finally {
      if (mountedRef.current && selection === selectionRef.current) setPreparing(false)
    }
  }
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(e.target.files || [])]
    e.target.value = ''
    if (chosen.length)
      void setPicked(chosen).catch(error => toast(appErrorMessage(error, 'open-photos'), 'error'))
  }
  const choose = async () => {
    try {
      const chosen = await pickNativePhotos()
      if (chosen) {
        if (chosen.length) await setPicked(chosen)
        return
      }
      fileRef.current?.click()
    } catch (e) {
      if (!/cancel/i.test(errorMessage(e, ''))) toast(appErrorMessage(e, 'open-photos'), 'error')
    }
  }
  // Nothing here is busy any more; sending happens after this closes.
  const busy = false
  /* Hand the files over and get out of the way. Sending them took as long as it
     took while this sheet sat on top of the trip; the tray in the corner says
     what is going up, and the map is usable while it does. */
  const submit = () => {
    if (!files.length || busy || preparing) return
    onAdd(
      files.map((chosen, i) => {
        const meta = chosen.file.offwegoMetadata
        const resolved = placements[i]
        return {
          key: chosen.uploadKey,
          name: chosen.file.name || `Photo ${i + 1}`,
          /* Its own URL, because this modal revokes every one it made when
             it closes — which it does in the same breath as handing these
             over, leaving the tray showing broken images for the whole
             upload. The tray revokes this one when the upload is done. */
          preview: URL.createObjectURL(chosen.file),
          input: {
            /* No caption stays no caption — the UI titles it by time and place
             at render. Writing "Untitled" here would poison the data with a
             word nobody chose. */
            file: chosen.file,
            caption: caption.trim(),
            uploadKey: chosen.uploadKey,
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
      selectionRef.current += 1
      fileUrls.current.forEach(URL.revokeObjectURL)
    }
  }, [])

  return (
    <Sheet
      wide
      title="Add photos"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-accent"
            disabled={!files.length || busy || preparing}
            onClick={submit}>
            {`Add ${files.length || ''} to the map`}
          </button>
        </>
      }>
      {!files.length ? (
        <button
          className="flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-dashed
                           border-line2 px-5 py-7 text-center text-muted hover:border-accent
                           hover:bg-accent-soft"
          onClick={preparing ? undefined : choose}>
          <Icon n="upload" s={26} />
          <b className="text-sm text-ink">
            {preparing
              ? 'Reading photo locations…'
              : isNativeApp
                ? 'Choose photos from your photo library'
                : 'Choose photos from this device'}
          </b>
          <span className="text-xs">
            {preparing
              ? 'HEIC photos are converted securely on this device.'
              : "Up to 20 at a time. Each photo's map position is shown before it uploads."}
          </span>
        </button>
      ) : (
        <>
          <div className="previews grid max-h-[260px] grid-cols-3 gap-2 overflow-auto">
            {files.map((file, i) => (
              <button
                key={file.url}
                onClick={() => setSelected(i)}
                className={
                  'relative overflow-hidden rounded-xl border-2 ' +
                  (i === selected ? 'on border-accent' : 'border-transparent')
                }
                aria-label={`Inspect selected photo ${i + 1}`}>
                <img
                  className="preview h-28 w-full object-cover"
                  src={file.url}
                  alt={`Selected ${i + 1}`}
                />
                <span
                  className="absolute bottom-1 right-1 rounded-full bg-black/75 px-1.5 py-0.5
                                 text-[10px] font-extrabold text-white">
                  {placements[i]?.hasEmbeddedGps ? 'GPS' : 'No GPS'}
                </span>
              </button>
            ))}
          </div>
          <div>
            <button className="mini" disabled={preparing} onClick={choose}>
              Choose different photos
            </button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pick} />
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
              {placement.hasEmbeddedGps ? 'Embedded photo GPS' : 'No embedded GPS'}
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
      {files.length > 0 && placement && !placement.previewPoint && (
        <div className="rounded-xl border border-line bg-raised p-4">
          <b className="flex items-center gap-1.5 text-xs text-muted">
            <Icon n="pin" s={14} /> No reliable location available
          </b>
          <p className="hint mt-1">
            This photo has no embedded GPS and no phone has shared a fresh, accurate position. It
            will upload without a map location.
          </p>
        </div>
      )}
      <p className="hint">
        Photos go on the map for everyone on the trip, under the day they were taken. Followers can
        like and comment; only travellers can add or remove photos.
      </p>
    </Sheet>
  )
}

export default UploadModal
