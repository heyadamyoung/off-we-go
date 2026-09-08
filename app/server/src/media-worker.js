/* The thing that drains media_jobs.

   It knows nothing about HTTP. It claims a job, converts a file, tells the
   repository what happened, and goes round again — so running N of these on
   their own machines is a deployment change rather than a rewrite. Today it
   runs inside the API process because that is one box; the claim uses
   `for update skip locked`, so the day it is two boxes nothing here changes.

   Everything it does is idempotent against a crash: a job whose claim expires
   returns to the queue, and a conversion that was interrupted leaves only a
   temp file, never a half-written photograph row. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { alreadyPlayable, posterFrame, probe, toHlsLadder, toPlayableMp4 } from './transcode.js'
import { span, stamp } from './tracing.js'

/** How long a worker may hold a job before others assume it died. */
const CLAIM_MS = 25 * 60_000
/** Give up after this many goes; a film that will not convert never will. */
const MAX_ATTEMPTS = 3

export function createMediaWorker({
  repository,
  fileStore,
  logger = console,
  /* A name that survives in the claim, so "which box was converting this when
     it fell over" is answerable from the table alone. */
  workerId = `${process.env.HOSTNAME || 'api'}-${randomUUID().slice(0, 8)}`,
  idleMs = 5_000,
  onFinished = null,
  /* Whether this fleet publishes adaptive streams as well as converting.
     Off, and everything still works: a film is a single MP4 served by the
     range, which is what it was before and what every browser can still
     play. On, and the same film also comes in several sizes a player can
     move between as somebody walks out of wifi. */
  ladders = true,
  now = () => new Date(),
}) {
  let running = false
  let timer = null

  /* The same film at several sizes, published as a stream.

     Its own job rather than the tail of the conversion, because the two are
     worth different things and fail differently: the conversion is what makes
     a film playable at all, and this only makes it play better. A ladder that
     will not build must cost the film nothing — the MP4 stays exactly where
     it is, and the row goes on saying ready. */
  const buildLadder = async (job, scratch) => {
    const source = join(scratch, 'source')
    const target = join(scratch, 'hls')
    await fileStore.download(job.storagePath, source)
    const facts = await probe(source)
    stamp({
      'video.width': facts.width || 0,
      'video.height': facts.height || 0,
      'video.kbps': facts.videoKbps || 0,
      'video.duration_ms': facts.durationMs || 0,
    })

    const built = await toHlsLadder({ source, target, facts })
    /* The ladder as built, on the span: which sizes a film was actually
       published at is the first question when somebody says it looked soft,
       and it is not otherwise recorded anywhere. */
    stamp({
      'hls.rungs': built.rungs.length,
      'hls.ladder': built.rungs
        .map(rung => `${rung.width}x${rung.height}@${rung.videoKbps}k`)
        .join(' '),
      'hls.bytes': built.bytes,
    })

    const stored = await fileStore.storeHls({ storagePath: job.storagePath, directory: target })
    stamp({ 'hls.files': stored.files })
    await repository.completeMediaJob({
      id: job.id,
      photoId: job.photoId,
      hlsPath: stored.hlsPath,
    })
  }

  /* One job, start to finish. Returns whether anything was done, so the loop
     knows to come straight back rather than sleep. */
  const runOne = async () => {
    const job = await repository.claimMediaJob({
      workerId,
      until: new Date(now().getTime() + CLAIM_MS),
      now: now(),
    })
    if (!job) return false

    return span(
      job.kind === 'hls' ? 'build video ladder' : 'convert video',
      {
        'job.id': job.id,
        'job.kind': job.kind || 'transcode',
        'photo.id': job.photoId,
        'job.attempts': job.attempts,
        'worker.id': workerId,
      },
      async () => {
        const scratch = await mkdtemp(join(tmpdir(), 'offwego-convert-'))
        const started = now().getTime()
        try {
          if (job.kind === 'hls') {
            await buildLadder(job, scratch)
            stamp({ 'job.outcome': 'done', 'job.ms': now().getTime() - started })
            onFinished?.({ ...job, streamed: true })
            return true
          }
          const original = join(scratch, 'original')
          const converted = join(scratch, 'converted.mp4')
          const poster = join(scratch, 'poster.jpg')

          await fileStore.download(job.storagePath, original)
          const facts = await probe(original)
          stamp({
            'video.codec': facts.videoCodec || 'none',
            'video.audio_codec': facts.audioCodec || 'none',
            'video.container': facts.container,
            'video.width': facts.width || 0,
            'video.height': facts.height || 0,
            'video.duration_ms': facts.durationMs || 0,
            'video.rotation': facts.rotation,
          })

          /* A film already in a shape every browser plays is left exactly as
             it was filmed. Re-encoding it would spend minutes of CPU to make
             it visibly worse, which is the one thing nobody asked for. */
          const needsConvert = !alreadyPlayable(facts)
          stamp({ 'video.converted': needsConvert })
          let stored = null
          if (needsConvert) {
            const result = await toPlayableMp4({ source: original, target: converted, facts })
            stamp({ 'video.out_bytes': result.bytes, 'video.out_codec': result.videoCodec })
            stored = await fileStore.replaceVideo({
              storagePath: job.storagePath,
              file: converted,
              mime: 'video/mp4',
            })
          }

          /* The poster is drawn from whatever is now the real file. A phone
             that could not decode its own film sent no frame, and every
             Android on the trip would have seen an empty tile. */
          let posterPaths = null
          if (!job.posterPath) {
            try {
              await posterFrame({
                source: needsConvert ? converted : original,
                target: poster,
                durationMs: facts.durationMs,
              })
              posterPaths = await fileStore.storePosterFile({
                storagePath: stored?.storagePath || job.storagePath,
                file: poster,
              })
            } catch (error) {
              /* A film with no drawable frame is still the film. The reason
                 goes on the span; the row goes on being ready. */
              stamp({ 'video.poster_fail': String(error.message || error).slice(0, 200) })
            }
          }

          await repository.completeMediaJob({
            id: job.id,
            photoId: job.photoId,
            ...(stored ? { storagePath: stored.storagePath, mime: 'video/mp4' } : {}),
            ...(posterPaths || {}),
            durationMs: facts.durationMs,
            /* The bytes it replaced are nobody's now; the deletion queue
               sweeps them so a failed sweep is retried rather than lost. */
            replaced: stored ? job.storagePath : null,
            /* And now the ladder, against whatever the file has just become.
               Asked for in the same transaction that finished this, so a
               crash in between cannot leave a converted film that nobody
               ever queues renditions for. */
            ...(ladders ? { thenQueue: 'hls' } : {}),
          })
          stamp({ 'job.outcome': 'done', 'job.ms': now().getTime() - started })
          onFinished?.({ ...job, converted: needsConvert })
          return true
        } catch (error) {
          const fatal = job.attempts + 1 >= MAX_ATTEMPTS
          stamp({
            'job.outcome': fatal ? 'failed' : 'retrying',
            'job.fail_cause': String(error.message || error).slice(0, 200),
            // ffmpeg's own words, which are the whole diagnosis.
            'job.ffmpeg': String(error.stderr || '').slice(-600),
          })
          logger.warn?.(
            {
              err: error,
              jobId: job.id,
              photoId: job.photoId,
              kind: job.kind,
              ffmpeg: error.stderr,
            },
            'media conversion failed',
          )
          await repository.failMediaJob({
            id: job.id,
            photoId: job.photoId,
            /* Which work failed, because it decides what it costs. A film
               whose conversion will not happen has to say so; a film whose
               ladder will not build has lost nothing anybody can see, and
               marking it failed would put an error over something that
               plays perfectly well. */
            kind: job.kind || 'transcode',
            error:
              `${error.message || error}${error.stderr ? ` :: ${error.stderr.slice(-400)}` : ''}`.slice(
                0,
                2000,
              ),
            fatal,
            /* Backoff, because the usual repeat failure is a box under load
               rather than a film that cannot be converted. */
            runAfter: new Date(now().getTime() + 60_000 * 2 ** job.attempts),
          })
          /* A film that will never convert is still watchable by whoever
             filmed it, so the row goes back to ready rather than staying
             stuck behind a spinner for ever. */
          onFinished?.({ ...job, converted: false })
          return true
        } finally {
          await rm(scratch, { recursive: true, force: true })
        }
      },
    )
  }

  const loop = async () => {
    if (!running) return
    let did = false
    try {
      did = await runOne()
    } catch (error) {
      // Claiming itself failed — the database is unwell. Wait it out.
      logger.warn?.({ err: error }, 'media worker could not claim a job')
    }
    if (!running) return
    timer = setTimeout(loop, did ? 0 : idleMs)
    timer.unref?.()
  }

  return {
    start() {
      if (running) return
      running = true
      timer = setTimeout(loop, 0)
      timer.unref?.()
    },
    async stop() {
      running = false
      if (timer) clearTimeout(timer)
      timer = null
    },
    // For tests: drain synchronously rather than on a timer.
    runOne,
    workerId,
  }
}
