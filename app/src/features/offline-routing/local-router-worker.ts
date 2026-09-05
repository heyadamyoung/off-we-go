// The on-device routing engine: Valhalla compiled to WASM, reading this
// trip's saved road tiles from OPFS. A classic worker on purpose —
// importScripts is how the Emscripten loader arrives.

/// <reference lib="webworker" />

import { createOpfsTarTileSourceFactory } from 'valhalla-wasm'
import { createLocalRoutingEngine, type LocalRoutingRequest } from './model/routing-core'

;(self as any).global = self

importScripts('/valhalla.js')
declare const ValhallaModule: (opts?: object) => Promise<unknown>

const route = createLocalRoutingEngine({
  initModule: () =>
    ValhallaModule({
      locateFile: (path: string) => `/${path}`,
      print: () => {},
      printErr: (text: string) => console.warn(`[valhalla-wasm] ${text}`),
    }),
  tileSourceFactory: createOpfsTarTileSourceFactory('offline_maps'),
  onProgress: message => self.postMessage({ success: false, progress: message }),
})

self.onmessage = async (event: MessageEvent<LocalRoutingRequest>) => {
  try {
    self.postMessage(await route(event.data))
  } catch (error) {
    self.postMessage({ success: false, error: (error as Error)?.message || String(error) })
  }
}
