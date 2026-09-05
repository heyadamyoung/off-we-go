/* A trip's roads, packed to carry: the subset of the engine's tile archive a
   phone needs to route this trip offline. The full graph tar covers every
   region any trip touches (a gigabyte and growing); a phone gets the local
   tiles around this trip's stops plus the coarse hierarchy that stitches
   long hops together.

   Valhalla's grid is fixed by spec: level 0 (highways) 4° tiles, level 1
   (arterials) 1°, level 2 (local roads) 0.25°, rows from -90 northward,
   columns from -180 eastward, id = row * cols + col. */

const LEVEL_SIZE = { 0: 4, 1: 1, 2: 0.25 }

export function tileBounds(level, tileId) {
  const size = LEVEL_SIZE[level]
  if (!size) return null
  const cols = Math.round(360 / size)
  const row = Math.floor(tileId / cols)
  const col = tileId % cols
  const south = -90 + row * size
  const west = -180 + col * size
  return { west, south, east: west + size, north: south + size }
}

/* Tar entry names look like "valhalla_tiles/2/000/756/425.gph" (id digits in
   groups of three) — or the same without the leading directory. */
export function tileFromPath(name) {
  const match = /(?:^|\/)([012])((?:\/\d{3})+)\.gph$/.exec(name)
  if (!match) return null
  const level = Number(match[1])
  const tileId = Number(match[2].replaceAll('/', ''))
  return Number.isFinite(tileId) ? { level, tileId } : null
}

const expand = (bbox, km) => {
  const lat = km / 111
  const mid = (bbox.south + bbox.north) / 2
  const lng = km / (111 * Math.max(0.2, Math.cos((mid * Math.PI) / 180)))
  return {
    west: bbox.west - lng,
    east: bbox.east + lng,
    south: Math.max(-90, bbox.south - lat),
    north: Math.min(90, bbox.north + lat),
  }
}

const intersects = (a, b) =>
  a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south

export function bboxOf(points) {
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return west <= east ? { west, east, south, north } : null
}

/* Which archive entries a trip's pack keeps: local tiles near the stops, the
   full coarse hierarchy inside a wider corridor — level 0 and 1 are cheap
   and are what lets a Scotland-to-Amsterdam ask stitch across the gap. */
export function keepsTile(name, bbox) {
  const tile = tileFromPath(name)
  if (!tile) return false
  const bounds = tileBounds(tile.level, tile.tileId)
  if (!bounds) return false
  if (tile.level === 2) return intersects(bounds, expand(bbox, 60))
  if (tile.level === 1) return intersects(bounds, expand(bbox, 400))
  return intersects(bounds, expand(bbox, 1500))
}

/* ---- the tar ------------------------------------------------------------
   Minimal ustar handling: 512-byte headers, size in octal at offset 124,
   name at 0 (+ optional ustar prefix at 345), data padded to 512. Tile
   names are short and plain, so no long-name extensions apply. */

const BLOCK = 512

export function parseTarHeader(block) {
  if (block.length < BLOCK || block[0] === 0) return null
  const str = (at, len) => block.toString('utf8', at, at + len).replace(/\0.*$/, '')
  const name = str(0, 100)
  const prefix = str(345, 155)
  const size = Number.parseInt(str(124, 12).trim() || '0', 8)
  if (!Number.isFinite(size)) return null
  return { name: prefix ? `${prefix}/${name}` : name, size, type: str(156, 1) || '0' }
}

/** Read only the headers of a tar file: [{name, size, offset(dataStart)}]. */
export async function indexTar(fsPromises, path) {
  const handle = await fsPromises.open(path, 'r')
  try {
    const { size: total } = await handle.stat()
    const block = Buffer.alloc(BLOCK)
    const entries = []
    let at = 0
    while (at + BLOCK <= total) {
      await handle.read(block, 0, BLOCK, at)
      const header = parseTarHeader(block)
      if (!header) break
      const dataStart = at + BLOCK
      if (header.type === '0' || header.type === '') {
        entries.push({ name: header.name, size: header.size, offset: dataStart, headerAt: at })
      }
      at = dataStart + Math.ceil(header.size / BLOCK) * BLOCK
    }
    return entries
  } finally {
    await handle.close()
  }
}

/** The archive slices a trip's pack is made of: header+data span per kept tile. */
export function packSlices(entries, bbox) {
  const kept = []
  let bytes = 0
  for (const entry of entries) {
    if (!keepsTile(entry.name, bbox)) continue
    const dataEnd = entry.offset + Math.ceil(entry.size / BLOCK) * BLOCK
    kept.push({ start: entry.headerAt, end: dataEnd - 1, name: entry.name })
    bytes += dataEnd - entry.headerAt
  }
  // A tar ends with two zero blocks.
  return { kept, bytes: bytes + 2 * BLOCK }
}
