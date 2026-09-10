/* How hard a tile should try to be on screen already.

   A windowed grid keeps only what is near the viewport in the document, which
   is what let a trip hold more photographs than a phone can lay out. The cost
   is that scrolling away destroys the element and scrolling back builds a new
   one — and a new <img> has no pixels until the browser has fetched and
   decoded again, even when every byte is already in its cache. That gap is
   what somebody sees as a photograph blinking out and coming back.

   Two things were making it far worse than it needs to be.

   The first is `loading="lazy"` on a tile the window has already decided is
   visible. That is laziness twice over: the grid renders only what is nearly
   on screen, and the browser then declines to fetch it until it is actually on
   screen. Scroll quickly and a tile can be built and destroyed without ever
   having started to load — so it never finishes, never gets remembered, and
   shows its shimmer again from scratch the next time round. The window is the
   laziness; a tile inside it should simply load.

   The second is that a picture already fetched once is decoded asynchronously
   again on the way back, so there is a frame or two of nothing where the
   photograph should be. For bytes that are already in the cache, decoding on
   the spot is what makes the return invisible.

   High priority is kept separate from either. It belongs to the one big
   picture somebody opened, not to sixty thumbnails — asking for all of them at
   once only means they queue in a different order. */

export interface TileLoading {
  loading: 'eager' | 'lazy'
  decoding: 'sync' | 'async'
  /** Left off entirely unless something really is more important than the rest. */
  fetchPriority?: 'high'
}

export interface TileState {
  /** This exact URL has been loaded before, so its bytes are already nearby. */
  seen: boolean
  /** The one picture on screen, worth jumping the queue for. */
  eager?: boolean
  /** A parent that windows its children has already decided this is visible. */
  now?: boolean
}

export function tileLoading({ seen, eager = false, now = false }: TileState): TileLoading {
  return {
    /* Lazy only when nobody has said otherwise and this has never loaded: an
       ordinary picture some way down a page the browser can judge for itself. */
    loading: eager || now || seen ? 'eager' : 'lazy',
    /* Synchronous only for something already fetched. Asking for a synchronous
       decode of bytes that have not arrived buys nothing and blocks the frame
       it is asked in. */
    decoding: seen ? 'sync' : 'async',
    ...(eager ? { fetchPriority: 'high' as const } : {}),
  }
}
