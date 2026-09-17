import { useEffect, useRef, useState } from 'react'
import { MAX_PAGE_SCALE, pageScale } from '../../../paper-kind-core'

/* A PDF, drawn.
 *
 * What stood here said "this one is a PDF — it opens in its own viewer" over a
 * black screen, with the filename repeated underneath as a link out of the
 * app. A ticket is very often a PDF, so the commonest document in this app got
 * the screen that does nothing, and the one behaviour the whole feature exists
 * to replace — leaving for another tab, where there is no offline copy and no
 * way back — was the only thing on offer.
 *
 * Every page, stacked and scrolled, which is how a phone reads a document and
 * needs no paging controls of its own. Rasterised once at the screen's own
 * density, because a soft barcode is a scanner that beeps twice.
 *
 * pdf.js is loaded on demand: it is the largest thing this app would ever
 * ship, and most sessions never open a PDF. The service worker keeps whatever
 * the page fetches, so the one time it is fetched with signal is the last time
 * it needs any — see service-worker-client.
 *
 * The legacy build, deliberately. The modern one calls Map.getOrInsertComputed,
 * which landed in browsers this year: it throws on the Chromium in CI and on
 * any phone more than a few months behind, and the failure is a blank document
 * at a desk. This build is transpiled and carries its own polyfills, costs
 * about a fifth more, and reads a ticket on a four-year-old handset.
 */

type Doc = { numPages: number; getPage: (n: number) => Promise<Page> }
type Task = { promise: Promise<Doc>; destroy: () => Promise<void> }
type Page = {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
    promise: Promise<void>
    cancel: () => void
  }
}

let loading: Promise<{ getDocument: (o: unknown) => Task }> | null = null

/* Once per page load, whoever asks first.
 *
 * The worker comes in through Vite's own ?worker import rather than as a URL
 * to the file in node_modules. That file is served as octet-stream, which a
 * browser refuses to run as a module — pdf.js then falls back to a "fake
 * worker" on the main thread and says so in a warning nobody reads. This way
 * the bundler owns the worker in both dev and the build, and the rendering
 * stays off the thread that is drawing the screen. */
function pdfjs() {
  if (!loading)
    loading = (async () => {
      const [lib, Worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
      ])
      lib.GlobalWorkerOptions.workerPort = new Worker.default()
      return lib as unknown as { getDocument: (o: unknown) => Task }
    })().catch(error => {
      loading = null
      throw error
    })
  return loading
}

export default function PdfPages({
  src,
  name,
  onGiveUp,
}: {
  src: string
  name: string
  /** the renderer could not be had, or the file is not one it can read */
  onGiveUp: () => void
}) {
  const sheet = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(0)

  useEffect(() => {
    let alive = true
    const canvases: HTMLCanvasElement[] = []
    /* The loading task, not the document: destroying it is how pdf.js is told
       to stop, and it works whether or not the document ever arrived. */
    let task: Task | null = null

    void (async () => {
      try {
        const { getDocument } = await pdfjs()
        task = getDocument({ url: src })
        const doc = await task.promise
        if (!alive) return

        const host = sheet.current
        if (!host) return
        const across = host.clientWidth || 390
        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PAGE_SCALE)

        for (let number = 1; number <= doc.numPages; number += 1) {
          const page = await doc.getPage(number)
          if (!alive) return
          const first = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: pageScale(first, across, ratio) })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          /* The canvas is sized in device pixels and laid out in CSS ones, so
             the page is as sharp as the glass allows and still fits the sheet. */
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.setAttribute('aria-label', `${name}, page ${number}`)
          const context = canvas.getContext('2d')
          if (!context) return onGiveUp()
          await page.render({ canvasContext: context, viewport }).promise
          if (!alive) return
          host.append(canvas)
          canvases.push(canvas)
          setDrawn(number)
        }
      } catch {
        /* No renderer (offline before it was ever fetched), or a file that is
           not the PDF its name promised. Either way the handover is still
           true, and it is better than a screen that lies about loading. */
        if (alive) onGiveUp()
      }
    })()

    return () => {
      alive = false
      for (const canvas of canvases) canvas.remove()
      void task?.destroy().catch(() => {})
    }
  }, [src, name, onGiveUp])

  return (
    <div className="ppvpdf">
      {/* Only until the first page lands. After that the pages arriving are
          their own progress, and a line under them counting is noise on the
          thing somebody is trying to read. */}
      {!drawn && <p className="ppvopening">Opening the document…</p>}
      <div ref={sheet} className="ppvpdfpages" />
    </div>
  )
}
