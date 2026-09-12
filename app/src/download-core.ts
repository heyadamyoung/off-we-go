/* Keeping a copy of a photograph.
 *
 * Sharing hands a picture to somebody else; downloading hands it back to the
 * person who is already looking at it. They are not the same thing and the
 * difference is where the file ends up — a share sheet is a conversation, a
 * download is a file on your own device that is still there tomorrow.
 *
 * Which makes this a ladder too, for the same reason share-core is one: the
 * browser in the phone app and the browser on a laptop disagree about how a
 * file is saved, and that disagreement belongs somewhere it can be argued
 * with rather than discovered by somebody on a mountain with no signal.
 */

export type DownloadWay =
  /** The phone app: the file is written into the device's own storage. A
      WKWebView ignores the download attribute entirely, so the web answer is
      not merely worse here, it silently does nothing at all. */
  | 'device'
  /** A browser: a blob, a link carrying `download`, and one synthetic click. */
  | 'anchor'

export interface DownloadAbility {
  /** Running inside the native shell, where the filesystem plugin exists. */
  native?: boolean
  /** A document to hang a link off — absent in a worker, or in a test. */
  anchor?: boolean
}

/**
 * How this device saves a file.
 *
 * Native first, and not as a preference: `<a download>` in a WKWebView does
 * nothing whatsoever — no error, no file, no hint to the person tapping it.
 * Reaching the anchor rung inside the app would be a button that lies.
 */
export function downloadWay(can: DownloadAbility): DownloadWay | null {
  if (can.native) return 'device'
  if (can.anchor) return 'anchor'
  return null
}

/* What the file is called on disk, by what is actually in it rather than by
   what we think we stored. Photographs are always re-encoded to JPEG on the
   way in, but a film keeps the container it arrived in, and a .mp4 that is
   really a QuickTime is a file some desktops refuse to open. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
}

/** The extension for a media type, falling back on the kind when it is junk. */
export function extensionFor(mime: string | null | undefined, video = false): string {
  const clean = String(mime ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  return EXTENSIONS[clean] || (video ? 'mp4' : 'jpg')
}

export interface DownloadNaming {
  caption?: string | null
  /** The photograph's id. Its tail is what keeps two untitled pictures from
      the same afternoon from becoming one file. */
  id?: string | null
  /** When it was taken, for a folder that sorts itself. */
  takenAt?: string | null
  mime?: string | null
  video?: boolean
}

/**
 * A filename somebody can find again.
 *
 * Three parts, and each one earns its place. The caption, because that is what
 * the picture is called to the person who took it. The date, because a folder
 * of holiday photographs is read in order. And a short piece of the id,
 * because the phone writes into a real directory and `writeFile` overwrites
 * without asking — two captionless pictures from the same day sharing a name
 * is somebody saving two photographs and finding one.
 */
export function downloadName({ caption, id, takenAt, mime, video }: DownloadNaming): string {
  const stem =
    String(caption ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'off-we-go'
  const day = isoDay(takenAt)
  const tail = String(id ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toLowerCase()
  return [stem, day, tail].filter(Boolean).join('-') + '.' + extensionFor(mime, video)
}

/* An unparseable instant is not a reason to refuse to save something, so a
   date that makes no sense simply does not appear in the name. */
function isoDay(value: string | null | undefined): string {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toISOString().slice(0, 10)
}

/**
 * What to say once it has landed — which has to name the place, because on a
 * phone "Saved" with no destination is a file the person cannot find and will
 * assume was never written.
 */
export function downloadOutcome(way: DownloadWay | null, platform?: string): string {
  if (way === 'device') {
    return platform === 'ios' ? 'Saved to Files, under Off We Go' : 'Saved to your Documents folder'
  }
  if (way === 'anchor') return 'Saved'
  return 'Saving is not available in this browser'
}

/**
 * The same media link, asking for a file rather than a picture.
 *
 * The server answers this with `Content-Disposition: attachment`, which is
 * what makes a download a download without the browser first holding the
 * whole thing in memory — the difference between saving a photograph and
 * saving a twenty-minute film off a phone.
 *
 * The name travels in the query because the route is addressed by storage
 * path and knows nothing of captions. It is scrubbed at the other end.
 */
export function downloadUrl(src: string, name: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`
}

/** Whether this is a link we serve, and can therefore ask to be an attachment. */
export function oursToServe(src: string | null | undefined): boolean {
  return String(src ?? '').includes('/api/media/')
}
