import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { exifFromImage } from '../src/photo-exif.js'

/* A photograph carries where and when it was taken inside itself. Reading that
   here rather than trusting the client is what makes it survive a picker that
   strips it, a phone that will not hand its library over, and any client we
   have not written yet. */

const aPhotograph = (exif, { width = 64, height = 48 } = {}) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .withExif(exif)
    .jpeg()
    .toBuffer()

/* libvips numbers the blocks: IFD2 is the Exif IFD, IFD3 is GPS. */
const AMSTERDAM = {
  IFD3: {
    GPSLatitude: '52/1 21/1 4344/100',
    GPSLatitudeRef: 'N',
    GPSLongitude: '4/1 53/1 704/100',
    GPSLongitudeRef: 'E',
  },
}

test('a photograph says where it was taken', async () => {
  const read = await exifFromImage(await aPhotograph(AMSTERDAM))

  assert.ok(read, 'nothing was read from a photograph that has GPS in it')
  assert.ok(Math.abs(read.lat - 52.3620666) < 0.0001, String(read.lat))
  assert.ok(Math.abs(read.lng - 4.8852888) < 0.0001, String(read.lng))
})

test('south and west come back negative', async () => {
  /* The reference is a separate tag from the number, and a reader that ignores
     it puts Sydney in the North Atlantic. */
  const read = await exifFromImage(
    await aPhotograph({
      IFD3: {
        GPSLatitude: '33/1 51/1 3564/100',
        GPSLatitudeRef: 'S',
        GPSLongitude: '151/1 12/1 3996/100',
        GPSLongitudeRef: 'E',
      },
    }),
  )

  assert.ok(read.lat < 0, `southern latitude came back as ${read.lat}`)
  assert.ok(read.lng > 0)
})

test('and when it was taken', async () => {
  const read = await exifFromImage(
    await aPhotograph({ ...AMSTERDAM, IFD2: { DateTimeOriginal: '2026:09:05 14:22:31' } }),
  )

  assert.equal(read.takenAt, '2026-09-05T14:22:31.000Z')
})

test('a capture time with no position is still worth having', async () => {
  /* It is what the trail lookup needs to work out where they were. */
  const read = await exifFromImage(
    await aPhotograph({ IFD2: { DateTimeOriginal: '2026:09:05 14:22:31' } }),
  )

  assert.equal(read.lng, undefined)
  assert.equal(read.takenAt, '2026-09-05T14:22:31.000Z')
})

test('a photograph carrying nothing reads as nothing', async () => {
  assert.equal(await exifFromImage(await aPhotograph({ IFD0: { Make: 'Apple' } })), null)
})

test('rubbish never throws, because a bad block must not fail an upload', async () => {
  /* Losing somebody's photograph over an unreadable metadata block would be a
     far worse bug than the one this fixes. */
  assert.equal(await exifFromImage(Buffer.from('not an image at all')), null)
  assert.equal(await exifFromImage(Buffer.alloc(0)), null)
  assert.equal(await exifFromImage(null), null)
})

test('a position outside the world is not a position', async () => {
  const read = await exifFromImage(
    await aPhotograph({
      IFD3: {
        GPSLatitude: '181/1 0/1 0/1',
        GPSLatitudeRef: 'N',
        GPSLongitude: '0/1 0/1 0/1',
        GPSLongitudeRef: 'E',
      },
    }),
  )

  assert.ok(read === null || read.lat === undefined, JSON.stringify(read))
})

/* And the upload route, because a reader nothing calls is decoration. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/app.js'
import { createDiskFileStore } from '../src/files.js'
import { createMemoryRepository } from './memory-repository.js'
import { authenticate } from './auth-helper.js'

async function aTrip(t) {
  const directory = await mkdtemp(join(tmpdir(), 'offwego-exif-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = createMemoryRepository({ allowedEmails: ['owner@example.com'] })
  const app = await buildServer({
    repository,
    fileStore: createDiskFileStore({ directory }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const accessToken = (await authenticate(repository, 'owner@example.com')).slice(7)
  const trip = await fetch(`${origin}/api/trips`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ title: 'EXIF trip' }),
  }).then(response => response.json())
  return { origin, accessToken, trip }
}

const upload = async ({ origin, accessToken, trip }, bytes, fields = {}) => {
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: 'image/jpeg' }), 'IMG_0001.jpg')
  form.set('uploadKey', `01J8EXIF${Math.random().toString(36).slice(2, 12).toUpperCase()}`)
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value))
  const response = await fetch(`${origin}/api/trips/${trip.id}/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  })
  return { status: response.status, photo: await response.json() }
}

test('the photograph outranks the client about where it was taken', async t => {
  /* The bug this exists for. The picker handed over an image stripped of its
     EXIF, the client could not tell that from a picture that never had any, so
     it sent the phone's position at upload time — a different country from
     where the holiday happened. The file still knows. */
  const world = await aTrip(t)
  const bytes = await aPhotograph({
    ...AMSTERDAM,
    IFD2: { DateTimeOriginal: '2026:09:05 14:22:31' },
  })

  const { status, photo } = await upload(world, bytes, {
    lng: -0.1276,
    lat: 51.5072,
    locationSource: 'live',
  })

  assert.equal(status, 201)
  assert.ok(Math.abs(photo.lat - 52.3620666) < 0.0001, `filed at ${photo.lat}, not Amsterdam`)
  assert.ok(Math.abs(photo.lng - 4.8852888) < 0.0001, `filed at ${photo.lng}, not Amsterdam`)
  assert.equal(photo.locationSource, 'exif')
})

test('a photograph that says nothing leaves the client’s answer alone', async t => {
  /* The other half: this must not throw away a position somebody's phone
     genuinely established for a picture with no EXIF of its own. */
  const world = await aTrip(t)
  const bytes = await aPhotograph({ IFD0: { Make: 'Apple' } })

  const { status, photo } = await upload(world, bytes, {
    lng: -0.1276,
    lat: 51.5072,
    locationSource: 'live',
  })

  assert.equal(status, 201)
  assert.ok(Math.abs(photo.lat - 51.5072) < 0.0001)
  assert.equal(photo.locationSource, 'live')
})

test('a capture time is taken from the file when the client sends none', async t => {
  const world = await aTrip(t)
  const bytes = await aPhotograph({
    ...AMSTERDAM,
    IFD2: { DateTimeOriginal: '2026:09:05 14:22:31' },
  })

  const { photo } = await upload(world, bytes)

  /* `when` is what the wire calls it — postgres.js maps taken_at onto it. */
  assert.equal(new Date(photo.when).toISOString(), '2026-09-05T14:22:31.000Z')
})
