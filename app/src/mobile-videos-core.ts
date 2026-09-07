/* What the app needs to know about a film before it sends one.

   A video carries none of the EXIF a photograph does, so its two useful facts
   have to be taken from the file itself: how long it runs, and what its
   opening looks like. The still matters more than it sounds — every grid, map
   marker and tray in this app draws a picture, and without one a trip full of
   videos is a page of grey rectangles where the holiday was. The browser
   already has a decoder, so the poster frame is drawn here, on the device
   that filmed it, rather than asking the VPS to grow an encoder. */

import type { MetadataFile, PhotoExifMetadata } from './mobile-photos-core'

/* The formats a phone hands over, and the only ones the server keeps. An
   extension is checked too: Android sometimes offers a .mp4 as
   application/octet-stream, and refusing it would be refusing the video the
   person is looking at. */
const VIDEO_MIME = /^video\/(mp4|quicktime|x-m4v|webm|3gpp|mpeg|x-matroska)$/i
const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|3gp|mpe?g|mkv)$/i

/** What we send when the picker's own type is empty or a lie about a .mp4. */
const MIME_BY_EXTENSION: Array<[RegExp, string]> = [
  [/\.mp4$/i, 'video/mp4'],
  [/\.mov$/i, 'video/quicktime'],
  [/\.m4v$/i, 'video/x-m4v'],
  [/\.webm$/i, 'video/webm'],
  [/\.3gp$/i, 'video/3gpp'],
  [/\.mpe?g$/i, 'video/mpeg'],
  [/\.mkv$/i, 'video/x-matroska'],
]

export const isVideoFile = (file: { type?: string; name?: string } | null | undefined) =>
  VIDEO_MIME.test(file?.type || '') ||
  (!file?.type?.startsWith('image/') && VIDEO_EXTENSION.test(file?.name || ''))

/** The type to upload under, correcting a picker that gave us nothing usable. */
export function videoMimeFor(file: { type?: string; name?: string }): string {
  if (VIDEO_MIME.test(file?.type || '')) return file.type as string
  const named = MIME_BY_EXTENSION.find(([pattern]) => pattern.test(file?.name || ''))
  return named ? named[1] : 'video/mp4'
}

/* Android pickers hand over a perfectly good .mp4 typed as
   application/octet-stream often enough to matter, and the server refuses
   what it cannot name. Re-labelling costs nothing — a File built from a File
   shares the same bytes — and it is the difference between a video that
   uploads and a 415 the person cannot act on. */
export function withVideoMime(file: MetadataFile): MetadataFile {
  if (!isVideoFile(file)) return file
  const mime = videoMimeFor(file)
  if (file.type === mime) return file
  return new File([file], file.name, { type: mime, lastModified: file.lastModified })
}

/** Three hours is past anything a camera roll holds; longer is a bad decode. */
const MAX_DURATION_MS = 10_800_000

export interface VideoStill {
  /** The opening frame, as a JPEG to upload beside the film. */
  poster: File | null
  durationMs: number | null
  width: number | null
  height: number | null
}

const empty: VideoStill = { poster: null, durationMs: null, width: null, height: null }

/* A frame a whole second in: the first frame of a handheld video is very
   often the ceiling, a pocket, or the blur of a phone still being raised.
   Films shorter than that get their middle instead. */
export const posterTime = (durationSeconds: number) =>
  !Number.isFinite(durationSeconds) || durationSeconds <= 0
    ? 0
    : Math.min(1, Math.max(0, durationSeconds / 2))

/** The largest poster worth sending; the server resizes it again anyway. */
const POSTER_EDGE = 1280

export function posterSize(width: number, height: number) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, POSTER_EDGE / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

interface StillOptions {
  /** Injected so the still can be tested without a decoder in the room. */
  createVideo?: () => HTMLVideoElement
  /** Injected the same way; a real canvas needs a document to come from. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement
  /** How long to wait on a codec the browser turns out not to have. */
  timeoutMs?: number
}

const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') return resolve(null)
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.82)
  })

/* Draws the still, and gives up rather than hanging: a video whose codec this
   browser cannot decode fires neither `loadeddata` nor `error` on some
   platforms, and an upload sheet that waits for ever on it is worse than one
   that sends the film with no poster. */
export async function videoStill(
  file: File,
  { createVideo, createCanvas, timeoutMs = 8000 }: StillOptions = {},
): Promise<VideoStill> {
  if (typeof document === 'undefined' && !createVideo) return empty
  const video = createVideo
    ? createVideo()
    : Object.assign(document.createElement('video'), {
        /* `metadata` is enough to learn the length but not always enough to
           have a frame in hand, and a film with no seekable duration is
           drawn from the frame it already holds. */
        preload: 'auto',
        muted: true,
        // iOS will not decode into a canvas from a video that wants fullscreen.
        playsInline: true,
      })
  const url = URL.createObjectURL(file)
  let timer: ReturnType<typeof setTimeout> | null = null
  const forget = () => {
    video.onloadedmetadata = null
    video.onloadeddata = null
    video.onseeked = null
    video.onerror = null
  }
  try {
    const drawn = await new Promise<VideoStill>(resolve => {
      const give = (value: VideoStill) => {
        forget()
        resolve(value)
      }
      timer = setTimeout(() => give(empty), timeoutMs)
      const facts = () => {
        const seconds = Number(video.duration)
        const durationMs =
          Number.isFinite(seconds) && seconds > 0
            ? Math.min(Math.round(seconds * 1000), MAX_DURATION_MS)
            : null
        return {
          durationMs,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
        }
      }
      const draw = async () => {
        // Whichever event got here first wins; the others stop mattering.
        forget()
        const { width, height } = posterSize(video.videoWidth, video.videoHeight)
        if (!width || !height) return resolve({ poster: null, ...facts() })
        const canvas = createCanvas
          ? createCanvas(width, height)
          : Object.assign(document.createElement('canvas'), { width, height })
        const context = canvas.getContext?.('2d')
        if (!context) return resolve({ poster: null, ...facts() })
        /* A cross-origin frame taints the canvas and toBlob throws; a blob:
           URL of our own file never does, but the film matters more than its
           poster, so a refusal here is not a failed upload. */
        let blob: Blob | null = null
        try {
          context.drawImage(video, 0, 0, width, height)
          blob = await canvasBlob(canvas)
        } catch {
          blob = null
        }
        resolve({
          poster: blob
            ? new File([blob], `${(file.name || 'video').replace(/\.[^.]+$/, '')}.poster.jpg`, {
                type: 'image/jpeg',
                lastModified: file.lastModified,
              })
            : null,
          ...facts(),
        })
      }
      video.onerror = () => give(empty)
      video.onseeked = () => void draw()
      /* Seeking is what usually puts a frame on the screen to copy — but a
         film recorded rather than saved often has no duration to seek within,
         and asking for the position it is already at fires no `seeked` at
         all. Either way the first frame it has is a poster worth drawing. */
      video.onloadeddata = () => {
        if (!(posterTime(Number(video.duration)) > 0)) void draw()
      }
      video.onloadedmetadata = () => {
        const target = posterTime(Number(video.duration))
        if (!(target > 0)) return
        try {
          video.currentTime = target
        } catch {
          void draw()
        }
      }
      video.src = url
      video.load?.()
    })
    return drawn
  } catch {
    return empty
  } finally {
    if (timer) clearTimeout(timer)
    forget()
    video.src = ''
    URL.revokeObjectURL(url)
  }
}

/* A film has no EXIF to read, but the phone did stamp the file when it wrote
   it — which for something filmed on that phone is when it was filmed. It is
   only ever a fallback: a real capture time from the picker wins. */
export function videoMetadata(file: MetadataFile): PhotoExifMetadata | null {
  const existing = file?.offwegoMetadata
  if (existing?.takenAt) return existing
  const stamped = Number(file?.lastModified)
  if (!Number.isFinite(stamped) || stamped <= 0) return existing ?? null
  const at = new Date(stamped)
  return Number.isNaN(at.getTime())
    ? (existing ?? null)
    : { ...existing, takenAt: at.toISOString() }
}

/** `1:07`, the way a camera roll writes it. Null for a film of unknown length. */
export function durationLabel(durationMs: number | null | undefined): string | null {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return null
  // Floor, the way a camera roll does: a clip labelled 0:13 that stops at
  // 12.5 seconds reads as a clip that lost its ending.
  const total = Math.floor(durationMs / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
