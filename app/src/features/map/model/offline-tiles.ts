import { addProtocol } from 'maplibre-gl'
import {
  fetchTile,
  rewriteTileJson,
  SCHEME,
  tileStore,
  upstreamUrl,
} from '../../../offline-tiles-core'

/* Hands every basemap request to the offline store on its way past. Registered
   once, before any map is built, because a style that has already asked for a
   tile will not ask again. */
let registered = false

export default function registerOfflineTiles() {
  if (registered) return
  registered = true
  addProtocol(SCHEME, async (params, abortController) => {
    const url = upstreamUrl(params.url)
    const store = await tileStore()
    const response = await fetchTile(
      store,
      globalThis.fetch.bind(globalThis),
      url,
      abortController?.signal,
    )
    if (!response) throw new Error(`No copy of ${url} on this device`)
    if (params.type === 'json') return { data: rewriteTileJson(await response.json()) }
    if (params.type === 'string') return { data: await response.text() }
    return { data: await response.arrayBuffer() }
  })
}
