import { authClient, tripPath } from '../../../backend'
import { track } from '../../../shared/lib/telemetry'
import type { Coordinates, Id } from '../../../shared/model/types'
import LocalRouterWorker from '../local-router-worker?worker'
import type { LocalCosting, LocalRoutingResponse } from './routing-core'

/* The trip's roads, on the device: download once with the offline map, then
   every "how far, which way" answers from the phone itself — aeroplane mode,
   basements, glens. The same engine and the same tiles as the server; only
   the location of the computation moves. */

const PACK_DIR = 'offline_maps'
const packName = (tripId: Id) => `trip-${tripId}_routing.tar`
const regionOf = (tripId: Id) => `trip-${tripId}`

const opfsDir = async (create: boolean) => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(PACK_DIR, { create }).catch(() => null)
}

export async function hasRoutingPack(tripId: Id): Promise<boolean> {
  const dir = await opfsDir(false)
  if (!dir) return false
  return dir
    .getFileHandle(packName(tripId))
    .then(() => true)
    .catch(() => false)
}

export async function forgetRoutingPack(tripId: Id): Promise<void> {
  const dir = await opfsDir(false)
  await dir?.removeEntry(packName(tripId)).catch(() => {})
}

/** Streams the trip's routing pack from the server into OPFS, with progress. */
export async function saveRoutingPack(
  tripId: Id,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const dir = await opfsDir(true)
  if (!dir) throw new Error('This browser cannot store roads for offline use')
  const response = await authClient.stream(`${tripPath(tripId)}/routing-pack`, signal)
  const total = Number(response.headers.get('content-length')) || 0
  const handle = await dir.getFileHandle(packName(tripId), { create: true })
  const writable = await handle.createWritable()
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The roads could not be downloaded')
  let done = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      await writable.write(chunk.value)
      done += chunk.value.byteLength
      onProgress?.(done, total)
    }
    await writable.close()
    /* Roads saved must MEAN offline-capable: touching the engine's own files
       now puts them in the shell cache, so the first aeroplane-mode route
       does not discover the engine was never downloaded. */
    await Promise.all([fetch('/valhalla.js'), fetch('/valhalla.wasm')]).catch(() => {})
    track('save routing pack', { bytes: String(done) })
  } catch (error) {
    await writable.abort().catch(() => {})
    await dir.removeEntry(packName(tripId)).catch(() => {})
    throw error
  }
}

/* One worker for the app's lifetime; the module and mounted tiles are cached
   inside it. Requests are serialised — the engine is single-threaded anyway. */
let worker: Worker | null = null
let turn: Promise<unknown> = Promise.resolve()

function askWorker(request: object): Promise<LocalRoutingResponse> {
  if (!worker) worker = new LocalRouterWorker()
  const w = worker
  const mine = turn.then(
    () =>
      new Promise<LocalRoutingResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          w.removeEventListener('message', onMessage)
          reject(new Error('The on-device router took too long'))
        }, 45_000)
        const onMessage = (event: MessageEvent<LocalRoutingResponse>) => {
          if (event.data?.progress) return // keep waiting through progress beats
          clearTimeout(timer)
          w.removeEventListener('message', onMessage)
          resolve(event.data)
        }
        w.addEventListener('message', onMessage)
        w.postMessage(request)
      }),
  )
  turn = mine.catch(() => {})
  return mine
}

/** Route on the device from the trip's saved pack; null when it cannot say. */
export async function localRoute(
  tripId: Id,
  from: Coordinates,
  to: Coordinates,
  mode: LocalCosting,
): Promise<{ seconds: number; meters: number; shape: Coordinates[] } | null> {
  if (!(await hasRoutingPack(tripId))) return null
  try {
    const found = await askWorker({
      start: from,
      end: to,
      regions: [regionOf(tripId)],
      costing: mode,
    })
    if (!found.success || !found.shape?.length) {
      if (found.error) console.warn('[offline-routing] engine said:', found.error)
      return null
    }
    track('route on device', { mode })
    return {
      seconds: Math.round(found.time || 0),
      meters: Math.round((found.distance || 0) * 1000),
      shape: found.shape as Coordinates[],
    }
  } catch (error) {
    // Absence is this function's contract; silence is not.
    console.warn('[offline-routing] local route failed:', error)
    return null
  }
}

declare global {
  interface Window {
    __offwegoLocalRoute?: typeof localRoute
  }
}
// A handle for the test suite: the engine lives in a worker over OPFS, so
// there is nothing in the DOM to drive or assert against.
if (typeof window !== 'undefined') window.__offwegoLocalRoute = localRoute
