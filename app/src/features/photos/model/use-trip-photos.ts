import { useCallback, useMemo, useState } from 'react'
import {
  addComment as saveComment, deleteComment, deletePhoto, setLike,
  updatePhoto, uploadPhoto,
} from '../../../backend'
import { photoUploadMetadata } from '../../../mobile-photos-core'
import { clamp } from '../../../shared/lib/numbers'
import { appErrorMessage } from '../../../user-messages-core'
import type {
  Id, Person, Toast, TripComment, TripData, TripPhoto, UploadInput, ViewerState,
} from '../../../shared/model/types'

interface UseTripPhotosOptions {
  data: TripData
  tripId: Id
  me: Person
  toast: Toast
  setSelected: (id: Id | null) => void
}

export default function useTripPhotos({ data, tripId, me, toast, setSelected }: UseTripPhotosOptions) {
  const [photos, setPhotos] = useState<TripPhoto[]>(data.photos)
  const [comments, setComments] = useState<Record<Id, TripComment[]>>(data.comments || {})
  const [likes, setLikes] = useState<Set<Id>>(() => new Set(data.likes || []))
  const [viewer, setViewer] = useState<ViewerState | null>(null)

  // Ids, not a snapshot: the viewer must reflect edits and deletions made while
  // it is open, which a captured array cannot.
  const openViewer = useCallback((list: TripPhoto[], index: number) => setViewer({
    ids: list.map(p => p.id), index: clamp(index, 0, list.length - 1),
  }), [])
  const closeViewer = useCallback(() => setViewer(null), [])
  const setIndex = useCallback((index: number) => setViewer(value => value && ({ ...value, index })), [])

  // Optimistic, then reconciled with what the database actually stored — and
  // rolled back if it refused, so the UI never claims a comment that is not there.
  const addComment = useCallback(async (photoId: Id, text: string) => {
    const temp = { id: 'tmp' + Date.now(), by: me.name, text, when: 'just now', pending: true }
    setComments(c => ({ ...c, [photoId]: [...(c[photoId] || []), temp] }))
    try {
      const saved = await saveComment(tripId, photoId, text)
      setComments(c => ({
        ...c,
        [photoId]: (c[photoId] || []).map(x => (x.id === temp.id ? { ...temp, ...saved, pending: false } : x)),
      }))
      toast('Comment posted')
    } catch (e) {
      setComments(c => ({ ...c, [photoId]: (c[photoId] || []).filter(x => x.id !== temp.id) }))
      toast(appErrorMessage(e, 'post-comment'), 'error')
    }
  }, [tripId, me.name, toast])

  const toggleLike = useCallback(async (id: Id) => {
    const on = !likes.has(id)
    setLikes(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })
    try {
      await setLike(tripId, id, on)
    } catch (e) {
      setLikes(s => { const n = new Set(s); on ? n.delete(id) : n.add(id); return n })
      toast(appErrorMessage(e, 'save-reaction'), 'error')
    }
  }, [likes, tripId, toast])

  const addPhoto = useCallback(async (input: UploadInput) => {
    const saved = await uploadPhoto(tripId, input.file,
      photoUploadMetadata(input, { by: me.name, nextSequence: photos.length }))
    setPhotos(list => [...list, saved])
    if (input.stopId) setSelected(input.stopId)
    return saved
  }, [tripId, me.name, photos.length])

  const changePhoto = useCallback(async (id: Id, fields: Partial<TripPhoto>) => {
    const before = photos.find(p => p.id === id)
    setPhotos(list => list.map(p => (p.id === id ? { ...p, ...fields } : p)))
    try { await updatePhoto(tripId, id, fields); toast('Photo changes saved') }
    catch (e) {
      setPhotos(list => list.map(p => (p.id === id ? before : p)))
      toast(appErrorMessage(e, 'save-photo'), 'error')
    }
  }, [tripId, photos, toast])

  const removePhoto = useCallback(async (id: Id) => {
    const before = photos
    setPhotos(list => list.filter(p => p.id !== id))
    setViewer(v => {
      if (!v) return v
      const ids = v.ids.filter(x => x !== id)
      return ids.length ? { ids, index: clamp(v.index, 0, ids.length - 1) } : null
    })
    try { await deletePhoto(tripId, id); toast('Photo deleted') }
    catch (e) { setPhotos(before); toast(appErrorMessage(e, 'delete-photo'), 'error') }
  }, [tripId, photos, toast])

  const removeComment = useCallback(async (photoId: Id, id: Id) => {
    const before = comments
    setComments(c => ({ ...c, [photoId]: (c[photoId] || []).filter(x => x.id !== id) }))
    try { await deleteComment(tripId, id); toast('Comment deleted') }
    catch (e) { setComments(before); toast(appErrorMessage(e, 'delete-comment'), 'error') }
  }, [tripId, comments, toast])

  const viewerList = useMemo(() => {
    if (!viewer) return null
    const by = new Map(photos.map(p => [p.id, p]))
    return viewer.ids.map(id => by.get(id)).filter(Boolean)
  }, [viewer, photos])

  return {
    photos, setPhotos, comments, setComments, likes, setLikes, viewer, viewerList,
    openViewer, closeViewer, setIndex, addComment, toggleLike, addPhoto,
    changePhoto, removePhoto, removeComment,
  }
}

