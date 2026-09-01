export const legacyInviteRole = role => role === 'viewer' ? 'viewer' : 'editor'

export function legacyPhotoRequest({ storagePath, projectUrl, serviceKey }) {
  const path = String(storagePath || '').split('/').map(encodeURIComponent).join('/')
  return {
    url: `${String(projectUrl).replace(/\/$/, '')}/storage/v1/object/authenticated/trip-photos/${path}`,
    headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  }
}

export function legacyDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function legacyPhotoCoordinates(lngValue, latValue) {
  const lng = lngValue == null || lngValue === '' ? null : Number(lngValue)
  const lat = latValue == null || latValue === '' ? null : Number(latValue)
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    return { lng: null, lat: null }
  }
  return { lng, lat }
}
