import { useCallback, useEffect, useRef, useState } from 'react'
import {
  begin,
  dismiss,
  done,
  enqueue,
  fail,
  hold,
  progressed,
  requeue,
  retry,
  retryAll,
  retryDelay,
  startable,
  worthRetrying,
  type Upload,
} from '../../../upload-queue-core'
import { appErrorMessage } from '../../../user-messages-core'
import { track } from '../../../shared/lib/telemetry'

/* How many goes a photograph gets on its own before a person is asked. Three
   covers the shape of a real mobile outage — a tunnel, a lift, a dead spot —
   without holding a doomed upload for ever. */
const OWN_ATTEMPTS = 3
import type { UploadInput, Toast } from '../../../shared/model/types'

interface Queued extends Omit<Upload, 'state'> {
  input: UploadInput
}

/** What the screen needs to draw a bar, and what a caller needs to feed one. */
export type UploadSend = (
  input: UploadInput,
  onProgress: (sent: number, total: number | null) => void,
) => Promise<unknown>

/* Sends the photographs in the background, a few at a time, so choosing them
   is over the moment they are chosen and the rest of the app stays usable. */
/* The preview is an object URL handed over by the upload sheet, so this queue
   owns it now and has to let it go — otherwise every photograph ever uploaded
   keeps its bytes in memory for the life of the tab. */
const release = (list: Upload[], key: string) => {
  const going = list.find(upload => upload.key === key)
  if (going?.preview?.startsWith('blob:')) URL.revokeObjectURL(going.preview)
}

export default function useUploadQueue({ send, toast }: { send: UploadSend; toast: Toast }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  /* How many have gone up since the queue was last empty, so the bar can say
     "8 of 20" for the whole batch. A count taken from the queue alone would
     read "1 of 12", then "1 of 11", because done is gone. */
  const [finished, setFinished] = useState(0)
  const inputs = useRef(new Map<string, UploadInput>())
  const flying = useRef(new Set<string>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const add = useCallback((items: Queued[]) => {
    for (const item of items) inputs.current.set(item.key, item.input)
    setUploads(list =>
      enqueue(
        list,
        items.map(({ input, ...rest }) => rest),
      ),
    )
  }, [])

  const tryAgain = useCallback((key: string) => {
    // A person retrying the same photo five times is a fact worth counting.
    track('retry upload', {})
    setUploads(list => retry(list, key))
  }, [])
  const tryEveryFailure = useCallback(() => {
    track('retry upload', { all: 'yes' })
    setUploads(retryAll)
  }, [])
  const forget = useCallback((key: string) => {
    inputs.current.delete(key)
    setUploads(list => {
      release(list, key)
      return dismiss(list, key)
    })
  }, [])

  /* One decision from one view of the queue. `flying` is the guard rather
     than the rendered state: an effect can run twice on the same state, and
     starting the same upload twice is two files on the trip. */
  const sendRef = useRef(send)
  sendRef.current = send
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    const starting = startable(uploads).filter(item => !flying.current.has(item.key))
    if (!starting.length) return

    for (const waiting of starting) flying.current.add(waiting.key)
    setUploads(list => starting.reduce((next, item) => begin(next, item.key), list))

    for (const waiting of starting) {
      const input = inputs.current.get(waiting.key)
      const onProgress = (sent: number, total: number | null) =>
        setUploads(list => progressed(list, waiting.key, sent, total))

      Promise.resolve(
        input
          ? sendRef.current(input, onProgress)
          : Promise.reject(new Error('That photo is no longer here')),
      )
        .then(() => {
          inputs.current.delete(waiting.key)
          setFinished(count => count + 1)
          setUploads(list => {
            release(list, waiting.key)
            return done(list, waiting.key)
          })
        })
        .catch(error => {
          const attempts = (waiting.attempts || 0) + 1
          const again = worthRetrying(error) && attempts < OWN_ATTEMPTS
          /* Every failure is counted whether or not it is shown, because "one
             person's videos keep bouncing" is a question about the ones that
             quietly succeeded on the second go too. */
          track('upload failed', {
            kind: waiting.kind || 'photo',
            attempt: String(attempts),
            retrying: again ? 'yes' : 'no',
            status: String((error as { status?: number } | null)?.status ?? 'none'),
          })
          if (again) {
            /* A dropped signal is not the traveller's problem to solve. It goes
               quietly back into the queue and nothing is said unless the last
               go fails too. */
            const timer = setTimeout(() => {
              timers.current.delete(timer)
              setUploads(list => requeue(list, waiting.key))
            }, retryDelay(attempts))
            timers.current.add(timer)
            setUploads(list => hold(list, waiting.key, 'Waiting for a better signal…'))
            return
          }
          setUploads(list => fail(list, waiting.key, appErrorMessage(error, 'upload-photo')))
          toastRef.current(appErrorMessage(error, 'upload-photo'), 'error')
        })
        .finally(() => {
          flying.current.delete(waiting.key)
        })
    }
  }, [uploads])

  /* The count belongs to a batch, so it goes when the batch does. Without
     this a second lot of photographs starts at "1 of 21". */
  useEffect(() => {
    if (!uploads.length && finished) setFinished(0)
  }, [uploads.length, finished])

  // A queue that outlives its screen must not keep waking it up.
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current.clear()
    },
    [],
  )

  return { uploads, finished, add, tryAgain, tryEveryFailure, forget }
}
