/* Minting and taking back a photograph's public link.
 *
 * Thin on purpose: the interesting decisions are on the server (who may share,
 * one live token per photograph, a revoked one stays revoked) and in
 * share-core (what a browser will let us put in the share sheet). This is the
 * wire between them.
 */

import { authClient, hasBackend } from './backend-base'
import type { Id } from './shared/model/types'

const where = (tripId: Id, photoId: Id) => `/trips/${tripId}/photos/${photoId}/share`

/** The link for this photograph, making one if there is not one already. */
export async function shareLink(tripId: Id, photoId: Id): Promise<string | null> {
  if (!hasBackend) return null
  const result = await authClient.request<{ url?: string | null }>(where(tripId, photoId), {
    method: 'POST',
  })
  return result?.url ?? null
}

/** Whether this photograph is already out there, without putting it there. */
export async function existingShareLink(tripId: Id, photoId: Id): Promise<string | null> {
  if (!hasBackend) return null
  const result = await authClient.request<{ url?: string | null }>(where(tripId, photoId))
  return result?.url ?? null
}

/** Take every live link for this photograph off the internet. */
export async function revokeShareLink(tripId: Id, photoId: Id): Promise<boolean> {
  if (!hasBackend) return false
  const result = await authClient.request<{ revoked?: number }>(where(tripId, photoId), {
    method: 'DELETE',
  })
  return (result?.revoked ?? 0) > 0
}
