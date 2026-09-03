import { metres } from './shared/lib/geo'
import exifr from 'exifr'
import type { Coordinates, Id, Stop, UploadInput } from './shared/model/types'

const parseExifFile = exifr.parse

/* A File that may carry the metadata we sniffed out of it. The property is
   attached non-enumerably so the file still uploads as a plain file. */
export interface MetadataFile extends File {
  offwegoMetadata?: PhotoExifMetadata | null
}

export interface PhotoExifMetadata {
  lat?: number
  lng?: number
  takenAt?: string
}

type ExifParser = (file: File) => Promise<unknown>

const number = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const ratio = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const match = String(value)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return number(value)
  const denominator = Number(match[2])
  return denominator ? Number(match[1]) / denominator : null
}

const coordinate = (value: unknown): number | null => {
  const direct = number(value)
  if (direct != null) return direct
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  if (parts.length !== 3) return null
  const [degrees, minutes, seconds] = parts.map(ratio)
  if ([degrees, minutes, seconds].some(part => part == null)) return null
  return Math.abs(degrees!) + minutes! / 60 + seconds! / 3600
}

const captureTime = (value: unknown, offset: unknown): string | null => {
  if (value == null || value === '') return null
  const exif = String(value).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  let date: Date
  if (exif) {
    const [, year, month, day, hour, minute, second] = exif
    if (offset && /^[+-]\d{2}:\d{2}$/.test(String(offset))) {
      date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`)
    } else {
      date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      )
    }
  } else date = new Date(value as string | number | Date)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function metadataFromExif(exif: unknown): PhotoExifMetadata | null {
  if (!exif || typeof exif !== 'object') return null
  const source = exif as Record<string, unknown>
  const gps = (source.GPS || source['{GPS}'] || {}) as Record<string, unknown>
  let lat = coordinate(
    source.lat ?? source.latitude ?? gps.Latitude ?? gps.GPSLatitude ?? source.GPSLatitude,
  )
  let lng = coordinate(
    source.lng ?? source.longitude ?? gps.Longitude ?? gps.GPSLongitude ?? source.GPSLongitude,
  )
  if (
    lat != null &&
    /S/i.test(String(gps.LatitudeRef ?? gps.GPSLatitudeRef ?? source.GPSLatitudeRef ?? ''))
  )
    lat = -Math.abs(lat)
  if (
    lng != null &&
    /W/i.test(String(gps.LongitudeRef ?? gps.GPSLongitudeRef ?? source.GPSLongitudeRef ?? ''))
  )
    lng = -Math.abs(lng)
  const valid = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const takenAt = captureTime(
    source.takenAt || source.DateTimeOriginal || source.DateTimeDigitized || source.DateTime,
    source.OffsetTimeOriginal || source.OffsetTimeDigitized || source.OffsetTime,
  )
  return valid || takenAt
    ? { ...(valid ? { lat: lat!, lng: lng! } : {}), ...(takenAt ? { takenAt } : {}) }
    : null
}

const attachMetadata = (file: MetadataFile, metadata: PhotoExifMetadata | null) => {
  const current = Object.getOwnPropertyDescriptor(file, 'offwegoMetadata')
  if (metadata && (!current || current.configurable))
    Object.defineProperty(file, 'offwegoMetadata', {
      value: metadata,
      enumerable: false,
      configurable: true,
    })
  return file
}

export async function readPhotoFilesMetadata(
  files: MetadataFile[],
  { parseExif = parseExifFile as ExifParser }: { parseExif?: ExifParser } = {},
) {
  await Promise.all(
    (files || []).map(async file => {
      let parsed: PhotoExifMetadata | null = null
      try {
        parsed = metadataFromExif(await parseExif(file))
      } catch {
        /* no readable EXIF block */
      }
      const existing = metadataFromExif(file?.offwegoMetadata)
      attachMetadata(file, parsed || existing ? { ...parsed, ...existing } : null)
    }),
  )
  return files
}

const looksLikeHeic = (file: MetadataFile) =>
  /^image\/hei[cf]$/i.test(file?.type || '') || /\.hei[cf]$/i.test(file?.name || '')

export async function preparePhotoFilesForUpload(
  files: MetadataFile[],
  {
    parseExif = parseExifFile as ExifParser,
    isHeic,
    convertHeic,
  }: {
    parseExif?: ExifParser
    isHeic?: (file: File) => boolean | Promise<boolean>
    convertHeic?: (file: File) => Promise<Blob | Blob[]>
  } = {},
) {
  await readPhotoFilesMetadata(files, { parseExif })
  if (!(files || []).some(looksLikeHeic)) return files
  if (!isHeic || !convertHeic) {
    const converter = await import('heic-to/csp')
    isHeic ||= converter.isHeic
    convertHeic ||= file => converter.heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
  }
  const prepared: MetadataFile[] = []
  for (const file of files || []) {
    if (!looksLikeHeic(file) || !(await isHeic(file))) {
      prepared.push(file)
      continue
    }
    const result = await convertHeic(file)
    const jpeg = Array.isArray(result) ? result[0] : result
    const name = /\.hei[cf]$/i.test(file.name)
      ? file.name.replace(/\.hei[cf]$/i, '.jpg')
      : `${file.name}.jpg`
    const converted: MetadataFile = new File([jpeg], name, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
    attachMetadata(converted, file.offwegoMetadata ?? null)
    prepared.push(converted)
  }
  return prepared
}

interface GalleryPhotoLike {
  webPath?: string | null
  exif?: unknown
}

export async function galleryPhotosToFiles(
  photos: GalleryPhotoLike[],
  {
    fetch: fetchFn,
    stamp = Date.now(),
    parseExif = parseExifFile as ExifParser,
  }: {
    fetch?: (url: string) => Promise<{ ok: boolean; blob(): Promise<Blob> }>
    stamp?: number
    parseExif?: ExifParser
  } = {},
) {
  if (!fetchFn) throw new Error('A file reader is required')
  const files = await Promise.all(
    (photos || []).map(async (photo, index) => {
      if (!photo?.webPath) throw new Error('The photo picker did not return an image file')
      const response = await fetchFn(photo.webPath)
      if (!response.ok) throw new Error('The selected photo could not be read')
      const blob = await response.blob()
      const file: MetadataFile = new File([blob], `offwego-${stamp}-${index + 1}.jpg`, {
        type: 'image/jpeg',
        lastModified: stamp,
      })
      const metadata = metadataFromExif(photo.exif)
      attachMetadata(file, metadata)
      return file
    }),
  )
  return readPhotoFilesMetadata(files, { parseExif })
}

export interface PhotoUploadMetadata {
  caption?: string
  stopId: Id | null
  when?: string
  by: string
  seq: number
  lng?: number
  lat?: number
  fallbackLng?: number
  fallbackLat?: number
  fallbackLocationSource?: UploadInput['fallbackLocationSource']
  locationSource?: UploadInput['locationSource']
  uploadKey?: string
}

export function photoUploadMetadata(
  input: UploadInput,
  { by, nextSequence }: { by: string; nextSequence: number },
) {
  const metadata: PhotoUploadMetadata = {
    caption: input.caption,
    stopId: input.stopId ?? null,
    when: input.when,
    by,
    seq: nextSequence + (input.order || 0),
  }
  if (number(input.lng) != null && number(input.lat) != null) {
    metadata.lng = number(input.lng)!
    metadata.lat = number(input.lat)!
  }
  if (number(input.fallbackLng) != null && number(input.fallbackLat) != null) {
    metadata.fallbackLng = number(input.fallbackLng)!
    metadata.fallbackLat = number(input.fallbackLat)!
  }
  if (input.fallbackLocationSource) metadata.fallbackLocationSource = input.fallbackLocationSource
  if (input.locationSource) metadata.locationSource = input.locationSource
  if (input.uploadKey) metadata.uploadKey = input.uploadKey
  return metadata
}

export function photoPlacement(
  file: MetadataFile | null | undefined,
  {
    live,
    stops,
    fallbackSource = 'live',
  }: {
    live: Coordinates | null
    stops: Stop[]
    fallbackSource?: 'live' | 'approximate'
  },
) {
  const metadata = file?.offwegoMetadata
  const metadataLng = number(metadata?.lng),
    metadataLat = number(metadata?.lat)
  const hasEmbeddedGps =
    metadataLng != null &&
    metadataLat != null &&
    Math.abs(metadataLng) <= 180 &&
    Math.abs(metadataLat) <= 90
  const exifPoint: Coordinates | null = hasEmbeddedGps ? [metadataLng!, metadataLat!] : null
  const needsHistory = !exifPoint && !!metadata?.takenAt
  const point = exifPoint || (needsHistory ? null : live)
  const fallbackPoint = needsHistory ? live : null
  const previewPoint = point || fallbackPoint
  let stop: Stop | null = null,
    best = 400
  if (point) {
    for (const candidate of stops) {
      const distance = metres([candidate.lng, candidate.lat], point)
      if (distance < best) {
        best = distance
        stop = candidate
      }
    }
  }
  return {
    point,
    fallbackPoint,
    previewPoint,
    stopId: stop?.id || null,
    stopName: stop?.name || null,
    source: exifPoint ? ('exif' as const) : needsHistory ? ('history' as const) : fallbackSource,
    ...(needsHistory ? { fallbackSource } : {}),
    hasEmbeddedGps,
  }
}
