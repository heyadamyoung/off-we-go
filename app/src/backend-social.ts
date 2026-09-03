import { authClient, hasBackend, isSample, tripPath } from './backend-base'
import { sampleResult, sampleTrip, uid } from './sample-trip-core'
import { localId } from './offline-edits-core'
import { withOfflineEdit } from './offline-edits'
import type {
  AcceptedInvite,
  Id,
  Invite,
  PendingInvite,
  TripComment,
  TripPhoto,
  UploadInput,
} from './shared/model/types'

/* Comments, likes, invites and photographs: the parts of the API where people
   leave something for each other. */
export async function addComment(tripId: Id, photoId: Id, body: string): Promise<TripComment> {
  if (isSample(tripId)) {
    const comment = { id: uid(), by: sampleResult().me.name, text: body, when: 'just now' }
    const comments = sampleTrip().comments
    comments[photoId] ||= []
    comments[photoId].push(comment)
    return comment
  }
  const target = localId()
  return withOfflineEdit(
    { kind: 'comment.add', tripId, target, photoId, body },
    () =>
      authClient.request<TripComment>(
        `${tripPath(tripId)}/photos/${encodeURIComponent(photoId)}/comments`,
        { method: 'POST', body: { body } },
      ),
    () => ({ id: target, by: '', text: body, when: 'just now' }),
  )
}
export async function deleteComment(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) {
    for (const key of Object.keys(sampleTrip().comments))
      sampleTrip().comments[key] = sampleTrip().comments[key].filter(item => item.id !== id)
    return
  }
  return withOfflineEdit(
    { kind: 'comment.delete', tripId, target: id },
    () =>
      authClient.request(`${tripPath(tripId)}/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    () => undefined,
  )
}
export async function setLike(tripId: Id, photoId: Id, on: boolean): Promise<unknown> {
  if (isSample(tripId)) {
    const likes = sampleTrip().likes,
      index = likes.indexOf(photoId)
    if (on && index < 0) likes.push(photoId)
    if (!on && index >= 0) likes.splice(index, 1)
    return
  }
  return withOfflineEdit(
    { kind: 'like.set', tripId, photoId, on },
    () =>
      authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(photoId)}/like`, {
        method: on ? 'PUT' : 'DELETE',
      }),
    () => undefined,
  )
}

export async function listInvites(tripId: Id): Promise<Invite[]> {
  if (isSample(tripId)) return sampleTrip().invites.map(item => ({ ...item }))
  return authClient.request(`${tripPath(tripId)}/invites`)
}
export async function listPendingInvites(): Promise<PendingInvite[]> {
  if (!hasBackend) return []
  return authClient.request('/invites/pending')
}
export async function acceptInvite(id: Id): Promise<AcceptedInvite> {
  if (!hasBackend) throw new Error('No backend configured')
  return authClient.request(`/invites/${encodeURIComponent(id)}/accept`, { method: 'POST' })
}
export async function invitePerson(
  tripId: Id,
  input: Omit<Invite, 'id' | 'claimedAt'>,
): Promise<Invite> {
  if (isSample(tripId)) {
    const row = { id: uid(), ...input, claimedAt: null }
    sampleTrip().invites.push(row)
    return row
  }
  return authClient.request(`${tripPath(tripId)}/invites`, { method: 'POST', body: input })
}
export async function revokeInvite(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) {
    sampleTrip().invites = sampleTrip().invites.filter(item => item.id !== id)
    return
  }
  return authClient.request(`${tripPath(tripId)}/invites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
export async function removeMember(tripId: Id, profileId: Id): Promise<unknown> {
  if (isSample(tripId)) return
  return authClient.request(`${tripPath(tripId)}/members/${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
  })
}

export async function uploadPhoto(
  tripId: Id,
  file: File,
  meta: Partial<TripPhoto & UploadInput> = {},
): Promise<TripPhoto> {
  if (isSample(tripId)) {
    const nextSequence = Math.max(
      sampleTrip().photos.length,
      ...sampleTrip().photos.map(photo => (photo.seq ?? -1) + 1),
    )
    const photo = {
      id: uid(),
      by: '',
      src: URL.createObjectURL(file),
      seq: nextSequence,
      ...meta,
    } as TripPhoto
    sampleTrip().photos.push(photo)
    return { ...photo }
  }
  const form = new FormData()
  form.append('photo', file, file.name)
  const values = {
    stopId: meta.stopId,
    lng: meta.lng,
    lat: meta.lat,
    caption: meta.caption,
    fallbackLng: meta.fallbackLng,
    fallbackLat: meta.fallbackLat,
    fallbackLocationSource: meta.fallbackLocationSource,
    takenAt: meta.when || meta.takenAt,
    locationSource: meta.locationSource,
    uploadKey: meta.uploadKey,
  }
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== '') form.append(key, String(value))
  return authClient.request(`${tripPath(tripId)}/photos`, { method: 'POST', body: form })
}
export async function updatePhoto(
  tripId: Id,
  id: Id,
  fields: Partial<TripPhoto>,
): Promise<TripPhoto | undefined> {
  if (isSample(tripId)) {
    const photo = sampleTrip().photos.find(item => item.id === id)
    if (photo) Object.assign(photo, fields)
    return photo
  }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: fields,
  })
}
export async function deletePhoto(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) {
    sampleTrip().photos = sampleTrip().photos.filter(item => item.id !== id)
    return
  }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
