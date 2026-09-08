/* Turning what a phone filmed into what every phone can play.

   An iPhone records HEVC inside a .mov. Safari plays it; Chrome and Android
   do not. Before this, half a trip could not watch what the other half
   filmed, and the only clue was a black rectangle. H.264 video with AAC audio
   in an MP4 is the one combination that has played everywhere for a decade,
   so that is what everything becomes.

   Nothing here knows about HTTP, Postgres or the queue: it takes a file and
   gives back a file, which is what lets the worker move to its own fleet
   later without any of this coming with it. */

import { spawn } from 'node:child_process'
import { stat, rm } from 'node:fs/promises'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

/** Codecs a browser will decode without argument, whatever the container. */
const BROADLY_PLAYABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const BROADLY_PLAYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis'])
/* mov and mp4 are the same container underneath, but a .mov served as
   video/quicktime is refused by browsers that would happily play its
   contents, so only mp4 and webm are left alone. */
const BROADLY_PLAYABLE_CONTAINER = /(^|,)(mp4|webm)(,|$)/

const run = (command, args, { timeoutMs = 20 * 60_000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    /* The tail of stderr is the whole diagnosis when ffmpeg refuses — it names
       the codec, the stream, the reason. Discarding it is how a conversion
       failure becomes "it didn't work". Bounded, because a long convert
       writes progress to stderr for minutes. */
    child.stdout.on('data', chunk => {
      out += chunk
      if (out.length > 1_000_000) out = out.slice(-1_000_000)
    })
    child.stderr.on('data', chunk => {
      err += chunk
      if (err.length > 8000) err = err.slice(-8000)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(Object.assign(new Error(`${command} timed out`), { stderr: err.slice(-2000) }))
    }, timeoutMs)
    child.on('error', error => {
      clearTimeout(timer)
      reject(Object.assign(error, { stderr: err.slice(-2000) }))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) return resolve({ stdout: out, stderr: err })
      reject(
        Object.assign(new Error(`${command} exited ${code}`), { code, stderr: err.slice(-2000) }),
      )
    })
  })

/** Whether this box can convert at all; the API refuses to promise if not. */
export async function transcoderAvailable() {
  try {
    await run(FFMPEG, ['-hide_banner', '-version'], { timeoutMs: 10_000 })
    return true
  } catch {
    return false
  }
}

/** What a file actually contains, as opposed to what its extension claims. */
export async function probe(path) {
  const { stdout } = await run(
    FFPROBE,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', String(path)],
    { timeoutMs: 60_000 },
  )
  const parsed = JSON.parse(stdout || '{}')
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find(stream => stream.codec_type === 'video') || null
  const audio = streams.find(stream => stream.codec_type === 'audio') || null
  const seconds = Number(parsed.format?.duration)
  return {
    container: String(parsed.format?.format_name || ''),
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    width: Number(video?.width) || null,
    height: Number(video?.height) || null,
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    /* A phone filming in portrait writes landscape frames plus a rotation.
       Anything that ignores the tag shows it on its side. */
    rotation: Number(video?.side_data_list?.[0]?.rotation) || 0,
  }
}

/** Whether a file is already something every browser will play as it stands. */
export const alreadyPlayable = facts =>
  !!facts.videoCodec &&
  BROADLY_PLAYABLE_VIDEO.has(facts.videoCodec) &&
  (!facts.audioCodec || BROADLY_PLAYABLE_AUDIO.has(facts.audioCodec)) &&
  BROADLY_PLAYABLE_CONTAINER.test(facts.container) &&
  // A rotation tag is exactly what naive players drop; bake it in instead.
  !facts.rotation

/* The long edge every device can decode without pause. 1080p is where a phone
   camera's extra pixels stop being visible on a phone and start being
   somebody's data allowance. */
const MAX_EDGE = 1920

export function scaleFilter(width, height, maxEdge = MAX_EDGE) {
  if (!width || !height) return null
  if (Math.max(width, height) <= maxEdge) return null
  /* Even dimensions, because H.264's chroma subsampling cannot express odd
     ones and ffmpeg fails the encode outright rather than rounding. */
  return width >= height ? `scale=${maxEdge}:-2` : `scale=-2:${maxEdge}`
}

/**
 * Convert to H.264/AAC MP4. Returns the facts of what was written.
 * @param {{ source: string, target: string, facts?: object, timeoutMs?: number }} options
 */
export async function toPlayableMp4({ source, target, facts, timeoutMs }) {
  const known = facts || (await probe(source))
  const scale = scaleFilter(known.width, known.height)
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      String(source),
      ...(scale ? ['-vf', scale] : []),
      '-c:v',
      'libx264',
      // veryfast is the knee of the curve: slower presets cost minutes of a
      // worker's life to save a few percent nobody watching can see.
      '-preset',
      'veryfast',
      '-crf',
      '23',
      // baseline-friendly enough for old Androids, still cheap to decode.
      '-profile:v',
      'high',
      '-level',
      '4.0',
      '-pix_fmt',
      'yuv420p',
      ...(known.audioCodec ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      // The index goes at the front, so playback starts before the whole file
      // has arrived. Without this a video downloads entirely before it plays.
      '-movflags',
      '+faststart',
      String(target),
    ],
    { timeoutMs },
  )
  const written = await stat(target)
  if (!written.size) {
    await rm(target, { force: true })
    throw new Error('The conversion produced an empty file')
  }
  return { ...(await probe(target)), bytes: written.size }
}

/* The still that stands in for a film everywhere it cannot play. Drawn here
   rather than on the phone, because the phone that filmed an HEVC video is
   often the only device that could have decoded it — every Android in the
   trip would have uploaded a film with no picture at all. */
export async function posterFrame({ source, target, atMs = 1000, durationMs, timeoutMs }) {
  // Never seek past the end: a one-second clip has no frame at one second.
  const at = Math.max(0, Math.min(atMs, Math.max(0, (durationMs ?? atMs * 2) - 100))) / 1000
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      // Before -i, so ffmpeg seeks rather than decoding everything up to it.
      '-ss',
      at.toFixed(3),
      '-i',
      String(source),
      '-frames:v',
      '1',
      '-q:v',
      '3',
      String(target),
    ],
    { timeoutMs: timeoutMs || 120_000 },
  )
  const written = await stat(target).catch(() => null)
  if (!written?.size) throw new Error('No frame could be drawn from this video')
  return { bytes: written.size }
}
