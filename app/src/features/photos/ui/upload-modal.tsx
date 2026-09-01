import { useEffect, useMemo, useRef, useState } from 'react'
import { isNativeApp, pickNativePhotos } from '../../../mobile'
import { photoPlacement, preparePhotoFilesForUpload } from '../../../mobile-photos-core'
import { MapCanvas } from '../../map'
import { coordinateLabel, validLngLat } from '../../../shared/lib/geo'
import Icon from '../../../shared/ui/icon'
import Modal from '../../../shared/ui/modal'
import { appErrorMessage } from '../../../user-messages-core'

const noop = () => {}

function UploadModal({ onClose, onAdd, live, stops, toast, theme, tint }: any) {
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(0)
  const fileUrls = useRef([])
  const [caption, setCaption] = useState('')
  const [devicePoint, setDevicePoint] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const fileRef = useRef(null)
  const mountedRef = useRef(true)
  const selectionRef = useRef(0)
  const fallbackPoint = devicePoint || live
  const fallbackSource = devicePoint ? 'live' : 'approximate'
  const placements = useMemo(() => files.map(value => photoPlacement(value.file, {
    live: fallbackPoint, stops, fallbackSource,
  })), [files, fallbackPoint, stops, fallbackSource])
  const placement = placements[selected]
  const selectedFile = files[selected]
  const previewStop = placement?.stopId ? stops.find(stop => stop.id === placement.stopId) : null
  const previewMapPoint = previewStop ? [previewStop.lng, previewStop.lat] : placement?.previewPoint
  const previewPhoto = placement && selectedFile ? {
    id: `upload-${selected}`, src: selectedFile.url,
    lng: placement.previewPoint[0], lat: placement.previewPoint[1], stopId: placement.stopId,
  } : null
  const previewView = useMemo(() => previewMapPoint ? ({ center: previewMapPoint, zoom: 15 }) : null,
    [previewMapPoint?.[0], previewMapPoint?.[1]])

  const setPicked = async selected => {
    const selection = ++selectionRef.current
    setPreparing(true)
    try {
      const prepared = await preparePhotoFilesForUpload(selected)
      if (!mountedRef.current || selection !== selectionRef.current) return
      fileUrls.current.forEach(URL.revokeObjectURL)
      fileUrls.current = prepared.map(URL.createObjectURL)
      setSelected(0)
      setFiles(prepared.map((file, i) => ({
        file, url: fileUrls.current[i],
        uploadKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
      })))
    } finally {
      if (mountedRef.current && selection === selectionRef.current) setPreparing(false)
    }
  }
  const pick = e => {
    const selected = [...(e.target.files || [])]
    e.target.value = ''
    if (selected.length) void setPicked(selected)
      .catch(error => toast(appErrorMessage(error, 'open-photos'), 'error'))
  }
  const choose = async () => {
    try {
      const selected = await pickNativePhotos()
      if (selected) { if (selected.length) await setPicked(selected); return }
      fileRef.current?.click()
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) toast(appErrorMessage(e, 'open-photos'), 'error')
    }
  }
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!files.length || busy || preparing) return
    setBusy(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const meta = files[i].file.offwegoMetadata
        const resolved = placements[i]
        await onAdd({
          file: files[i].file, caption: caption.trim() || 'Untitled',
          uploadKey: files[i].uploadKey,
          stopId: resolved.stopId, lng: resolved.point?.[0], lat: resolved.point?.[1],
          fallbackLng: resolved.fallbackPoint?.[0], fallbackLat: resolved.fallbackPoint?.[1],
          fallbackLocationSource: resolved.fallbackSource,
          locationSource: ['exif', 'live', 'approximate'].includes(resolved.source) ? resolved.source : undefined,
          when: meta?.takenAt || new Date().toISOString(), order: i,
        })
      }
      const what = `${files.length} photo${files.length === 1 ? '' : 's'} added`
      toast(`${what} to the map`)
      onClose()
    } catch (e) {
      toast(appErrorMessage(e, 'upload-photo'), 'error')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    mountedRef.current = true
    navigator.geolocation?.getCurrentPosition(({ coords }) => {
      if (mountedRef.current && validLngLat(coords.longitude, coords.latitude)
          && (!Number.isFinite(coords.accuracy) || coords.accuracy <= 80)) {
        setDevicePoint([coords.longitude, coords.latitude])
      }
    }, noop, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 })
    return () => {
      mountedRef.current = false
      selectionRef.current += 1
      fileUrls.current.forEach(URL.revokeObjectURL)
    }
  }, [])

  return (
    <Modal title="Add a photo" onClose={onClose} className="uploadmodal">
      <div className="mb">
        {!files.length ? (
          <div className="drop" onClick={preparing ? undefined : choose}>
            <Icon n="upload" s={26} c="var(--ink3)" />
            <b>{preparing ? 'Reading photo locations…'
              : isNativeApp ? 'Choose photos from your photo library' : 'Choose photos from this device'}</b>
            <span>{preparing ? 'HEIC photos are converted securely on this device.'
              : "Select up to 20; each photo's map position will be shown before upload"}</span>
          </div>
        ) : <>
          <div className="previews">{files.map((file, i) => (
            <button key={file.url} className={i === selected ? 'on' : ''} onClick={() => setSelected(i)}
                    aria-label={`Inspect selected photo ${i + 1}`}>
              <img className="preview" src={file.url} alt={`Selected ${i + 1}`} />
              <span>{placements[i]?.hasEmbeddedGps ? 'GPS' : 'No GPS'}</span>
            </button>
          ))}</div>
          <button className="btn choosephotos" disabled={preparing} onClick={choose}>Choose different photos</button>
        </>}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pick} />
        <div className="field">
          <label>Caption</label>
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="What is happening here?" />
        </div>
        {placement && previewView && previewPhoto && <div className="uploadinspect">
          <div className="uploadmap">
            <MapCanvas theme={theme} tint={tint} interactive={false} view={previewView} onView={noop}
              route={[]} stops={previewStop ? [previewStop] : []} photos={[previewPhoto]} />
          </div>
          <div className="uplocation">
            <b><Icon n="pin" s={14} /> {placement.hasEmbeddedGps ? 'Embedded photo GPS' : 'No embedded GPS'}</b>
            <strong>{coordinateLabel(placement.previewPoint)}</strong>
            {placement.source === 'history'
              ? <p>Trip history will be checked first; the {placement.fallbackSource === 'live'
                ? 'current phone position' : 'trip position'} shown here is the fallback.</p>
              : <p>{placement.stopName ? `This will be grouped at ${placement.stopName}.`
                : placement.source === 'exif' ? 'This is where the photo was taken.'
                  : placement.source === 'live' ? 'This is the current phone position.'
                    : 'This is the trip’s latest known position.'}</p>}
          </div>
        </div>}
        <div className="linkrow">
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn pri" style={{ flex: 1 }} disabled={!files.length || busy || preparing} onClick={submit}>
            {busy ? `Uploading ${files.length}…` : `Add ${files.length || ''} to the map`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default UploadModal




