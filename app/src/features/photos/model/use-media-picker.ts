import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { isNativeApp, pickNativePhotos } from '../../../mobile'
import { preparePhotoFilesForUpload, type MetadataFile } from '../../../mobile-photos-core'
import { isVideoFile, videoStill, withVideoMime } from '../../../mobile-videos-core'
import { appErrorMessage } from '../../../user-messages-core'
import { errorMessage, type Toast } from '../../../shared/model/types'

/** One thing chosen from the camera roll, ready to look at and to send. */
export interface ChosenMedia {
  file: MetadataFile
  /** The bytes themselves: an <img> for a photograph, a <video> for a film. */
  url: string
  /** The drawn opening frame, which is what every grid shows for a film. */
  posterUrl: string | null
  poster: File | null
  durationMs: number | null
  isVideo: boolean
  uploadKey: string
}

const newKey = (index: number) =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`

/* What makes two chosen files the same file. A camera roll hands back the
   whole selection every time it is opened, so choosing three and then
   choosing those three plus two more must add two, not five. Name, size and
   time are what a file system has to tell them apart with, and a collision
   would mean two identical photographs taken in the same millisecond — which
   is one photograph. */
const sameFile = (file: File) => `${file.name}|${file.size}|${file.lastModified}`

/* Reading a camera roll selection: HEIC photographs are converted, EXIF is
   read, and every film has its opening frame drawn — all of it on this
   device, so nothing leaves until the person has seen where it will land.

   The native photo picker is kept for photographs because it hands over the
   EXIF a file input drops. It cannot offer films at all, so those come
   through the system file picker, which in a Capacitor webview is the same
   camera roll by another door. */
export default function useMediaPicker({ toast }: { toast: Toast }) {
  const [files, setFiles] = useState<ChosenMedia[]>([])
  /* What is chosen, readable without making `take` depend on it — a callback
     rebuilt on every pick is a callback whose in-flight decode loop is looking
     at a stale list. */
  const current = useRef<ChosenMedia[]>([])
  current.current = files
  const [preparing, setPreparing] = useState(false)
  const [accept, setAccept] = useState('image/*,video/*')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const held = useRef<string[]>([])
  const mounted = useRef(true)
  const selection = useRef(0)

  /* Every object URL this hook made, let go together: without this a camera
     roll browsed a few times over holds every file it ever showed for the
     life of the tab. */
  const release = useCallback(() => {
    held.current.forEach(URL.revokeObjectURL)
    held.current = []
  }, [])

  /* Adding to what is already chosen rather than replacing it, because
     "choose more" is the thing people actually do and losing the first twelve
     to get a thirteenth is not a feature. Duplicates are dropped by identity,
     so re-picking the same selection is a no-op rather than a doubling. */
  const take = useCallback(
    async (chosen: MetadataFile[]) => {
      const round = ++selection.current
      setPreparing(true)
      try {
        const already = new Set(current.current.map(item => sameFile(item.file)))
        const fresh = chosen.filter(file => !already.has(sameFile(file)))
        if (!fresh.length) return
        const prepared = await preparePhotoFilesForUpload(fresh.map(withVideoMime))
        /* One decode at a time: a handful of 4K films seeked in parallel is how
         a phone's browser tab runs out of memory mid-selection. */
        const stills: ChosenMedia[] = []
        for (const [index, file] of prepared.entries()) {
          const video = isVideoFile(file)
          const still = video ? await videoStill(file) : null
          if (!mounted.current || round !== selection.current) return
          stills.push({
            file,
            url: URL.createObjectURL(file),
            posterUrl: still?.poster ? URL.createObjectURL(still.poster) : null,
            poster: still?.poster ?? null,
            durationMs: still?.durationMs ?? null,
            isVideo: video,
            uploadKey: newKey(index),
          })
        }
        held.current.push(
          ...stills.flatMap(item => [item.url, item.posterUrl].filter(Boolean) as string[]),
        )
        setFiles(list => [...list, ...stills])
      } finally {
        if (mounted.current && round === selection.current) setPreparing(false)
      }
    },
    [release],
  )

  /** The system file picker came back; the input is cleared so the same file
      can be chosen twice in a row. */
  const pick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = [...(event.target.files || [])]
      event.target.value = ''
      if (chosen.length)
        void take(chosen).catch(error => toast(appErrorMessage(error, 'open-photos'), 'error'))
    },
    [take, toast],
  )

  const openFilePicker = useCallback((types: string) => {
    setAccept(types)
    /* The attribute has to be on the element before it opens, and React
       writes it on the next render. */
    queueMicrotask(() => fileRef.current?.click())
  }, [])

  const choosePhotos = useCallback(async () => {
    try {
      const chosen = await pickNativePhotos()
      if (chosen) {
        if (chosen.length) await take(chosen)
        return
      }
      openFilePicker(isNativeApp ? 'image/*' : 'image/*,video/*')
    } catch (error) {
      if (!/cancel/i.test(errorMessage(error, '')))
        toast(appErrorMessage(error, 'open-photos'), 'error')
    }
  }, [take, toast, openFilePicker])

  const chooseVideos = useCallback(() => openFilePicker('video/*'), [openFilePicker])

  /** One taken back out, with its preview bytes let go rather than held to
      the end of the session. */
  const drop = useCallback((uploadKey: string) => {
    setFiles(list => {
      const going = list.find(item => item.uploadKey === uploadKey)
      for (const url of [going?.url, going?.posterUrl].filter(Boolean) as string[]) {
        URL.revokeObjectURL(url)
        held.current = held.current.filter(value => value !== url)
      }
      return list.filter(item => item.uploadKey !== uploadKey)
    })
  }, [])

  /** Start again: everything back, and every preview let go with it. */
  const clear = useCallback(() => {
    release()
    setFiles([])
  }, [release])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      selection.current += 1
      release()
    }
  }, [release])

  return { files, preparing, accept, fileRef, pick, choosePhotos, chooseVideos, drop, clear }
}
