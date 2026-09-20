/* Reading a slice of the planet out of Parquet on object storage.
 *
 * Overture publishes its places theme as sixteen Parquet files on public S3,
 * ten and a half gigabytes for seventy-three million places. Both things this
 * layer does with that data — the monthly ingest and the last-resort query for
 * a region we have not ingested yet — are the same operation at different
 * scales: read the rows inside a bounding box. So there is one reader, and the
 * fallback is not a second implementation that can drift from the first.
 *
 * What makes it quick enough to serve from is that Parquet is seekable and the
 * files are ordered by longitude, so a box in Amsterdam touches one file of
 * sixteen and one row group of two hundred and fifty-six. The costs, measured
 * against the 2026-08-19.0 release from a machine in Europe:
 *
 *   asking the object store how big a file is      335 ms   avoided entirely
 *   fetching and parsing a 1.6 MB footer           907 ms   paid once per part
 *   reading one row group, 1.65 MB of columns      290 ms   the real work
 *
 * The first is avoided by keeping each part's byte length in the index. The
 * second is paid once and then cached, in memory for the life of the process
 * and on disk between them, which is what turns a 1.7-second cold query into
 * a 300-millisecond warm one. The third is the floor: Overture's files carry
 * no page index, so a row group of twenty thousand rows is the smallest thing
 * that can be read, and a query wanting six hundred of them still reads all
 * twenty thousand. Nothing in this file can beat that, which is the reason the
 * serving path is PostgreSQL and this is only the road in.
 */

import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

/** Row groups read at once. Enough to use the link, few enough to be polite to
    a public bucket that owes us nothing. */
export const READ_AT_ONCE = 4
/** Parts whose parsed footer is kept. Trips cluster, so a handful is plenty. */
export const FOOTERS_KEPT = 6

/** A range request, with the status checked: object stores answer 206, and a
    200 means the range was ignored and we are about to parse a whole file. */
async function range(fetchImpl, url, start, end) {
  const response = await fetchImpl(url, { headers: { range: `bytes=${start}-${end - 1}` } })
  if (response.status !== 206 && response.status !== 200) {
    throw new Error(`${url} answered ${response.status} to a range request`)
  }
  return response.arrayBuffer()
}

/**
 * An AsyncBuffer for hyparquet that serves the file's tail from a cached
 * footer and everything else over HTTP.
 *
 * This is the trick the whole warm path rests on. hyparquet reads metadata by
 * seeking near the end of the file; give it a buffer that already holds those
 * bytes and the metadata parse costs no network at all, while the column
 * chunks it reads afterwards still stream from the bucket.
 */
export function remoteFile({ url, size, footer = null, fetch: fetchImpl = globalThis.fetch }) {
  const footerStart = footer ? size - footer.byteLength : size
  return {
    byteLength: size,
    async slice(start, end = size) {
      const from = Math.max(0, Math.floor(start))
      const to = Math.min(size, Math.ceil(end))
      if (footer && from >= footerStart) {
        const view = footer.subarray(from - footerStart, to - footerStart)
        /* A copy, not a view: hyparquet may hold it, and a shared buffer that
           later gets reused underneath it is a bug nobody finds twice. */
        return view.slice().buffer
      }
      return range(fetchImpl, url, from, to)
    },
  }
}

/** The last `bytes` of an object: the Parquet footer, plus its length prefix. */
export async function fetchFooter(url, size, { fetch: fetchImpl = globalThis.fetch } = {}) {
  /* The final eight bytes are a four-byte footer length and the magic "PAR1".
     Read them, then read exactly the footer rather than guessing a window. */
  const tail = new DataView(await range(fetchImpl, url, size - 8, size))
  const length = tail.getUint32(0, true)
  const whole = await range(fetchImpl, url, size - length - 8, size)
  return new Uint8Array(whole)
}

/**
 * A reader over one release, holding the caches.
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {(url: string) => Promise<Uint8Array|null>} [options.loadFooter] from a durable cache
 * @param {(url: string, footer: Uint8Array) => Promise<void>} [options.saveFooter]
 */
export function createParquetReader({
  fetch: fetchImpl = globalThis.fetch,
  loadFooter = null,
  saveFooter = null,
} = {}) {
  /** url → {metadata, file}, most recently used last. */
  const warm = new Map()

  async function open(part) {
    const held = warm.get(part.url)
    if (held) {
      /* Touch, so the least recently used is the one evicted. */
      warm.delete(part.url)
      warm.set(part.url, held)
      return held
    }
    let footer = loadFooter ? await loadFooter(part.url) : null
    if (!footer) {
      footer = await fetchFooter(part.url, part.size, { fetch: fetchImpl })
      if (saveFooter) await saveFooter(part.url, footer)
    }
    const file = remoteFile({ url: part.url, size: part.size, footer, fetch: fetchImpl })
    const metadata = await parquetMetadataAsync(file)
    const entry = { metadata, file }
    warm.set(part.url, entry)
    while (warm.size > FOOTERS_KEPT) warm.delete(warm.keys().next().value)
    return entry
  }

  /**
   * Every row inside `bounds`, from the parts and row groups that can hold
   * one. The caller gets whole rows; the box is applied here so no caller can
   * forget that a row group overlapping the box is mostly not in it.
   *
   * @param {{parts: Array}} index      from buildIndex
   * @param {{west,south,east,north}} bounds
   * @param {string[]} columns
   * @param {{signal?: AbortSignal, onGroup?: Function}} [options]
   */
  async function readBox(index, bounds, columns, { signal, onGroup } = {}) {
    const found = []
    for (const part of index.parts) {
      if (!overlaps(part, bounds)) continue
      const groups = part.groups.filter(group => overlaps(group, bounds))
      if (!groups.length) continue
      const { metadata, file } = await open(part)
      for (let at = 0; at < groups.length; at += READ_AT_ONCE) {
        if (signal?.aborted) throw new Error('places: read aborted')
        const batch = groups.slice(at, at + READ_AT_ONCE)
        const pages = await Promise.all(
          batch.map(group =>
            parquetReadObjects({
              file,
              metadata,
              compressors,
              columns,
              rowStart: group.s,
              rowEnd: group.e,
            }),
          ),
        )
        for (const rows of pages) {
          for (const row of rows) if (inside(row, bounds)) found.push(row)
          onGroup?.(rows.length)
        }
      }
    }
    return found
  }

  return { open, readBox, warmed: () => warm.size }
}

/** Whether a thing with a bbox could hold anything in the box. */
export const overlaps = (item, bounds) =>
  !(
    item.xmax < bounds.west ||
    item.xmin > bounds.east ||
    item.ymax < bounds.south ||
    item.ymin > bounds.north
  )

/** Whether a row's own point is in the box. Overture gives every place a bbox;
    for a point place its corners are the same to six decimals. */
export const inside = (row, bounds) => {
  const x = row?.bbox?.xmin
  const y = row?.bbox?.ymin
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= bounds.west &&
    x <= bounds.east &&
    y >= bounds.south &&
    y <= bounds.north
  )
}

const number = value => (typeof value === 'bigint' ? Number(value) : value)

/**
 * The index of a release: for every part its byte length and geographic
 * extent, and for every row group its row range and extent.
 *
 * Built once per release — ten seconds and half a megabyte for the planet —
 * and then the thing every query consults before it touches the network. It
 * holds no row data, so it can live in the database beside the coverage table
 * and be handed to a cold process.
 */
export async function buildIndex(parts, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const built = []
  for (const part of parts) {
    const footer = await fetchFooter(part.url, part.size, { fetch: fetchImpl })
    const file = remoteFile({ url: part.url, size: part.size, footer, fetch: fetchImpl })
    const metadata = await parquetMetadataAsync(file)
    let start = 0
    const groups = []
    let xmin = Infinity
    let xmax = -Infinity
    let ymin = Infinity
    let ymax = -Infinity
    for (const group of metadata.row_groups) {
      const rows = number(group.num_rows)
      const from = start
      start += rows
      const stats = {}
      for (const column of group.columns) {
        const path = (column.meta_data.path_in_schema || []).join('.')
        if (path.startsWith('bbox.') && column.meta_data.statistics) {
          stats[path] = column.meta_data.statistics
        }
      }
      if (!stats['bbox.xmin']) continue
      const box = {
        s: from,
        e: start,
        xmin: number(stats['bbox.xmin'].min_value),
        xmax: number(stats['bbox.xmax'].max_value),
        ymin: number(stats['bbox.ymin'].min_value),
        ymax: number(stats['bbox.ymax'].max_value),
      }
      groups.push(box)
      xmin = Math.min(xmin, box.xmin)
      xmax = Math.max(xmax, box.xmax)
      ymin = Math.min(ymin, box.ymin)
      ymax = Math.max(ymax, box.ymax)
    }
    built.push({ ...part, rows: number(metadata.num_rows), xmin, xmax, ymin, ymax, groups })
  }
  return { parts: built, builtAt: new Date().toISOString() }
}
