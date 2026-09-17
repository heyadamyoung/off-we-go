import { useEffect, useState } from 'react'
import { paperStore } from '../../../offline-papers-core'
import { openPaper } from '../../../paper-source-core'

export interface PaperSource {
  /** null until the cache has been asked; nothing is drawn before then */
  url: string | null
  /** whether these bytes came off the phone rather than the network */
  held: boolean
}

/* The copy we already have, if we have one.
 *
 * Asking the cache is local and quick, so nothing is drawn until it answers:
 * pointing an <img> at the network first and swapping it for the cached bytes
 * a moment later spends the request the cache existed to avoid, and offline it
 * flashes a broken image on the way. */
export default function usePaperSource(src: string): PaperSource {
  const [source, setSource] = useState<PaperSource>({ url: null, held: false })

  useEffect(() => {
    let live = true
    let release = () => {}
    setSource({ url: null, held: false })
    void (async () => {
      const open = await openPaper(src, await paperStore())
      /* Moved on while the cache was answering: the object URL is ours and
         nobody is going to draw it, so let it go here. */
      if (!live) return open.release()
      release = open.release
      setSource({ url: open.url, held: open.held })
    })()
    return () => {
      live = false
      release()
    }
  }, [src])

  return source
}
