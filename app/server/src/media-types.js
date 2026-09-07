/* What Off We Go accepts, and what it calls the bytes it stored. No image
   library in here on purpose: the API needs these answers on every media
   request, and it should not have to load an encoder to give them. */

import { extname } from 'node:path'

/* The film formats a phone actually hands over, and the extension each is
   stored under. Anything not named here is refused at the door rather than
   accepted and served back as bytes no browser will play. */
const VIDEO_EXTENSIONS = new Map([
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
  ['video/x-m4v', 'm4v'],
  ['video/webm', 'webm'],
  ['video/3gpp', '3gp'],
  ['video/mpeg', 'mpg'],
  ['video/x-matroska', 'mkv'],
])

/** `video/mp4; codecs=avc1` is still video/mp4 — the parameters are not ours. */
const bareMime = mime =>
  String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim()

export const videoExtension = mime => VIDEO_EXTENSIONS.get(bareMime(mime)) || null
export const isSupportedVideo = mime => videoExtension(mime) !== null

/* What a stored file is, by the extension we ourselves gave it. Everything on
   this volume was written by this server, so the extension is trustworthy in
   a way an uploaded filename never is — and a boarding pass served as
   image/jpeg is a boarding pass the browser will not open. */
const CONTENT_TYPES = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['heic', 'image/heic'],
  ['pdf', 'application/pdf'],
  ...[...VIDEO_EXTENSIONS].map(([mime, extension]) => [extension, mime]),
])

export const mediaContentType = storagePath =>
  CONTENT_TYPES.get(
    extname(String(storagePath || ''))
      .slice(1)
      .toLowerCase(),
  ) || 'application/octet-stream'

export const isVideoPath = storagePath => mediaContentType(storagePath).startsWith('video/')
