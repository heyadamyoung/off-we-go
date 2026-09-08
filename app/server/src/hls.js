/* Adaptive streaming, decided arithmetically.

   One file at one bitrate is a bet that everybody watching has the same
   connection. A trip is exactly where that bet loses: somebody is on hotel
   wifi and somebody is on a train through a valley, and the second one waits
   through a buffering spinner for a film the first one is already watching.

   HLS answers by publishing the same film at several sizes and letting the
   player pick, second by second. What that needs from us is a ladder — which
   sizes are worth making for this particular film — and playlists whose
   segment links this reader is allowed to fetch. Neither of those needs
   ffmpeg, HTTP or a database, so neither of them is in a file that has any. */

import { posix } from 'node:path'

/* Where extra pixels stop being visible on the thing people watch trips on.
   The same ceiling the single-file conversion uses, for the same reason: past
   here it is somebody's data allowance rather than a better picture. */
const TALLEST = 1080
/* The rungs below the top. Standard sizes, because a player switching between
   them mid-film should be switching between shapes that screens and hardware
   decoders are already good at. */
const RUNGS = [720, 480, 360]
/** Below this there is no ladder worth building — one rung and be done. */
const SMALLEST = 200
/** How long a segment runs. Four seconds is the usual compromise: short
    enough to switch quality within a few seconds of the line changing, long
    enough that a film is not a thousand requests. */
export const SEGMENT_SECONDS = 4

/** What a film looks like once its rotation tag has been honoured. */
export function displaySize({ width, height, rotation = 0 }) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return null
  // A phone filming in portrait writes landscape frames plus a quarter turn.
  const turned = Math.abs(Math.round(Number(rotation) || 0)) % 180 === 90
  return turned ? { width: h, height: w } : { width: w, height: h }
}

/* How much bitrate one halving of the picture is worth. Not a square law:
   the same scene at half the height needs rather more than a quarter of the
   bits to look as good, because detail does not shrink as fast as area. */
const BY_SIZE = 1.6

/* Bits per second for a short edge, on the curve the standard ladders sit on:
   5 Mbit at 1080, and roughly 2.6 / 1.4 / 0.9 at 720 / 480 / 360. Expressed
   as a curve rather than a table so a film of an unusual size gets a sensible
   number instead of the nearest label's.

   `sourceKbps` is the ceiling the film itself sets. A clip filmed at half a
   megabit does not become better by being re-encoded at five: every bit past
   what was actually recorded is a bit spent storing compression artefacts in
   higher fidelity, and paying to send them to somebody on a train. */
export function videoKbps(shortEdge, { sourceKbps = null, sourceShortEdge = null } = {}) {
  const curve = 5000 * (Math.max(1, shortEdge) / TALLEST) ** BY_SIZE
  const ceiling =
    sourceKbps > 0 && sourceShortEdge > 0
      ? // A tenth over, because re-encoding is never quite free.
        sourceKbps * 1.1 * Math.min(1, shortEdge / sourceShortEdge) ** BY_SIZE
      : Number.POSITIVE_INFINITY
  const raw = Math.min(curve, ceiling)
  return Math.round(Math.min(5000, Math.max(250, raw)) / 50) * 50
}

/** Audio is the one thing worth spending on at every size; only just less. */
export const audioKbps = shortEdge => (shortEdge >= 720 ? 128 : shortEdge >= 480 ? 96 : 64)

/**
 * The sizes worth encoding for this particular film.
 *
 * Never larger than what was filmed — upscaling spends a worker's minutes to
 * make a bigger file of the same picture — and never larger than 1080 either.
 * A film smaller than the smallest rung gets one rendition at its own size,
 * so that even a tiny clip is streamed rather than downloaded whole.
 *
 * @returns {{name: string, width: number, height: number, shortEdge: number,
 *            videoKbps: number, audioKbps: number}[]} widest first.
 */
export function renditionLadder(facts) {
  const size = displaySize(facts || {})
  if (!size) return []
  const portrait = size.height > size.width
  const short = Math.min(size.width, size.height)
  const aspect = portrait ? size.height / size.width : size.width / size.height

  const even = value => Math.max(2, Math.round(value / 2) * 2)
  const top = Math.min(short, TALLEST)
  const heights =
    top < SMALLEST
      ? [top]
      : /* The top rung is the film's own size rather than the nearest label
           below it: somebody who filmed at 900 should be watching 900, not
           720 with the difference thrown away before anybody chose. */
        [top, ...RUNGS.filter(rung => rung < top * 0.92)]

  const sized = heights.map(rung => {
    const shortEdge = even(rung)
    const longEdge = even(shortEdge * aspect)
    return {
      width: portrait ? shortEdge : longEdge,
      height: portrait ? longEdge : shortEdge,
      shortEdge,
      videoKbps: videoKbps(shortEdge, { sourceKbps: facts?.videoKbps, sourceShortEdge: short }),
      audioKbps: audioKbps(shortEdge),
    }
  })

  /* Rungs a player would never have a reason to choose between are not rungs.
     A film shot at a low bitrate has every size pressed against the same
     floor, and publishing three renditions of it that cost the same number of
     bits is three encodes, three times the storage, and one decision the
     player still cannot make usefully. A rung earns its place by being at
     least a quarter cheaper than the one above it. */
  const kept = []
  for (const rung of sized) {
    const above = kept[kept.length - 1]
    if (!above || rung.videoKbps <= above.videoKbps * 0.75) kept.push(rung)
  }
  return kept.map((rung, index) => ({
    /* The directory this rung's segments land in. ffmpeg substitutes %v with
       the variant's index, so the name is the index: anything else and the
       encoder writes one tree while we look in another. */
    name: String(index),
    ...rung,
  }))
}

/** The scale filter for one rung, sized on the edge that decides quality. */
export const rungScale = rung =>
  rung.width >= rung.height ? `scale=-2:${rung.shortEdge}` : `scale=${rung.shortEdge}:-2`

/* ---- playlists ---------------------------------------------------------

   A playlist is a list of links, and every link in it has to be one the
   reader is allowed to follow. Players do not carry the query string of a
   playlist down to the segments it names — neither hls.js nor Safari — so a
   playlist stored with relative names and served as-is would have its
   segments refused one after another.

   So the links are put in as the playlist is served: the file on disk keeps
   the relative names ffmpeg wrote, and every read hands back a copy in which
   each of them has become a signed URL. The playlist is a few hundred bytes
   and is fetched once; the segments it points at stay plain signed URLs that
   any cache in front of us can hold. */

/** Where a URI inside a playlist actually lives, or null if it escapes. */
export function resolveUri(directory, uri) {
  const clean = String(uri || '').trim()
  if (!clean || clean.startsWith('#')) return null
  // An absolute URL is somebody else's problem, and never something we wrote.
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return null
  /* Refused before it is joined, not after: join swallows a leading slash, so
     `/etc/passwd` would come out as a path inside the film's own directory
     and read as an ordinary relative name. */
  if (clean.startsWith('/')) return null
  const resolved = posix.normalize(posix.join(String(directory || ''), clean))
  /* Normalising is what makes this check meaningful: `a/../../b` is `../b`
     by the time it gets here, and a playlist is a file we wrote, so anything
     pointing outside its own directory is a bug or an attack, not a URI. */
  if (resolved.startsWith('..') || resolved.startsWith('/')) return null
  return resolved
}

const URI_ATTRIBUTE = /URI="([^"]*)"/g

/**
 * The same playlist with every link in it signed.
 *
 * @param {string} text the playlist as it was stored
 * @param {string} directory the storage directory the playlist itself sits in
 * @param {(storagePath: string) => string} link how to sign one path
 */
export function signPlaylist(text, directory, link) {
  const signed = uri => {
    const path = resolveUri(directory, uri)
    return path ? link(path) : uri
  }
  return String(text)
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed) return line
      /* Tags carry their links in a URI attribute — the initialisation
         segment, the audio renditions, the I-frame playlists a player scrubs
         with. A tag whose URI is left relative is a feature that silently
         stops working rather than one that fails. */
      if (trimmed.startsWith('#')) {
        return URI_ATTRIBUTE.test(line)
          ? line.replace(URI_ATTRIBUTE, (_, uri) => `URI="${signed(uri)}"`)
          : line
      }
      return signed(trimmed)
    })
    .join('\n')
}

/** Everything a playlist points at, so a stored film can be swept up whole. */
export function playlistReferences(text, directory) {
  const found = new Set()
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) {
      for (const [, uri] of trimmed.matchAll(URI_ATTRIBUTE)) {
        const path = resolveUri(directory, uri)
        if (path) found.add(path)
      }
      continue
    }
    const path = resolveUri(directory, trimmed)
    if (path) found.add(path)
  }
  return [...found]
}

/** Where a film's stream lives, given where the film itself does. */
export const hlsDirectory = storagePath => {
  const value = String(storagePath || '')
  const dot = value.lastIndexOf('.')
  const slash = value.lastIndexOf('/')
  const stem = dot > slash ? value.slice(0, dot) : value
  return `${stem}.hls`
}

export const MASTER_NAME = 'master.m3u8'
