import { fetchTile, tileStore, upstreamUrl } from '../../../offline-tiles-core'
import {
  boundsOfPoints,
  saveRegion,
  tilesForBounds,
  tooWideToSave,
  type SaveProgress,
} from '../../../offline-region-core'
import { STYLE } from './map-style'
import type { Coordinates } from '../../../shared/model/types'

/* Where the tiles actually live, asked of the style rather than assumed. The
   style names a tile index; the index names the tile URLs. Reading both keeps
   this working the day the basemap moves again — which it already has once. */
async function tileTemplate(): Promise<string | null> {
  try {
    const style = await fetch(STYLE.dark).then(response => response.json())
    const indexUrl = style?.sources?.openmaptiles?.url
    if (typeof indexUrl !== 'string') return null
    const index = await fetch(upstreamUrl(indexUrl)).then(response => response.json())
    const template = Array.isArray(index?.tiles) ? index.tiles[0] : null
    return typeof template === 'string' ? upstreamUrl(template) : null
  } catch {
    return null
  }
}

export interface SaveMapOptions {
  points: Coordinates[]
  onProgress?: (progress: SaveProgress) => void
  signal?: AbortSignal
}

export type SaveMapResult =
  | { ok: true; saved: number }
  | { ok: false; reason: 'nothing-to-save' | 'too-wide' | 'no-basemap' }

/* Pulls the trip's own corner of the world onto the device, so the map is
   there before the aeroplane is. */
export async function saveTripMap({
  points,
  onProgress,
  signal,
}: SaveMapOptions): Promise<SaveMapResult> {
  const bounds = boundsOfPoints(points)
  if (!bounds) return { ok: false, reason: 'nothing-to-save' }
  if (tooWideToSave(bounds)) return { ok: false, reason: 'too-wide' }
  const template = await tileTemplate()
  if (!template) return { ok: false, reason: 'no-basemap' }

  const store = await tileStore()
  const fetchImpl = globalThis.fetch.bind(globalThis)
  const { done } = await saveRegion({
    tiles: tilesForBounds(bounds),
    template,
    onProgress,
    signal,
    // Through the same door the map reads from, so what is saved is what it finds.
    fetchTile: url => fetchTile(store, fetchImpl, url, signal),
  })
  return { ok: true, saved: done }
}
