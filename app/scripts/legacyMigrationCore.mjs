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
