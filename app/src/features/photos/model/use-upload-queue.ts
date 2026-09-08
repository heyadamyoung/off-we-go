import { useCallback, useEffect, useRef, useState } from 'react'
import {
  begin,
  dismiss,
  done,
  enqueue,
  fail,
  hold,
  next,
  requeue,
  retry,
  retryDelay,
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

/* Sends the photographs one at a time in the background, so choosing them is
   over the moment they are chosen and the rest of the app stays usable. */
/* The preview is an object URL handed over by the upload sheet, so this queue
   owns it now and has to let it go — otherwise every photograph ever uploaded
   keeps its bytes in memory for the life of the tab. */
const release = (list: Upload[], key: string) => {
  const going = list.find(upload => upload.key === key)
  if (going?.preview?.startsWith('blob:')) URL.revokeObjectURL(going.preview)
}

export default function useUploadQueue({
  send,
  toast,
}: {
  send: (input: UploadInput) => Promise<unknown>
  toast: Toast
}) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const inputs = useRef(new Map<string, UploadInput>())
  const sending = useRef(false)
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
  const forget = useCallback((key: string) => {
    inputs.current.delete(key)
    setUploads(list => {
      release(list, key)
      return dismiss(list, key)
    })
  }, [])

  useEffect(() => {
    if (sending.current) return
    const waiting = next(uploads)
    if (!waiting) return

    sending.current = true
    setUploads(list => begin(list, waiting.key))
    const input = inputs.current.get(waiting.key)

    Promise.resolve(input ? send(input) : Promise.reject(new Error('That photo is no longer here')))
      .then(() => {
        inputs.current.delete(waiting.key)
        setUploads(list => {
          release(list, waiting.key)
          return done(list, waiting.key)
        })
      })
      .catch(error => {
        const attempts = waiting.attempts || 1
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
        toast(appErrorMessage(error, 'upload-photo'), 'error')
      })
      .finally(() => {
        sending.current = false
      })
  }, [uploads, send, toast])

  // A queue that outlives its screen must not keep waking it up.
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current.clear()
    },
    [],
  )

  return { uploads, add, tryAgain, forget }
}
