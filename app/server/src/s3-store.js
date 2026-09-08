/* The same file store, on object storage instead of one box's volume.

   Nothing above this knows which it is talking to: the routes and the
   conversion worker were written against an injected store, so moving media
   off the disk is a configuration change. That is the point — a single
   volume is the thing that stops there being a second web node, and the
   nightly tar of it is the thing that stops the volume being large.

   Speaks plain S3 over fetch, so R2, B2, MinIO and S3 all work. */

import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { videoExtension, mediaContentType } from './media-types.js'
import { MASTER_NAME, hlsDirectory } from './hls.js'
import { filesUnder } from './files.js'
import { EMPTY_SHA256, UNSIGNED_PAYLOAD, encodeKey, sha256Hex, signRequest } from './s3-signer.js'

class ObjectMissing extends Error {
  constructor(key) {
    super(`No object at ${key}`)
    // The routes distinguish a missing file from a broken volume by this.
    this.code = 'ENOENT'
    this.name = 'ObjectMissing'
  }
}

export function createS3FileStore({
  bucket,
  region = 'auto',
  endpoint,
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  /* Path style for MinIO and most self-hosted gateways; virtual-hosted for
     S3 proper, which is also what a CDN in front expects. */
  forcePathStyle = false,
  fetchImpl = fetch,
  prefix = '',
}) {
  if (!bucket) throw new Error('An object storage bucket is required')
  if (!endpoint) throw new Error('An object storage endpoint is required')
  const base = new URL(endpoint)
  const keyFor = storagePath => `${prefix}${String(storagePath).replace(/^\/+/, '')}`

  const urlFor = storagePath => {
    const key = encodeKey(keyFor(storagePath))
    if (forcePathStyle) return new URL(`${base.origin}/${bucket}/${key}`)
    return new URL(`${base.protocol}//${bucket}.${base.host}/${key}`)
  }

  const send = async (method, storagePath, { body, headers = {}, payloadHash, query } = {}) => {
    const url = urlFor(storagePath)
    if (query) for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    const signed = signRequest({
      method,
      url,
      headers,
      payloadHash: payloadHash || EMPTY_SHA256,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region,
      service: 's3',
    })
    const response = await fetchImpl(url.toString(), {
      method,
      headers: signed.headers,
      body,
      // Node needs telling before it will stream a request body.
      ...(body && typeof body !== 'string' ? { duplex: 'half' } : {}),
    })
    if (response.status === 404) throw new ObjectMissing(storagePath)
    if (!response.ok && !(method === 'GET' && response.status === 206)) {
      /* The far end's own words. An object store refusing a write says
         precisely why in the body — wrong region, expired key, no such
         bucket — and throwing that away turns every one of them into the
         same unanswerable "upload failed". */
      const said = await response.text().catch(() => '')
      throw Object.assign(new Error(`Object storage ${method} ${response.status}`), {
        status: response.status,
        detail: said.slice(0, 500),
      })
    }
    return response
  }

  const put = async (storagePath, bytes, contentType) => {
    await send('PUT', storagePath, {
      body: bytes,
      payloadHash: sha256Hex(bytes),
      headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
    })
    return storagePath
  }

  const putFile = async (storagePath, file, contentType) => {
    const { size } = await stat(file)
    await send('PUT', storagePath, {
      // Streamed, so a film is never a Buffer on the way out either.
      body: Readable.toWeb(createReadStream(file)),
      payloadHash: UNSIGNED_PAYLOAD,
      headers: { 'content-type': contentType, 'content-length': String(size) },
    })
    return { storagePath, bytes: size }
  }

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
      /* A HEAD on the bucket: proves the credentials, the region and the
         name all agree before a single upload depends on them. */
      await send('HEAD', '')
    },
    async storePhoto({ tripId, bytes }) {
      const id = randomUUID()
      const storagePath = `${tripId}/${id}.jpg`
      const thumbPath = `${tripId}/${id}.thumb.jpg`
      const { display, thumbnail } = await derivatives(bytes)
      await put(storagePath, display, 'image/jpeg')
      try {
        await put(thumbPath, thumbnail, 'image/jpeg')
      } catch (error) {
        await this.remove(storagePath).catch(() => {})
        throw error
      }
      return { storagePath, thumbPath }
    },
    async storeVideo({ tripId, source, mime, limit = Number.POSITIVE_INFINITY }) {
      const extension = videoExtension(mime)
      if (!extension) throw new Error('Unsupported video type')
      const storagePath = `${tripId}/${randomUUID()}.${extension}`
      /* The cap is counted on the way past, the same as on disk: the point
         is never to hold or store more than the limit, and an object store
         charges for what it keeps. */
      let written = 0
      /* fetch reports anything that goes wrong inside a request body as a
         bare "fetch failed", which would turn a file over the limit into an
         unanswerable network error. The real reason is kept here and
         rethrown in its place. */
      let refused = null
      const metered = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of source) {
              written += chunk.length
              if (written > limit) {
                refused = Object.assign(new Error(`Larger than the ${limit} byte limit`), {
                  code: 'MEDIA_TOO_LARGE',
                  limit,
                })
                throw refused
              }
              controller.enqueue(chunk)
            }
            controller.close()
          } catch (error) {
            refused ||= error
            controller.error(error)
          }
        },
      })
      try {
        await send('PUT', storagePath, {
          body: metered,
          payloadHash: UNSIGNED_PAYLOAD,
          headers: { 'content-type': mime },
        })
      } catch (error) {
        if (refused) throw refused
        throw error
      }
      return { storagePath, bytes: written }
    },
    async storePoster({ storagePath: videoPath, bytes }) {
      const stem = String(videoPath).slice(0, -extname(String(videoPath)).length)
      const posterPath = `${stem}.poster.jpg`
      const thumbPath = `${stem}.thumb.jpg`
      const { display, thumbnail } = await derivatives(bytes)
      await put(posterPath, display, 'image/jpeg')
      try {
        await put(thumbPath, thumbnail, 'image/jpeg')
      } catch (error) {
        await this.remove(posterPath).catch(() => {})
        throw error
      }
      return { posterPath, thumbPath }
    },
    async storePosterFile({ storagePath, file }) {
      return this.storePoster({ storagePath, bytes: await readFile(file) })
    },
    async storeDocument({ tripId, bytes, extension }) {
      const safe = /^[a-z0-9]{1,8}$/i.test(String(extension || '')) ? extension : 'bin'
      const storagePath = `${tripId}/docs/${randomUUID()}.${safe}`
      await put(storagePath, bytes, 'application/octet-stream')
      return { storagePath, bytes: bytes.length }
    },
    async storeAvatar({ profileId, bytes }) {
      const avatarPath = `profiles/${profileId}.jpg`
      const image = await sharp(bytes, { failOn: 'warning' })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
      await put(avatarPath, image, 'image/jpeg')
      return { avatarPath }
    },
    async download(storagePath, localPath) {
      const response = await send('GET', storagePath)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(localPath))
      return localPath
    },
    async replaceVideo({ storagePath, file, mime }) {
      const extension = videoExtension(mime) || 'mp4'
      const stem = String(storagePath).slice(0, -extname(String(storagePath)).length)
      const target = `${stem}.converted.${extension}`
      await putFile(target, file, mime)
      return { storagePath: target, replaced: storagePath }
    },
    async read(storagePath) {
      const response = await send('GET', storagePath)
      return Buffer.from(await response.arrayBuffer())
    },
    async size(storagePath) {
      const response = await send('HEAD', storagePath)
      const length = Number(response.headers.get('content-length'))
      if (!Number.isFinite(length)) throw new ObjectMissing(storagePath)
      return length
    },
    /* A range straight off the object store, so seeking a film costs one
       request rather than a download. The same shape the disk store returns,
       so the route cannot tell them apart. */
    open(storagePath, { start, end } = {}) {
      const range = start === undefined ? null : `bytes=${start}-${end === undefined ? '' : end}`
      const pending = send('GET', storagePath, {
        headers: range ? { range } : {},
      }).then(response => Readable.fromWeb(response.body))
      /* The route pipes this straight into the reply, so it must be a stream
         now rather than a promise of one. */
      const out = new Readable({ read() {} })
      pending
        .then(stream => {
          stream.on('data', chunk => out.push(chunk))
          stream.on('end', () => out.push(null))
          stream.on('error', error => out.destroy(error))
        })
        .catch(error => out.destroy(error))
      return out
    },
    /* A film's adaptive stream, put up whole. The master playlist goes last:
       it is the only path anything else records, so a tree whose upload died
       halfway is never referenced by anything and is swept up as ordinary
       unreferenced bytes rather than served as a broken stream. */
    async storeHls({ storagePath, directory }) {
      const prefix = hlsDirectory(storagePath)
      const files = (await filesUnder(directory)).filter(name => name !== MASTER_NAME)
      let bytes = 0
      for (const name of files) {
        const written = await putFile(
          `${prefix}/${name}`,
          join(directory, name),
          mediaContentType(name),
        )
        bytes += written.bytes
      }
      const master = await putFile(
        `${prefix}/${MASTER_NAME}`,
        join(directory, MASTER_NAME),
        mediaContentType(MASTER_NAME),
      )
      return {
        hlsPath: `${prefix}/${MASTER_NAME}`,
        files: files.length + 1,
        bytes: bytes + master.bytes,
      }
    },
    /* Everything under a prefix. An object store has no directories, so a
       tree is a listing and a great many deletes — which is precisely why
       this is the store's problem rather than the caller's. */
    async removeTree(tree) {
      const under = `${String(tree).replace(/\/+$/, '')}/`
      let token = null
      do {
        const response = await send('GET', '', {
          query: {
            'list-type': '2',
            prefix: keyFor(under),
            'max-keys': '1000',
            ...(token ? { 'continuation-token': token } : {}),
          },
        })
        const xml = await response.text()
        /* The listing is keys and a continuation token; a parser for the
           whole of S3's XML would be a dependency to keep something this
           small honest. */
        const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map(([, key]) =>
          key.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        )
        for (const key of keys) {
          // Back to a storage path: the store adds its own prefix on the way out.
          await this.remove(prefix ? key.slice(prefix.length) : key)
        }
        const more = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        token = more
          ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml) || [])[1]
          : null
      } while (token)
    },
    async remove(storagePath) {
      await send('DELETE', storagePath).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
    },
    // Only the disk store has a local file to clean up; here there is none.
    async removeLocal(path) {
      await rm(path, { force: true })
    },
  }
}
