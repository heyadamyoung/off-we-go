import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addComment as saveComment,
  deleteComment,
  deletePhoto,
  loadTripPhotoPage,
  movePhotosToStop,
  setLike,
  updatePhoto,
  uploadPhoto,
} from '../../../backend'
import { photoUploadMetadata } from '../../../mobile-photos-core'
import { clamp } from '../../../shared/lib/numbers'
import { appErrorMessage } from '../../../user-messages-core'
import type {
  Id,
  Person,
  Toast,
  TripComment,
  TripData,
  TripPhoto,
  UploadInput,
  ViewerState,
} from '../../../shared/model/types'

interface UseTripPhotosOptions {
  data: TripData
  tripId: Id
  me: Person
  toast: Toast
  setSelected: (id: Id | null) => void
}

/* How many photographs one move may name. The server's own ceiling is five
   hundred; this stays clear of it so a batch that happens to include a retry
   never lands on the boundary. */
const MOVE_BATCH = 200

export default function useTripPhotos({
  data,
  tripId,
  me,
  toast,
  setSelected,
}: UseTripPhotosOptions) {
  const [photos, setPhotos] = useState<TripPhoto[]>(data.photos)
  const [comments, setComments] = useState<Record<Id, TripComment[]>>(data.comments || {})
  const [likes, setLikes] = useState<Set<Id>>(() => new Set(data.likes || []))
  const [viewer, setViewer] = useState<ViewerState | null>(null)

  /* The trip read is bounded now, so what arrived is the newest few hundred
     rather than the lot. Everything that draws photographs — the map's pins,
     a stop's tally, the grid — still wants all of them, so the rest is
     fetched quietly behind the first paint instead of being waited for.

     All of them, with no ceiling. The map clusters what it draws and the grid
     renders only the rows on screen, so a year of photographs costs a row in
     an array each rather than an element each. Holding a number the trip did
     not choose would mean a photograph somebody took being missing from their
     own trip, which is a worse failure than a large array. */
  const paging = useRef(false)
  useEffect(() => {
    const total = data.photoCount ?? 0
    if (paging.current || photos.length >= total) return
    paging.current = true
    let alive = true
    const oldest = photos.reduce(
      (low, photo) => Math.min(low, photo.seq ?? Number.POSITIVE_INFINITY),
      Number.POSITIVE_INFINITY,
    )
    /* The largest page the server will hand over. This runs behind a screen
       that is already drawn, so what matters is the number of round trips,
       not the size of any one of them: a trip of ten thousand is twenty
       requests at five hundred and fifty at two hundred. */
    loadTripPhotoPage(tripId, Number.isFinite(oldest) ? oldest : null, 500)
      .then(page => {
        if (!alive || !page.photos.length) return
        setPhotos(list => {
          const known = new Set(list.map(photo => photo.id))
          const older = page.photos.filter(photo => !known.has(photo.id))
          if (!older.length) return list
          // Oldest first, so the array stays in the seq order everything sorts by.
          return [...older.slice().reverse(), ...list]
        })
      })
      .catch(() => {
        /* A page that will not come is not worth a message: the trip is
           usable with what it has, and the next render tries again. */
      })
      .finally(() => {
        if (alive) paging.current = false
      })
    return () => {
      alive = false
    }
  }, [tripId, photos, data.photoCount])

  // Ids, not a snapshot: the viewer must reflect edits and deletions made while
  // it is open, which a captured array cannot.
  const openViewer = useCallback(
    (list: TripPhoto[], index: number) =>
      setViewer({
        ids: list.map(p => p.id),
        index: clamp(index, 0, list.length - 1),
      }),
    [],
  )
  const closeViewer = useCallback(() => setViewer(null), [])
  const setIndex = useCallback(
    (index: number) => setViewer(value => value && { ...value, index }),
    [],
  )

  // Optimistic, then reconciled with what the database actually stored — and
  // rolled back if it refused, so the UI never claims a comment that is not there.
  const addComment = useCallback(
    async (photoId: Id, text: string) => {
      const temp = { id: 'tmp' + Date.now(), by: me.name, text, when: 'just now', pending: true }
      setComments(c => ({ ...c, [photoId]: [...(c[photoId] || []), temp] }))
      try {
        const saved = await saveComment(tripId, photoId, text)
        setComments(c => ({
          ...c,
          [photoId]: (c[photoId] || []).map(x =>
            x.id === temp.id ? { ...temp, ...saved, pending: false } : x,
          ),
        }))
        toast('Comment posted')
      } catch (e) {
        setComments(c => ({ ...c, [photoId]: (c[photoId] || []).filter(x => x.id !== temp.id) }))
        toast(appErrorMessage(e, 'post-comment'), 'error')
      }
    },
    [tripId, me.name, toast],
  )

  const toggleLike = useCallback(
    async (id: Id) => {
      const on = !likes.has(id)
      setLikes(s => {
        const n = new Set(s)
        on ? n.add(id) : n.delete(id)
        return n
      })
      try {
        await setLike(tripId, id, on)
      } catch (e) {
        setLikes(s => {
          const n = new Set(s)
          on ? n.delete(id) : n.add(id)
          return n
        })
        toast(appErrorMessage(e, 'save-reaction'), 'error')
      }
    },
    [likes, tripId, toast],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: the queue keeps one sender; length covers the next sequence, and clashes reconcile by seq on the server
  const addPhoto = useCallback(
    async (input: UploadInput) => {
      const saved = await uploadPhoto(
        tripId,
        input.file,
        photoUploadMetadata(input, {
          by: me.name,
          nextSequence: Math.max(photos.length, ...photos.map(photo => (photo.seq ?? -1) + 1)),
        }),
      )
      setPhotos(list => [...list, saved])
      if (input.stopId) setSelected(input.stopId)
      return saved
    },
    [tripId, me.name, photos.length],
  )

  const changePhoto = useCallback(
    async (id: Id, fields: Partial<TripPhoto>) => {
      const before = photos.find(p => p.id === id)
      setPhotos(list => list.map(p => (p.id === id ? { ...p, ...fields } : p)))
      try {
        await updatePhoto(tripId, id, fields)
        toast('Photo changes saved')
      } catch (e) {
        if (before) setPhotos(list => list.map(p => (p.id === id ? before : p)))
        toast(appErrorMessage(e, 'save-photo'), 'error')
      }
    },
    [tripId, photos, toast],
  )

  /* Filing several at once. Optimistic like everything else here, and put
     back as a whole if the server says no: a bulk move that half-applied in
     the app and not at all on the server is worse than one that failed. */
  const movePhotos = useCallback(
    async (ids: Id[], filing: { stopId?: Id | null; stopPinned?: boolean }) => {
      if (!ids.length) return false
      const wanted = new Set(ids)
      const before = photos.filter(photo => wanted.has(photo.id))
      setPhotos(list => list.map(p => (wanted.has(p.id) ? { ...p, ...filing } : p)))
      try {
        /* In batches, because the server refuses more than five hundred in
           one request and "select all" on a long trip is more than that. Kept
           well under, and one after another rather than all at once: this is
           somebody tidying up, not a race. */
        const answer = { photos: [] as TripPhoto[] }
        for (let at = 0; at < ids.length; at += MOVE_BATCH) {
          const done = await movePhotosToStop(tripId, ids.slice(at, at + MOVE_BATCH), filing)
          if (done?.photos) answer.photos.push(...done.photos)
        }
        /* What came back, not what was asked for. Handing pictures back to
           the rule that files by distance is the one case where the answer is
           something no client could have worked out for itself. */
        const settled = new Map((answer?.photos || []).map(photo => [photo.id, photo]))
        if (settled.size)
          setPhotos(list =>
            list.map(p => {
              const now = settled.get(p.id)
              /* Merged, not replaced: the row in hand carries the signed
                 media links this page has already resolved. */
              return now ? { ...p, ...now } : p
            }),
          )
        /* Items, not photographs: a film lives in the same table and moves
           the same way, and the gallery and the picker both count in items. */
        const many = ids.length === 1 ? '1 item' : `${ids.length} items`
        toast(filing.stopPinned === false ? `${many} filed by location` : `${many} moved`)
        return true
      } catch (e) {
        const kept = new Map(before.map(photo => [photo.id, photo]))
        setPhotos(list => list.map(p => kept.get(p.id) ?? p))
        toast(appErrorMessage(e, 'save-photo'), 'error')
        /* Said, not thrown: the caller wants to know whether to put its
           screen away, and a rejected move should leave the picker where it
           is so the choice can be made again. */
        return false
      }
    },
    [tripId, photos, toast],
  )

  const removePhoto = useCallback(
    async (id: Id) => {
      const before = photos.find(p => p.id === id)
      const at = photos.findIndex(p => p.id === id)
      setPhotos(list => list.filter(p => p.id !== id))
      setViewer(v => {
        if (!v) return v
        const ids = v.ids.filter(x => x !== id)
        return ids.length ? { ids, index: clamp(v.index, 0, ids.length - 1) } : null
      })
      try {
        await deletePhoto(tripId, id)
        toast('Photo deleted')
      } catch (e) {
        /* Put back the one row, where it was. Restoring the whole array would
           also undo an upload that landed while this delete was in flight. */
        if (before) {
          setPhotos(list =>
            list.some(p => p.id === id) ? list : [...list.slice(0, at), before, ...list.slice(at)],
          )
        }
        toast(appErrorMessage(e, 'delete-photo'), 'error')
      }
    },
    [tripId, photos, toast],
  )

  const removeComment = useCallback(
    async (photoId: Id, id: Id) => {
      const before = (comments[photoId] || []).find(x => x.id === id)
      setComments(c => ({ ...c, [photoId]: (c[photoId] || []).filter(x => x.id !== id) }))
      try {
        await deleteComment(tripId, id)
        toast('Comment deleted')
      } catch (e) {
        // Only this comment comes back, not every comment on the trip.
        if (before) {
          setComments(c => ({
            ...c,
            [photoId]: (c[photoId] || []).some(x => x.id === id)
              ? c[photoId] || []
              : [...(c[photoId] || []), before],
          }))
        }
        toast(appErrorMessage(e, 'delete-comment'), 'error')
      }
    },
    [tripId, comments, toast],
  )

  /* The index counts positions in the list actually rendered, and that list
     drops ids no longer in `photos`. A photograph removed by somebody else
     shifts everything after it, so the index has to be found again against the
     list it indexes rather than carried across the gap. */
  const viewerList = useMemo(() => {
    if (!viewer) return null
    const by = new Map(photos.map(p => [p.id, p]))
    return viewer.ids.map(id => by.get(id)).filter((p): p is TripPhoto => !!p)
  }, [viewer, photos])

  const viewerIndex = useMemo(() => {
    if (!viewer || !viewerList?.length) return 0
    const showing = viewer.ids[viewer.index]
    const found = viewerList.findIndex(photo => photo.id === showing)
    return found >= 0 ? found : clamp(viewer.index, 0, viewerList.length - 1)
  }, [viewer, viewerList])

  return {
    photos,
    setPhotos,
    comments,
    setComments,
    likes,
    setLikes,
    viewer,
    viewerList,
    viewerIndex,
    openViewer,
    closeViewer,
    setIndex,
    addComment,
    toggleLike,
    addPhoto,
    changePhoto,
    movePhotos,
    removePhoto,
    removeComment,
  }
}
