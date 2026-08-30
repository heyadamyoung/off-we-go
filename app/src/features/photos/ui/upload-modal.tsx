import { useEffect, useMemo, useRef, useState } from 'react'
import { isNativeApp, pickNativePhotos } from '../../../mobile'
import { metres } from '../../../shared/lib/geo'
import Icon from '../../../shared/ui/icon'
import Modal from '../../../shared/ui/modal'

function UploadModal({ onClose, onAdd, live, stops, toast }: any) {
  const [files, setFiles] = useState([])
  const fileUrls = useRef([])
  const [caption, setCaption] = useState('')
  const fileRef = useRef(null)
  const near = useMemo(() => {
    let best = null, bd = 400
    stops.forEach(s => { const d = metres([s.lng, s.lat], live); if (d < bd) { bd = d; best = s } })
    return best
  }, [live, stops])

  const setPicked = selected => {
    fileUrls.current.forEach(URL.revokeObjectURL)
    fileUrls.current = selected.map(URL.createObjectURL)
    setFiles(selected.map((file, i) => ({
      file, url: fileUrls.current[i],
      uploadKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
    })))
  }
  const pick = e => {
    const selected = [...(e.target.files || [])]
    if (selected.length) setPicked(selected)
  }
  const choose = async () => {
    try {
      const selected = await pickNativePhotos()
      if (selected) { if (selected.length) setPicked(selected); return }
      fileRef.current?.click()
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) toast(e.message || 'Could not open Photos')
    }
  }
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!files.length || busy) return
    setBusy(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const meta = files[i].file.wayfareMetadata
        const exifPoint = meta?.lat != null && meta?.lng != null ? [meta.lng, meta.lat] : null
        // A captured-at timestamp with no EXIF position is deliberately sent
        // without today's live position: the VPS can then match it to the
        // uploader's historical GPS trail at the moment the picture was taken.
        const point = exifPoint || (!meta?.takenAt ? live : null)
        let photoStop = null, best = 400
        if (point) stops.forEach(stop => {
          const distance = metres([stop.lng, stop.lat], point)
          if (distance < best) { best = distance; photoStop = stop }
        })
        await onAdd({
          file: files[i].file, caption: caption.trim() || 'Untitled',
          uploadKey: files[i].uploadKey,
          stopId: photoStop?.id || null, lng: point?.[0], lat: point?.[1],
          locationSource: exifPoint ? 'exif' : point ? 'live' : undefined,
          when: meta?.takenAt || new Date().toISOString(), order: i,
        })
      }
      const what = `${files.length} photo${files.length === 1 ? '' : 's'} added`
      toast(`${what} to the map`)
      onClose()
    } catch (e) {
      toast(e.message || 'Could not upload that photo')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => () => fileUrls.current.forEach(URL.revokeObjectURL), [])

  return (
    <Modal title="Add a photo" onClose={onClose}>
      <div className="mb">
        {!files.length ? (
          <div className="drop" onClick={choose}>
            <Icon n="upload" s={26} c="var(--ink3)" />
            <b>{isNativeApp ? 'Choose photos from your photo library' : 'Choose photos from this device'}</b>
            <span>Select up to 20; they will be pinned where you are right now</span>
          </div>
        ) : <>
          <div className="previews">{files.map((file, i) => <img key={file.url} className="preview" src={file.url} alt={`Selected ${i + 1}`} />)}</div>
          <button className="btn choosephotos" onClick={choose}>Choose different photos</button>
        </>}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pick} />
        <div className="field">
          <label>Caption</label>
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="What is happening here?" />
        </div>
        <p style={{ fontSize: 12.5 }}>
          <Icon n="pin" s={13} /> {live[1].toFixed(4)} N, {live[0].toFixed(4)} E
          {near ? ` — inside ${near.name}` : ' — no stop nearby, it will pin to the map'}
        </p>
        <div className="linkrow">
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn pri" style={{ flex: 1 }} disabled={!files.length || busy} onClick={submit}>
            {busy ? `Uploading ${files.length}…` : `Add ${files.length || ''} to the map`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default UploadModal




