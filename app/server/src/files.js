import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { dirname, extname, join, normalize, posix, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { videoExtension } from './media-types.js'
import { MASTER_NAME, hlsDirectory } from './hls.js'

/** Every file under a directory, as paths relative to it, deepest last. */
export async function filesUnder(directory, base = '') {
  const entries = await readdir(join(directory, base), { withFileTypes: true })
  const found = []
  for (const entry of entries) {
    const next = base ? posix.join(base, entry.name) : entry.name
    if (entry.isDirectory()) found.push(...(await filesUnder(directory, next)))
    else found.push(next)
  }
  return found
}

/** Thrown when a stream runs past the ceiling it was given. */
export class TooLarge extends Error {
  constructor(limit) {
    super(`Larger than the ${limit} byte limit`)
    this.name = 'TooLarge'
    this.code = 'MEDIA_TOO_LARGE'
    this.limit = limit
  }
}

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
       it worse, and the phone already wrote something every browser plays.

       It is written straight from the wire to the disk and never held whole
       in memory: a minute of 4K is a couple of hundred megabytes, and
       buffering that on a 2GB box beside Postgres is how the API dies
       mid-upload — taking every other request with it. */
    async storeVideo({ tripId, source, mime, limit = Number.POSITIVE_INFINITY }) {
      const extension = videoExtension(mime)
      if (!extension) throw new Error('Unsupported video type')
      const storagePath = `${tripId}/${randomUUID()}.${extension}`
      const target = absolute(storagePath)
      await mkdir(dirname(target), { recursive: true })
      const temporary = `${target}.${randomUUID()}.tmp`
      let written = 0
      /* The ceiling is enforced as the bytes go past, not after they have all
         arrived: the point is never to hold or store more than the limit. */
      async function* metered(chunks) {
        for await (const chunk of chunks) {
          written += chunk.length
          if (written > limit) throw new TooLarge(limit)
          yield chunk
        }
      }
      try {
        await pipeline(metered(source), createWriteStream(temporary, { flags: 'wx' }))
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
      if (!written) {
        await rm(temporary, { force: true })
        throw new Error('The upload carried no bytes')
      }
      await rename(temporary, target)
      return { storagePath, bytes: written }
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
    /* A worker needs the film on its own disk to convert it. On this store
       that is a copy; on an object store it will be a download — which is
       exactly why the worker asks for it by name rather than reaching for a
       path itself. */
    async download(storagePath, localPath) {
      await pipeline(createReadStream(absolute(storagePath)), createWriteStream(localPath))
      return localPath
    },
    /* The converted film takes the original's place. It gets a new path
       because the container changed — a .mov that is now an mp4 served as
       video/quicktime is refused by the browsers the conversion was for. The
       old path is returned so the caller can retire it once the row points at
       the new one, never before. */
    async replaceVideo({ storagePath, file, mime }) {
      const extension = videoExtension(mime) || 'mp4'
      const stem = String(storagePath).slice(0, -extname(String(storagePath)).length)
      const target = `${stem}.converted.${extension}`
      const destination = absolute(target)
      await mkdir(dirname(destination), { recursive: true })
      const temporary = `${destination}.${randomUUID()}.tmp`
      try {
        await pipeline(createReadStream(file), createWriteStream(temporary, { flags: 'wx' }))
        await rename(temporary, destination)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
      return { storagePath: target, replaced: storagePath }
    },
    /** The same poster derivatives, from a frame already drawn to a file. */
    async storePosterFile({ storagePath, file }) {
      return this.storePoster({ storagePath, bytes: await readFile(file) })
    },
    /* A film's adaptive stream: a small tree of playlists and segments that
       goes up whole or not at all. It lives beside the film under a name
       derived from it, so the two are found, served and forgotten together
       without a second column to keep in step.

       The master playlist is written last. It is the only path anything else
       records, so until it exists the tree is invisible — which is exactly
       what should happen to a stream whose upload died halfway. */
    async storeHls({ storagePath, directory }) {
      const prefix = hlsDirectory(storagePath)
      const files = (await filesUnder(directory)).filter(name => name !== MASTER_NAME)
      let bytes = 0
      for (const name of files) {
        const source = join(directory, name)
        const target = absolute(`${prefix}/${name}`)
        await mkdir(dirname(target), { recursive: true })
        const temporary = `${target}.${randomUUID()}.tmp`
        try {
          await pipeline(createReadStream(source), createWriteStream(temporary, { flags: 'wx' }))
          await rename(temporary, target)
        } catch (error) {
          await rm(temporary, { force: true })
          throw error
        }
        bytes += (await stat(target)).size
      }
      const master = await readFile(join(directory, MASTER_NAME))
      await writeAtomic(`${prefix}/${MASTER_NAME}`, master)
      return {
        hlsPath: `${prefix}/${MASTER_NAME}`,
        files: files.length + 1,
        bytes: bytes + master.length,
      }
    },
    /* Bytes at a path, exactly as given, with no derivatives and no renaming.
       Every other write here decides where something goes; this one is told,
       which is what moving a store's whole contents somewhere else needs. */
    async putObject({ storagePath, file }) {
      const destination = absolute(storagePath)
      await mkdir(dirname(destination), { recursive: true })
      const temporary = `${destination}.${randomUUID()}.tmp`
      try {
        await pipeline(createReadStream(file), createWriteStream(temporary, { flags: 'wx' }))
        await rename(temporary, destination)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
      return { storagePath, bytes: (await stat(destination)).size }
    },
    /* A whole stream, gone. The deletion queue holds paths rather than
       trees, so a prefix arrives here with a trailing slash and is expanded
       on the store that knows how — which on a volume is one call. */
    async removeTree(prefix) {
      await rm(absolute(String(prefix).replace(/\/+$/, '')), { recursive: true, force: true })
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
