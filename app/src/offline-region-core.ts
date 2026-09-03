/* "Save this trip's map" — the part that decides which pieces of the world a
   trip actually needs, and fetches them before the signal goes.

   The cache built while reading a map only holds what has been looked at,
   which is no use to somebody who packs at home and lands somewhere with the
   data roaming off. This walks the trip's own bounding box instead. */

import type { Coordinates } from './shared/model/types'

export interface TileRef {
  z: number
  x: number
  y: number
}

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

/* Street level. OpenMapTiles stops at 14 and the map overzooms past it, so
   asking for more would be asking for tiles that do not exist. Below 8 the
   whole country is a handful of tiles, and they cost nothing to include. */
export const MIN_ZOOM = 8
export const MAX_ZOOM = 14
/* A cap on how much of somebody else's free service one button may pull. A
   city fits inside this comfortably; a trip drawn across a continent does not,
   and is told so rather than quietly half-downloading. */
export const MAX_TILES = 1_500

const clampLat = (lat: number) => Math.min(85.0511, Math.max(-85.0511, lat))

export const lngToX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z)

export const latToY = (lat: number, z: number) => {
  const radians = (clampLat(lat) * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** z,
  )
}

/* A little air around the stops, so the map does not end at the edge of the
   itinerary — you always want to see what is one street over. */
export function boundsOfPoints(points: Coordinates[], padDegrees = 0.02): Bounds | null {
  const usable = points.filter(
    ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90,
  )
  if (!usable.length) return null
  const lngs = usable.map(([lng]) => lng)
  const lats = usable.map(([, lat]) => lat)
  return {
    west: Math.min(...lngs) - padDegrees,
    south: Math.max(-85, Math.min(...lats) - padDegrees),
    east: Math.max(...lngs) + padDegrees,
    north: Math.min(85, Math.max(...lats) + padDegrees),
  }
}

/** Every tile covering the bounds, coarse zooms first so the map fills in. */
export function tilesForBounds(
  bounds: Bounds,
  { minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM, cap = MAX_TILES } = {},
): TileRef[] {
  const tiles: TileRef[] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    const left = lngToX(bounds.west, z)
    const right = lngToX(bounds.east, z)
    // y counts down from the north, so the north edge is the smaller number.
    const top = latToY(bounds.north, z)
    const bottom = latToY(bounds.south, z)
    const span = 2 ** z
    for (let x = Math.min(left, right); x <= Math.max(left, right); x++) {
      for (let y = Math.min(top, bottom); y <= Math.max(top, bottom); y++) {
        if (x < 0 || y < 0 || x >= span || y >= span) continue
        if (tiles.length >= cap) return tiles
        tiles.push({ z, x, y })
      }
    }
  }
  return tiles
}

/** True when the trip is spread too wide to save in one go. */
export function tooWideToSave(bounds: Bounds) {
  return tilesForBounds(bounds, { cap: MAX_TILES + 1 }).length > MAX_TILES
}

export const tileUrl = (template: string, { z, x, y }: TileRef) =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))

export interface SaveProgress {
  done: number
  total: number
}

interface SaveOptions {
  tiles: TileRef[]
  template: string
  fetchTile: (url: string) => Promise<unknown>
  onProgress?: (progress: SaveProgress) => void
  signal?: AbortSignal
  /* Their service is free and has no published limit, which is a reason to be
     careful with it rather than a licence not to be. */
  concurrency?: number
}

export async function saveRegion({
  tiles,
  template,
  fetchTile,
  onProgress,
  signal,
  concurrency = 4,
}: SaveOptions): Promise<SaveProgress> {
  let done = 0
  let next = 0
  const total = tiles.length
  const worker = async () => {
    while (next < total) {
      if (signal?.aborted) return
      const tile = tiles[next++]
      if (!tile) return
      // A tile that will not come is a gap in the map, not a failed download.
      await fetchTile(tileUrl(template, tile)).catch(() => {})
      done++
      onProgress?.({ done, total })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
  return { done, total }
}
