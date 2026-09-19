import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { isNativeApp } from '../../../mobile'
import { readPhotoFiles, type MetadataFile } from '../../../mobile-photos-core'
import { isVideoFile, tooBigToSend, videoStill, withVideoMime } from '../../../mobile-videos-core'
import { photoThumbnail } from '../../../photo-thumb-core'
import { appErrorMessage } from '../../../user-messages-core'
import type { Toast } from '../../../shared/model/types'

/** One thing chosen from the camera roll, ready to look at and to send. */
export interface ChosenMedia {
  file: MetadataFile
  /** The bytes themselves: an <img> for a photograph, a <video> for a film. */
  url: string
  /** The drawn opening frame, which is what every grid shows for a film. */
  posterUrl: string | null
  poster: File | null
  /* A tile-sized copy, and the only thing anything ever draws. Thirty
     photographs on screen at their own size is thirty full decodes and about
     a gigabyte of bitmap; at three hundred pixels it is nothing. Null when
     the browser would not decode it, and then the full file is drawn as it
     always was. */
  thumb: Blob | null
  thumbUrl: string | null
  /* Whether this browser can put the file on screen at all. A HEIC is a
     picture everywhere and an image only in Safari, so the tile for one
     elsewhere is an icon rather than a broken <img>. */
  drawable: boolean
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
        const picked = chosen.filter(file => !already.has(sameFile(file)))
        /* Too big is too big now, not after ten minutes of a hotel's
           upstream and a 413. Said by name, one line per file, because a
           selection of twenty with two impossible ones in it should send the
           eighteen rather than refuse the lot. */
        const refusals = picked.map(tooBigToSend)
        const fresh = picked.filter((_, i) => !refusals[i])
        for (const refusal of refusals.filter(Boolean)) toast(refusal as string, 'warning')
        if (!fresh.length) return
        const prepared = await readPhotoFiles(fresh.map(withVideoMime))
        /* One decode at a time: a handful of 4K films seeked in parallel is how
         a phone's browser tab runs out of memory mid-selection. */
        const stills: ChosenMedia[] = []
        for (const [index, file] of prepared.entries()) {
          const video = isVideoFile(file)
          const still = video ? await videoStill(file) : null
          /* A film is drawn from the frame we just took off it; a photograph
             from itself. Either way it is the small copy that gets drawn, and
             the big one is closed before the next file is opened. */
          const thumb = await photoThumbnail(still?.poster || file)
          if (!mounted.current || round !== selection.current) return
          stills.push({
            file,
            url: URL.createObjectURL(file),
            posterUrl: still?.poster ? URL.createObjectURL(still.poster) : null,
            poster: still?.poster ?? null,
            thumb,
            thumbUrl: thumb ? URL.createObjectURL(thumb) : null,
            /* A thumbnail proves the decoder took it. Without one, only a
               type the browser draws natively is worth pointing an <img> at. */
            drawable: !!thumb || /^image\/(jpeg|png|gif|webp|avif)$/i.test(file.type || ''),
            durationMs: still?.durationMs ?? null,
            isVideo: video,
            uploadKey: newKey(index),
          })
        }
        held.current.push(
          ...stills.flatMap(
            item => [item.url, item.posterUrl, item.thumbUrl].filter(Boolean) as string[],
          ),
        )
        setFiles(list => [...list, ...stills])
      } finally {
        if (mounted.current && round === selection.current) setPreparing(false)
      }
    },
    [release, toast],
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
    const input = fileRef.current
    if (!input) return
    /* Straight onto the element, and then opened in the same breath.

       This went through state and a microtask, on the reasoning that the
       attribute has to be right before the picker opens and React writes it on
       the next render. A microtask does not wait for a render. So the picker
       opened carrying whatever `accept` the previous tap had left on it, and on
       iOS that is not cosmetic: the system picker honours the attribute
       absolutely. Tap Add photos once — which asks for `image/*` on a phone —
       and every Add videos after it opened a library filtered to photographs,
       with no film in it to choose. Which is exactly "video upload does not
       work", from the only door it can be reached by.

       Setting the property is also synchronous inside the tap, which keeps the
       user gesture intact; a click deferred out of the gesture is one a
       WKWebView is entitled to refuse outright. State is kept in step so a
       later render writes back what is already there rather than undoing it. */
    input.accept = types
    setAccept(types)
    input.click()
  }, [])

  /* The system file picker, on the phone as well as the web.
   *
   * It used to be Capacitor's photo picker here, which looked better and quietly
   * destroyed the thing this screen exists to collect. That plugin re-encodes
   * every image from a UIImage, so the EXIF block — where the picture was taken,
   * and when — is gone by the time we see it; it puts the metadata back
   * afterwards from a PHAsset lookup, and a photo library shared as "Selected
   * Photos" answers that lookup for nothing. Neither half fails loudly. What
   * arrived was a picture with no position and no capture time, which the app
   * then filed at wherever the phone happened to be when it was uploaded.
   *
   * A file input hands over the original bytes. No re-encode, no asset lookup,
   * no photo-library permission to get wrong — and the block is read off the
   * original bytes, so it survives HEIC too. */
  const choosePhotos = useCallback(() => {
    openFilePicker(isNativeApp ? 'image/*' : 'image/*,video/*')
  }, [openFilePicker])

  const chooseVideos = useCallback(() => openFilePicker('video/*'), [openFilePicker])

  /** One taken back out, with its preview bytes let go rather than held to
      the end of the session. */
  const drop = useCallback((uploadKey: string) => {
    setFiles(list => {
      const going = list.find(item => item.uploadKey === uploadKey)
      for (const url of [going?.url, going?.posterUrl, going?.thumbUrl].filter(
        Boolean,
      ) as string[]) {
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
