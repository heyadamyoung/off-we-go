/* Which of a film's several forms this particular browser should play.

   A film is stored twice over: one MP4 that plays anywhere, and a ladder of
   renditions a player can move between as the line gets better or worse. Which
   to reach for is not a preference — it is what the browser in front of us can
   actually do, and there are three genuinely different answers.

   Safari plays HLS itself, in hardware, and on an iPhone it is the only thing
   that can: media source extensions are absent there, so a JavaScript player
   has nothing to feed. Chrome, Firefox and the Android browsers have no native
   HLS at all but do have media source extensions, so hls.js does the same job
   in script. Everything else — an old browser, a locked-down webview, a page
   with the library blocked — still has the single file, which is exactly what
   it had before any of this existed.

   None of that needs a DOM to decide, so it is decided here. */

export type PlaybackVia = 'native-hls' | 'hls.js' | 'file'

export interface PlaybackPlan {
  via: PlaybackVia | 'none'
  src: string
  /** Why this one, in the words a trace or a test would want. */
  because: string
}

export interface PlayableFilm {
  src?: string | null
  hlsSrc?: string | null
  mime?: string | null
}

export interface BrowserPowers {
  /** The browser plays HLS by itself, given the playlist as a source. */
  nativeHls: boolean
  /** Media source extensions: what a script player needs to feed frames. */
  mediaSource: boolean
  /** Whether this browser will decode the single file's own type. */
  canPlayFile: boolean
}

const nowhere: PlaybackPlan = { via: 'none', src: '', because: 'nothing playable' }

/* There is no separate "fall back" function on purpose. A stream that will not
   play is expressed by asking again without it — the caller drops `hlsSrc` and
   this decides afresh — so there is one place that knows what a browser can
   play rather than two that have to agree. */

/**
 * The best form of a film for a browser, and why.
 *
 * Adaptive first wherever it is possible: the whole point is that somebody
 * walking out of wifi keeps watching at a lower quality instead of stopping.
 */
export function playbackPlan(film: PlayableFilm, powers: BrowserPowers): PlaybackPlan {
  const hls = film?.hlsSrc || ''
  const file = film?.src || ''
  /* Native before the script player, and not only because it is cheaper: on
     an iPhone hls.js cannot run at all, and on a Mac the native one decodes
     in hardware while the script one does not. */
  if (hls && powers.nativeHls)
    return { via: 'native-hls', src: hls, because: 'the browser does HLS' }
  if (hls && powers.mediaSource) return { via: 'hls.js', src: hls, because: 'media source is here' }
  if (file && powers.canPlayFile) {
    return {
      via: 'file',
      src: file,
      because: hls ? 'no way to stream here' : 'this film has no renditions yet',
    }
  }
  return nowhere
}

/** What this browser can do, asked of it rather than guessed from its name. */
export function browserPowers(
  probe?: (type: string) => string,
  mime?: string | null,
): BrowserPowers {
  /* Only the default way of asking needs a document. A caller that brings its
     own probe — a test, or a render on the server — is answered from that:
     refusing to look because there is no DOM would have this claim every
     browser is ancient. */
  if (!probe && typeof document === 'undefined') {
    return { nativeHls: false, mediaSource: false, canPlayFile: true }
  }
  const ask = probe || ((type: string) => document.createElement('video').canPlayType(type))
  const answer = (type: string) => {
    try {
      return ask(type)
    } catch {
      return ''
    }
  }
  return {
    /* Both spellings. The registered type is the vnd one; the x- form is what
       older Safari answers to, and a browser that says yes to either plays it. */
    nativeHls:
      answer('application/vnd.apple.mpegurl') !== '' || answer('application/x-mpegURL') !== '',
    mediaSource:
      typeof window !== 'undefined' &&
      typeof (window as { MediaSource?: unknown }).MediaSource !== 'undefined',
    // An empty answer is the browser saying no; no answer at all is a maybe.
    canPlayFile: !mime || answer(String(mime)) !== '',
  }
}
