import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

export function createDiskFileStore({ directory }) {
  const root = resolve(directory)

  const absolute = storagePath => {
    const candidate = resolve(root, normalize(storagePath))
    const rest = relative(root, candidate)
    if (!rest || rest.startsWith('..') || rest.includes(':')) throw new Error('Invalid storage path')
    return candidate
  }

  const writeAtomic = async (storagePath, bytes) => {
    const target = absolute(storagePath)
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, target)
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
      const image = sharp(bytes, { failOn: 'warning' }).rotate()
      const display = await image.clone().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 84, mozjpeg: true }).toBuffer()
      const thumbnail = await image.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 76, mozjpeg: true }).toBuffer()
      await writeAtomic(storagePath, display)
      try { await writeAtomic(thumbPath, thumbnail) }
      catch (error) { await rm(absolute(storagePath), { force: true }); throw error }
      return { storagePath, thumbPath }
    },
    async storeAvatar({ tripId, userId, bytes }) {
      const avatarPath = `${tripId}/avatars/${userId}-${randomUUID()}.jpg`
      const image = await sharp(bytes, { failOn: 'warning' }).rotate()
        .resize({ width: 512, height: 512, fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      await writeAtomic(avatarPath, image)
      return { avatarPath }
    },
    async read(storagePath) { return readFile(absolute(storagePath)) },
    async remove(storagePath) { await rm(absolute(storagePath), { force: true }) },
  }
}
