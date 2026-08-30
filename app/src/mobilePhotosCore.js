const number = value => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

function metadataFromExif(exif) {
  if (!exif || typeof exif !== 'object') return null
  const gps = exif.GPS || exif['{GPS}'] || {}
  let lat = number(gps.Latitude ?? gps.GPSLatitude ?? exif.GPSLatitude)
  let lng = number(gps.Longitude ?? gps.GPSLongitude ?? exif.GPSLongitude)
  if (lat != null && /S/i.test(gps.LatitudeRef ?? gps.GPSLatitudeRef ?? exif.GPSLatitudeRef ?? '')) lat = -Math.abs(lat)
  if (lng != null && /W/i.test(gps.LongitudeRef ?? gps.GPSLongitudeRef ?? exif.GPSLongitudeRef ?? '')) lng = -Math.abs(lng)
  const valid = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const takenAt = captureTime(
    exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime,
    exif.OffsetTimeOriginal || exif.OffsetTimeDigitized || exif.OffsetTime,
  )
  return valid || takenAt ? { ...(valid ? { lat, lng } : {}), ...(takenAt ? { takenAt } : {}) } : null
}

export async function galleryPhotosToFiles(photos, { fetch: fetchFn, stamp = Date.now() } = {}) {
  if (!fetchFn) throw new Error('A file reader is required')
  return Promise.all((photos || []).map(async (photo, index) => {
    if (!photo?.webPath) throw new Error('Apple Photos did not return an image file')
    const response = await fetchFn(photo.webPath)
    if (!response.ok) throw new Error('The selected photo could not be read')
    const blob = await response.blob()
    const file = new File([blob], `wayfare-${stamp}-${index + 1}.jpg`, {
      type: 'image/jpeg',
      lastModified: stamp,
    })
    const metadata = metadataFromExif(photo.exif)
    if (metadata) Object.defineProperty(file, 'wayfareMetadata', { value: metadata, enumerable: false })
    return file
  }))
}

export function photoUploadMetadata(input, { by, nextSequence }) {
  const metadata = {
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
  if (input.locationSource) metadata.locationSource = input.locationSource
  if (input.uploadKey) metadata.uploadKey = input.uploadKey
  return metadata
}
