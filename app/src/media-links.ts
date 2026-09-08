/* The one refresher the whole app shares, so a screenful of expired tiles
   asks the server once rather than once each. */

import { authClient, hasBackend } from './backend-base'
import { createMediaRefresher } from './media-refresh-core'

const refresher = createMediaRefresher({
  async fetchLinks(paths) {
    if (!hasBackend) return {}
    const result = await authClient.request<{ links?: Record<string, string> }>('/media/links', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    })
    return result?.links || {}
  },
})

/** A fresh link for a signed media URL that would not load, or null. */
export const refreshMediaUrl = (url: string) => refresher.refresh(url)
