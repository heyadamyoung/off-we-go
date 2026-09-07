import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants, createReadStream } from 'node:fs'
import { dirname, extname, normalize, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { videoExtension } from './media-types.js'

export function createDiskFileStore({ directory }) {
  const root = resolve(directory)

  const absolute = storagePath => {
    const candidate = resolve(root, normalize(storagePath))
    const rest = relative(root, candidate)
    if (!rest || rest.startsWith('..') || rest.includes(':'))
      throw new Error('Invalid storage path')
    return candidate
  }

  const writeAtomic = async (storagePath, bytes) => {
    const target = absolute(storagePath)
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, target)
  }

  /* The two sizes the whole app draws with: one to look at, one for the grids
     and the map markers. A photograph is its own source; a video's is the
     poster frame the phone drew for us. */
  const derivatives = async bytes => {
    const image = sharp(bytes, { failOn: 'warning' }).rotate()
    const display = await image
      .clone()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer()
    const thumbnail = await image
      .clone()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 76, mozjpeg: true })
      .toBuffer()
    return { display, thumbnail }
  }

  return {
    async ready() {
      await mkdir(root, { recursive: true })
      await access(root, constants.R_OK | constants.W_OK)
    },
    async storePhoto({ tripId, bytes }) {
      const id = randomUUID()
      const storagePath = `${tripId}/${id}.jpg`
      const thumbPath = `${tripId}/${id}.thumb.jpg`
      const { display, thumbnail } = await derivatives(bytes)
      await writeAtomic(storagePath, display)
      try {
        await writeAtomic(thumbPath, thumbnail)
      } catch (error) {
        await rm(absolute(storagePath), { force: true })
        throw error
      }
      return { storagePath, thumbPath }
    },
    /* A film, kept as it was filmed. There is no encoder on this box and no
       wish for one: re-encoding a holiday video costs minutes of CPU to make
       it worse, and the phone already wrote something every browser plays. */
    async storeVideo({ tripId, bytes, mime }) {
      const extension = videoExtension(mime)
      if (!extension) throw new Error('Unsupported video type')
      const storagePath = `${tripId}/${randomUUID()}.${extension}`
      await writeAtomic(storagePath, bytes)
      return { storagePath, bytes: bytes.length }
    },
    /* The still that stands in for a film everywhere a film cannot play: the
       grid, the map marker, the strip under the viewer. It is derived from a
       frame the phone drew, and it lives beside its video so the two are
       found and forgotten together. */
    async storePoster({ storagePath: videoPath, bytes }) {
      const stem = String(videoPath).slice(0, -extname(String(videoPath)).length)
      const posterPath = `${stem}.poster.jpg`
      const thumbPath = `${stem}.thumb.jpg`
      const { display, thumbnail } = await derivatives(bytes)
      await writeAtomic(posterPath, display)
      try {
        await writeAtomic(thumbPath, thumbnail)
      } catch (error) {
        await rm(absolute(posterPath), { force: true })
        throw error
      }
      return { posterPath, thumbPath }
    },
    /* A leg's paperwork, stored as it arrived: a boarding pass loses its QR
       to recompression, so documents are bytes in, bytes out. */
    async storeDocument({ tripId, bytes, extension }) {
      const safe = /^[a-z0-9]{1,8}$/i.test(String(extension || '')) ? extension : 'bin'
      const storagePath = `${tripId}/docs/${randomUUID()}.${safe}`
      await writeAtomic(storagePath, bytes)
      return { storagePath, bytes: bytes.length }
    },
    async storeAvatar({ profileId, bytes }) {
      // A stable path prevents replaced profile images from becoming
      // unreferenced personal data on disk.
      const avatarPath = `profiles/${profileId}.jpg`
      const image = await sharp(bytes, { failOn: 'warning' })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
      await writeAtomic(avatarPath, image)
      return { avatarPath }
    },
    async read(storagePath) {
      return readFile(absolute(storagePath))
    },
    /** How big, so a range request can be answered without reading the file. */
    async size(storagePath) {
      return (await stat(absolute(storagePath))).size
    },
    /* A film is tens of megabytes and is watched from wherever the thumb drops
       it, so it is never read into memory whole: the reply is a stream over
       exactly the bytes asked for. */
    open(storagePath, { start, end } = {}) {
      return createReadStream(absolute(storagePath), {
        ...(start === undefined ? {} : { start }),
        ...(end === undefined ? {} : { end }),
      })
    },
    async remove(storagePath) {
      await rm(absolute(storagePath), { force: true })
    },
  }
}
