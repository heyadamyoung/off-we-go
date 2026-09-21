/* Enough of the Mapbox Vector Tile wire format to count what a tile carries.
 *
 * No dependency: the app's own decoder lives inside MapLibre, which is a
 * browser bundle, and adding a package to the tree so one probe can read a
 * tile is a worse trade than sixty lines of protobuf. Only the fields that
 * answer the question are read — how many features, and the `minzoom` each
 * one carries — and anything else in the tile is skipped by length.
 *
 *   Tile    { repeated Layer layers = 3 }
 *   Layer   { string name = 1, repeated Feature features = 2,
 *             repeated string keys = 3, repeated Value values = 4 }
 *   Feature { repeated uint32 tags = 2 (packed) }
 *   Value   { string = 1, float = 2, double = 3, int64 = 4, uint64 = 5,
 *             sint64 = 6, bool = 7 }
 */

/** A base-128 varint, little end first. Numbers here are tag indexes and
    zooms, so they stay well inside a double's exact range. */
function varint(bytes, at) {
  let value = 0
  let scale = 1
  for (;;) {
    const byte = bytes[at.i++]
    value += (byte & 0x7f) * scale
    if ((byte & 0x80) === 0) return value
    scale *= 128
  }
}

/** Walk one message, handing each field to `each` as a byte range. */
function fields(bytes, from, to, each) {
  const at = { i: from }
  while (at.i < to) {
    const tag = varint(bytes, at)
    const wire = tag & 7
    const field = (tag - wire) / 8
    if (wire === 2) {
      const length = varint(bytes, at)
      each(field, at.i, at.i + length, null)
      at.i += length
    } else if (wire === 0) {
      each(field, 0, 0, varint(bytes, at))
    } else if (wire === 5) {
      each(field, at.i, at.i + 4, null)
      at.i += 4
    } else if (wire === 1) {
      each(field, at.i, at.i + 8, null)
      at.i += 8
    } else {
      throw new Error(`mvt: wire type ${wire}`)
    }
  }
}

const text = new TextDecoder()

/** One Value message, as whichever of its seven shapes it carries.
 *
 * All seven, and the float is not padding: `label_zoom` is a `real`, so
 * ST_AsMVT writes every mark's zoom as a four-byte float. A reader that knows
 * only about integers gets `null` for all of them and reports a live tile as
 * carrying no zooms at all — which this did, against production, while its
 * test passed because the fixture happened to declare an `int` column. */
function oneValue(bytes, from, to) {
  let found = null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  fields(bytes, from, to, (field, start, end, number) => {
    if (field === 1) found = text.decode(bytes.subarray(start, end))
    else if (field === 2) found = view.getFloat32(start, true)
    else if (field === 3) found = view.getFloat64(start, true)
    else if (field >= 4 && field <= 6) found = number
    else if (field === 7) found = Boolean(number)
  })
  return found
}

/**
 * What a tile holds: how many features, and how many of them at each zoom.
 *
 * @param {Uint8Array} bytes  a .mvt body
 * @param {string} attribute  the tag to count by
 */
export function tileHolds(bytes, attribute = 'minzoom') {
  let features = 0
  const zooms = new Map()
  const ids = []
  fields(bytes, 0, bytes.length, (field, from, to) => {
    if (field !== 3) return
    const keys = []
    const values = []
    const rows = []
    fields(bytes, from, to, (inner, start, end) => {
      if (inner === 2) rows.push([start, end])
      else if (inner === 3) keys.push(text.decode(bytes.subarray(start, end)))
      else if (inner === 4) values.push(oneValue(bytes, start, end))
    })
    const wanted = keys.indexOf(attribute)
    const named = keys.indexOf('id')
    for (const [start, end] of rows) {
      features += 1
      let at = null
      let id = null
      fields(bytes, start, end, (inner, tagsFrom, tagsTo) => {
        if (inner !== 2) return
        const walk = { i: tagsFrom }
        while (walk.i < tagsTo) {
          const key = varint(bytes, walk)
          const value = varint(bytes, walk)
          if (key === wanted && wanted >= 0) at = values[value] ?? null
          if (key === named && named >= 0) id = values[value] ?? null
        }
      })
      if (id !== null) ids.push(String(id))
      const key = at === null ? 'none' : String(at)
      zooms.set(key, (zooms.get(key) ?? 0) + 1)
    }
  })
  return {
    features,
    ids,
    zooms: [...zooms.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([zoom, count]) => `${zoom}:${count}`)
      .join(' '),
  }
}
