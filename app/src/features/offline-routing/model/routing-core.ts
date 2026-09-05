/** biome-ignore-all lint/suspicious/noExplicitAny: this file speaks to Emscripten's untyped FS/device surface — the types genuinely do not exist */
/* Vendored from valhalla-wasm@0.1.0 (MIT, © Tucker Willenborg) with two
   local amendments: the caller chooses the costing (walking is half this
   app's questions; upstream hardcodes 'auto'), and distances come back in
   kilometres. The storage-agnostic tile mounting is untouched — each tile in
   a tar is a lazily-read virtual file, so a route touches ~20-50 MB of a
   multi-hundred-MB graph. */

import type { TileSource, TileSourceFactory } from 'valhalla-wasm'

export type LocalCosting = 'auto' | 'pedestrian' | 'bicycle'

export interface LocalRoutingRequest {
  start: [number, number]
  end: [number, number]
  regions: string[]
  costing?: LocalCosting
}

export interface LocalRoutingResponse {
  success: boolean
  error?: string
  progress?: string
  /** kilometres */
  distance?: number
  /** seconds */
  time?: number
  /** [lng, lat] pairs */
  shape?: [number, number][]
}

let nextDeviceMajor = 80

function mkdirp(FS: any, dirPath: string) {
  const parts = dirPath.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += '/' + part
    try {
      FS.mkdir(current)
    } catch {
      /* already exists */
    }
  }
}

function mountTileSource(FS: any, source: TileSource): number {
  const major = nextDeviceMajor++
  let nextMinor = 0

  const sharedOps = {
    open(stream: any) {
      stream.seekable = true
      stream._tileOffset = stream.node._tileOffset
      stream._tileSize = stream.node._tileSize
    },
    read(stream: any, buffer: Uint8Array, offset: number, length: number, position: number) {
      const tileOffset = stream._tileOffset as number
      const tileSize = stream._tileSize as number
      const remaining = tileSize - position
      if (remaining <= 0) return 0
      const toRead = Math.min(length, remaining)
      let target = buffer.subarray(offset, offset + toRead)
      const shared =
        typeof SharedArrayBuffer !== 'undefined' && buffer.buffer instanceof SharedArrayBuffer
      if (shared) target = new Uint8Array(toRead)
      const bytesRead = source.read(target, tileOffset + position, toRead)
      if (shared && bytesRead > 0) buffer.set(target.subarray(0, bytesRead), offset)
      return bytesRead
    },
    write() {
      throw new Error('Valhalla routing tiles are read-only.')
    },
    llseek(stream: any, offset: number, whence: number) {
      const tileSize = stream._tileSize as number
      let position = offset
      if (whence === 1) position += stream.position
      else if (whence === 2) position = tileSize + offset
      if (position < 0) throw new FS.ErrnoError(28)
      return position
    },
  }

  function mountTile(filePath: string, dataOffset: number, dataSize: number) {
    const minor = nextMinor++
    const dev = FS.makedev(major, minor)
    FS.registerDevice(dev, sharedOps)
    FS.mkdev(filePath, 0o644, dev)
    const node = FS.lookupPath(filePath).node
    node.mode = 0o100644
    node.usedBytes = dataSize
    node.size = dataSize
    node._tileOffset = dataOffset
    node._tileSize = dataSize
  }

  let count = 0
  for (const entry of source.entries) {
    const cleanName = entry.name.replace(/^\.\//, '')
    const filePath = `/valhalla_tiles/${cleanName.replace(/^valhalla_tiles\//, '')}`
    mkdirp(FS, filePath.substring(0, filePath.lastIndexOf('/')))
    mountTile(filePath, entry.offset, entry.size)
    count++
  }
  return count
}

/* Upstream's config, byte-faithful: the engine's parser demands the WHOLE
   tree — trimming "unused" nodes (isochrone limits, meili, skadi) fails
   initialization with "No such node". Learned the direct way. */
function valhallaConfig() {
  return {
    mjolnir: {
      tile_dir: '/valhalla_tiles',
      use_lru_mem_cache: true,
      lru_mem_cache_hard_control: false,
      max_cache_size: 209715200,
      hierarchy: true,
      logging: { color: true, type: 'std_out' },
    },
    loki: {
      actions: [
        'locate',
        'route',
        'sources_to_targets',
        'optimized_route',
        'isochrone',
        'trace_route',
        'trace_attributes',
        'expansion',
        'status',
      ],
      logging: { color: true, type: 'std_out' },
      service_defaults: {
        heading_tolerance: 60,
        minimum_reachability: 10,
        node_snap_tolerance: 50,
        radius: 0,
        search_cutoff: 35000,
        street_side_max_distance: 1000,
        street_side_tolerance: 5,
        mvt_min_zoom_road_class: [6, 7, 8, 9, 10, 11, 12, 13],
        mvt_min_zoom_other: [6, 7, 8, 9, 10, 11, 12, 13],
        mvt_min_zoom_path: [6, 7, 8, 9, 10, 11, 12, 13],
        mvt_cache_min_zoom: 12,
        mvt_cache_max_zoom: 16,
        mvt_cache_size: 100,
      },
    },
    costing_options: {
      auto: { country_crossing_penalty: 0.0 },
      pedestrian: { walking_speed: 5.1, use_ferry: 0.5 },
    },
    thor: { source_to_target_algorithm: 'select_optimal', service: { proxy: 'ipc:///tmp/thor' } },
    odin: { logging: { color: true, type: 'std_out' }, service: { proxy: 'ipc:///tmp/odin' } },
    meili: {
      mode: 'auto',
      grid: { cache_size: 100240, size: 500 },
      logging: { color: true, type: 'std_out' },
      default: {
        beta: 3,
        breakage_distance: 2000,
        geometry: false,
        gps_accuracy: 5.0,
        interpolation_distance: 10,
        max_route_distance_factor: 5,
        max_route_time_factor: 5,
        max_search_radius: 100,
        route: true,
        search_radius: 50,
        sigma_z: 4.07,
        turn_penalty_factor: 0,
      },
    },
    service_limits: {
      auto: {
        max_distance: 5000000.0,
        max_locations: 20,
        max_matrix_distance: 400000.0,
        max_matrix_location_pairs: 2500,
      },
      bicycle: {
        max_distance: 500000.0,
        max_locations: 50,
        max_matrix_distance: 200000.0,
        max_matrix_location_pairs: 2500,
      },
      pedestrian: {
        max_distance: 5000000.0,
        max_locations: 50,
        max_matrix_distance: 200000.0,
        max_matrix_location_pairs: 2500,
        max_transit_walking_distance: 10000,
        min_transit_walking_distance: 1,
      },
      truck: {
        max_distance: 5000000.0,
        max_locations: 20,
        max_matrix_distance: 400000.0,
        max_matrix_location_pairs: 2500,
      },
      isochrone: {
        max_contours: 4,
        max_distance: 25000.0,
        max_time_contour: 3600,
        max_distance_contour: 25000,
        max_locations: 1,
      },
      trace: {
        max_alternates: 3,
        max_alternates_shape: 100,
        max_distance: 200000.0,
        max_gps_accuracy: 100.0,
        max_search_radius: 100.0,
        max_shape: 16000,
      },
      skadi: { max_shape: 750000, min_resample: 10.0 },
      status: { allow_verbose: false },
      centroid: { max_distance: 200000.0, max_locations: 5 },
      max_alternates: 2,
      max_radius: 200,
      max_reachability: 50,
      max_exclude_locations: 50,
      max_exclude_polygons_length: 10000,
      max_timedep_distance: 500000,
      max_timedep_distance_matrix: 0,
      max_distance_disable_hierarchy_culling: 0,
    },
  }
}

function decodePolyline(encoded: string, precision = 1e6): [number, number][] {
  const coordinates: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let shift = 0
      let result = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lng += delta
    }
    coordinates.push([lng / precision, lat / precision])
  }
  return coordinates
}

function performRouting(
  router: any,
  start: [number, number],
  end: [number, number],
  costing: LocalCosting,
): LocalRoutingResponse {
  const request = {
    locations: [
      { lon: start[0], lat: start[1] },
      { lon: end[0], lat: end[1] },
    ],
    costing,
    units: 'kilometers',
  }
  const result = JSON.parse(router.route(JSON.stringify(request)))
  if (result.error) {
    let message = result.error
    if (String(message).includes('No suitable edges') || result.error_code === 171) {
      message = 'No road near that point is in the saved tiles.'
    }
    throw new Error(message)
  }
  const trip = result.trip
  if (!trip?.legs?.length) throw new Error('No route found.')
  const shape = trip.legs.flatMap((leg: any) =>
    typeof leg.shape === 'string' ? decodePolyline(leg.shape) : [],
  )
  return {
    success: true,
    shape,
    distance: trip.summary?.length ?? 0,
    time: trip.summary?.time ?? 0,
  }
}

export interface LocalEngineOptions {
  initModule: () => Promise<any>
  tileSourceFactory: TileSourceFactory
  onProgress?: (message: string) => void
}

export function createLocalRoutingEngine(opts: LocalEngineOptions) {
  let wasmModule: any = null
  let router: any = null
  const mounted = new Set<string>()

  return async function route(request: LocalRoutingRequest): Promise<LocalRoutingResponse> {
    if (!wasmModule) {
      wasmModule = await opts.initModule()
      try {
        wasmModule.FS.mkdir('/valhalla_tiles')
      } catch {
        /* exists */
      }
    }
    opts.onProgress?.('Loading saved roads…')
    let newlyMounted = false
    for (const region of request.regions) {
      if (mounted.has(region)) continue
      const source = await opts.tileSourceFactory(region)
      if (!source) continue
      mountTileSource(wasmModule.FS, source)
      mounted.add(region)
      newlyMounted = true
    }
    if (!router || newlyMounted) {
      router = new wasmModule.ValhallaRouter(JSON.stringify(valhallaConfig()))
    }
    opts.onProgress?.('Computing the way…')
    return performRouting(
      wasmModule && router,
      request.start,
      request.end,
      request.costing ?? 'auto',
    )
  }
}
