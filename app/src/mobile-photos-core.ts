import { metres } from './shared/lib/geo'
import exifr from 'exifr'

const parseExifFile = exifr.parse

const number = value => {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const ratio = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return number(value)
  const denominator = Number(match[2])
  return denominator ? Number(match[1]) / denominator : null
}

const coordinate = value => {
  const direct = number(value)
  if (direct != null) return direct
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  if (parts.length !== 3) return null
  const [degrees, minutes, seconds] = parts.map(ratio)
  if ([degrees, minutes, seconds].some(part => part == null)) return null
  return Math.abs(degrees!) + minutes! / 60 + seconds! / 3600
}

const captureTime = (value, offset) => {
  if (value == null || value === '') return null
  const exif = String(value).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  let date
  if (exif) {
    const [, year, month, day, hour, minute, second] = exif
    if (offset && /^[+-]\d{2}:\d{2}$/.test(String(offset))) {
      date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`)
    } else {
      date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
    }
  } else date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function metadataFromExif(exif) {
  if (!exif || typeof exif !== 'object') return null
  const gps = exif.GPS || exif['{GPS}'] || {}
  let lat = coordinate(exif.lat ?? exif.latitude ?? gps.Latitude ?? gps.GPSLatitude ?? exif.GPSLatitude)
  let lng = coordinate(exif.lng ?? exif.longitude ?? gps.Longitude ?? gps.GPSLongitude ?? exif.GPSLongitude)
  if (lat != null && /S/i.test(gps.LatitudeRef ?? gps.GPSLatitudeRef ?? exif.GPSLatitudeRef ?? '')) lat = -Math.abs(lat)
  if (lng != null && /W/i.test(gps.LongitudeRef ?? gps.GPSLongitudeRef ?? exif.GPSLongitudeRef ?? '')) lng = -Math.abs(lng)
  const valid = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const takenAt = captureTime(
    exif.takenAt || exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime,
    exif.OffsetTimeOriginal || exif.OffsetTimeDigitized || exif.OffsetTime,
  )
  return valid || takenAt ? { ...(valid ? { lat, lng } : {}), ...(takenAt ? { takenAt } : {}) } : null
}

const attachMetadata = (file, metadata) => {
  const current = Object.getOwnPropertyDescriptor(file, 'offwegoMetadata')
  if (metadata && (!current || current.configurable)) Object.defineProperty(file, 'offwegoMetadata', {
    value: metadata, enumerable: false, configurable: true,
  })
  return file
}

export async function readPhotoFilesMetadata(files, { parseExif = parseExifFile }: any = {}) {
  await Promise.all((files || []).map(async file => {
    let parsed: any = null
    try { parsed = metadataFromExif(await parseExif(file)) } catch { /* no readable EXIF block */ }
    const existing = metadataFromExif(file?.offwegoMetadata)
    attachMetadata(file, parsed || existing ? { ...parsed, ...existing } : null)
  }))
  return files
}

const looksLikeHeic = file => /^image\/hei[cf]$/i.test(file?.type || '') || /\.hei[cf]$/i.test(file?.name || '')

export async function preparePhotoFilesForUpload(files, {
  parseExif = parseExifFile, isHeic, convertHeic,
}: any = {}) {
  await readPhotoFilesMetadata(files, { parseExif })
  if (!(files || []).some(looksLikeHeic)) return files
  if (!isHeic || !convertHeic) {
    const converter = await import('heic-to/csp')
    isHeic ||= converter.isHeic
    convertHeic ||= file => converter.heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
  }
  const prepared: File[] = []
  for (const file of files || []) {
    if (!looksLikeHeic(file) || !await isHeic(file)) { prepared.push(file); continue }
    const result = await convertHeic(file)
    const jpeg = Array.isArray(result) ? result[0] : result
    const name = /\.hei[cf]$/i.test(file.name) ? file.name.replace(/\.hei[cf]$/i, '.jpg') : `${file.name}.jpg`
    const converted = new File([jpeg], name, { type: 'image/jpeg', lastModified: file.lastModified })
    attachMetadata(converted, file.offwegoMetadata)
    prepared.push(converted)
  }
  return prepared
}

export async function galleryPhotosToFiles(photos, {
  fetch: fetchFn, stamp = Date.now(), parseExif = parseExifFile,
}: any = {}) {
  if (!fetchFn) throw new Error('A file reader is required')
  const files = await Promise.all((photos || []).map(async (photo, index) => {
    if (!photo?.webPath) throw new Error('The photo picker did not return an image file')
    const response = await fetchFn(photo.webPath)
    if (!response.ok) throw new Error('The selected photo could not be read')
    const blob = await response.blob()
    const file = new File([blob], `offwego-${stamp}-${index + 1}.jpg`, {
      type: 'image/jpeg',
      lastModified: stamp,
    })
    const metadata = metadataFromExif(photo.exif)
    attachMetadata(file, metadata)
    return file
  }))
  return readPhotoFilesMetadata(files, { parseExif })
}

export function photoUploadMetadata(input, { by, nextSequence }) {
  const metadata: any = {
    caption: input.caption,
    stopId: input.stopId ?? null,
    when: input.when,
    by,
    seq: nextSequence + (input.order || 0),
  }
  if (number(input.lng) != null && number(input.lat) != null) {
    metadata.lng = number(input.lng)
    metadata.lat = number(input.lat)
  }
  if (number(input.fallbackLng) != null && number(input.fallbackLat) != null) {
    metadata.fallbackLng = number(input.fallbackLng)
    metadata.fallbackLat = number(input.fallbackLat)
  }
  if (input.fallbackLocationSource) metadata.fallbackLocationSource = input.fallbackLocationSource
  if (input.locationSource) metadata.locationSource = input.locationSource
  if (input.uploadKey) metadata.uploadKey = input.uploadKey
  return metadata
}

export function photoPlacement(file, { live, stops, fallbackSource = 'live' }) {
  const metadata = file?.offwegoMetadata
  const metadataLng = number(metadata?.lng), metadataLat = number(metadata?.lat)
  const hasEmbeddedGps = metadataLng != null && metadataLat != null
    && Math.abs(metadataLng) <= 180 && Math.abs(metadataLat) <= 90
  const exifPoint = hasEmbeddedGps ? [metadataLng, metadataLat] : null
  const needsHistory = !exifPoint && !!metadata?.takenAt
  const point = exifPoint || (needsHistory ? null : live)
  const fallbackPoint = needsHistory ? live : null
  const previewPoint = point || fallbackPoint
  let stop: any = null, best = 400
  if (point) stops.forEach(candidate => {
    const distance = metres([candidate.lng, candidate.lat], point)
    if (distance < best) { best = distance; stop = candidate }
  })
  return {
    point, fallbackPoint, previewPoint,
    stopId: stop?.id || null, stopName: stop?.name || null,
    source: exifPoint ? 'exif' : needsHistory ? 'history' : fallbackSource,
    ...(needsHistory ? { fallbackSource } : {}),
    hasEmbeddedGps,
  }
}
