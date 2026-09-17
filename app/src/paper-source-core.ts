import { isOwnPhoto, photoKey, type PhotoStore } from './offline-photos-core'

/* Where a paper is read from when somebody opens it.
 *
 * keepPapers has been filling a cache since documents went in the offline pack
 * — every ticket on the trip, fetched before anybody asks, on its own cache so
 * that scrolling a gallery can never evict a boarding pass. Nothing had ever
 * read it. recallPaper was exported and tested and called by no screen, and
 * the service worker does not intercept the media route, so a document opened
 * was a document fetched: the cache worked everywhere except the one place it
 * was built for, which is a check-in desk with no signal.
 *
 * So: look in the cache first, and only then at the network. The bytes come
 * back as an object URL, which is a resource rather than a string — whoever
 * opens one has to let it go, hence release().
 */

export interface OpenPaper {
  /** what to point an <img> or an <a> at */
  url: string
  /** true when this came out of the cache rather than off the network */
  held: boolean
  /** let an object URL go; a no-op for a network url, and safe to call twice */
  release: () => void
}

const overTheNetwork = (src: string): OpenPaper => ({ url: src, held: false, release: () => {} })

/**
 * Open a paper from the best copy available.
 *
 * make and drop are the object-URL pair, taken as arguments so the rule can be
 * held to account without a browser.
 */
export async function openPaper(
  src: string,
  store: PhotoStore | null,
  make: (blob: Blob) => string = URL.createObjectURL,
  drop: (url: string) => void = URL.revokeObjectURL,
): Promise<OpenPaper> {
  /* Only our own media is ever kept, and only our own media has a signature to
     strip: asking the cache about somebody else's link is a question with no
     answer, every time. */
  if (!store || !isOwnPhoto(src)) return overTheNetwork(src)
  try {
    const kept = await store.match(photoKey(src))
    if (!kept) return overTheNetwork(src)
    const url = make(await kept.blob())
    /* Once. A second revoke is a revoke of whatever url the browser has since
       handed out under that name, which belongs to somebody else. */
    let gone = false
    return {
      url,
      held: true,
      release: () => {
        if (gone) return
        gone = true
        drop(url)
      },
    }
  } catch {
    /* A cache that will not answer — no quota, a private window, a webview
       without the API. The document still opens; we simply have no copy. */
    return overTheNetwork(src)
  }
}
