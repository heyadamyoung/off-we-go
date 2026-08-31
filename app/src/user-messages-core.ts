export type AppAction =
  | 'load-trip' | 'load-profile' | 'create-trip' | 'accept-invite' | 'delete-account'
  | 'save-trip' | 'save-profile' | 'send-invite' | 'remove-invite' | 'remove-member'
  | 'add-phone' | 'remove-phone' | 'share-location' | 'open-photos' | 'upload-photo'
  | 'post-comment' | 'save-reaction' | 'save-photo' | 'delete-photo' | 'delete-comment'
  | 'search-places' | 'lookup-place' | 'save-route' | 'move-stop' | 'reorder-stops'
  | 'save-stop' | 'delete-stop' | 'add-place' | 'copy'

type ApiError = Error & { status?: number; code?: string }

const failures: Record<AppAction, string> = {
  'load-trip': 'We could not load this trip. Please try again.',
  'load-profile': 'We could not load this profile. Please try again.',
  'create-trip': 'We could not create your trip. Check the details and try again.',
  'accept-invite': 'We could not accept that invitation. It may have expired or been withdrawn.',
  'delete-account': 'We could not delete your account. Please try again.',
  'save-trip': 'We could not save the trip changes. Please try again.',
  'save-profile': 'We could not save your profile. Please try again.',
  'send-invite': 'We could not create that invitation. Check the email address and try again.',
  'remove-invite': 'We could not cancel that invitation. Please try again.',
  'remove-member': 'We could not remove that person from the trip. Please try again.',
  'add-phone': 'We could not add that phone. Please try again.',
  'remove-phone': 'We could not remove that phone. Please try again.',
  'share-location': 'Location sharing could not start. Check location permissions and try again.',
  'open-photos': 'We could not open your photo library. Check photo permissions and try again.',
  'upload-photo': 'We could not upload the photo. Check the file and try again.',
  'post-comment': 'We could not post your comment. Please try again.',
  'save-reaction': 'We could not save your reaction. Please try again.',
  'save-photo': 'We could not save the photo changes. Please try again.',
  'delete-photo': 'We could not delete that photo. Please try again.',
  'delete-comment': 'We could not delete that comment. Please try again.',
  'search-places': 'We could not search for places. Please try again.',
  'lookup-place': 'We could not look up that place. Please try again.',
  'save-route': 'We could not save the route. Please try again.',
  'move-stop': 'We could not move that stop. Please try again.',
  'reorder-stops': 'We could not reorder the stops. Please try again.',
  'save-stop': 'We could not save that stop. Check the details and try again.',
  'delete-stop': 'We could not delete that stop. Please try again.',
  'add-place': 'We could not add that place to the trip. Please try again.',
  copy: 'We could not copy that. Select it and copy it manually.',
}

const unavailable: Partial<Record<AppAction, string>> = {
  'load-trip': 'Trips are temporarily unavailable. Please try again later.',
  'load-profile': 'Profiles are temporarily unavailable. Please try again later.',
  'upload-photo': 'Photo uploads are temporarily unavailable. Please try again later.',
  'open-photos': 'Your photo library is temporarily unavailable. Please try again later.',
  'share-location': 'Location sharing is temporarily unavailable. Please try again later.',
  'send-invite': 'Invitations are temporarily unavailable. Please try again later.',
}

const forbidden: Partial<Record<AppAction, string>> = {
  'save-trip': 'You do not have permission to edit this trip.',
  'save-route': 'You do not have permission to edit this trip.',
  'move-stop': 'You do not have permission to edit this trip.',
  'reorder-stops': 'You do not have permission to edit this trip.',
  'save-stop': 'You do not have permission to edit this trip.',
  'delete-stop': 'You do not have permission to edit this trip.',
  'add-place': 'You do not have permission to edit this trip.',
  'upload-photo': 'You do not have permission to add photos to this trip.',
  'send-invite': 'Only a trip owner can invite people.',
  'remove-invite': 'Only a trip owner can cancel invitations.',
  'remove-member': 'Only a trip owner can remove people.',
}

export function appErrorMessage(caught: unknown, action: AppAction): string {
  const error = caught as Partial<ApiError> | null
  const status = Number(error?.status || 0)
  if (error?.code === 'profile.handle_taken') return 'That handle is already taken. Try another one.'
  if (error?.code === 'profile.handle_invalid') return 'Use 3–30 letters, numbers, or single hyphens for your handle.'
  if (caught instanceof TypeError || status === 0 && /fetch|network|offline/i.test(String(error?.message || ''))) {
    return 'Check your internet connection and try again.'
  }
  if (status === 401) return 'Your session has expired. Sign in again, then retry.'
  if (status === 403) return forbidden[action] || 'You do not have permission to do that.'
  if (status === 404) return action === 'accept-invite'
    ? 'That invitation is no longer available.' : 'That item could not be found. It may have been removed.'
  if (status === 409) return 'That change conflicts with a newer update. Reload and try again.'
  if (status === 413) return 'That file is too large. Choose a smaller image and try again.'
  if (status === 415) return 'Choose a JPEG, PNG, WebP, or HEIC image.'
  if (status === 429) return 'Too many attempts. Wait a moment, then try again.'
  if (status >= 500) return unavailable[action] || 'Off We Go is temporarily unavailable. Please try again later.'
  return failures[action]
}
