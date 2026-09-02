import { useCallback, useEffect, useRef, useState } from 'react'
import {
  begin, dismiss, done, enqueue, fail, next, retry, type Upload,
} from '../../../upload-queue-core'
import { appErrorMessage } from '../../../user-messages-core'
import type { UploadInput, Toast } from '../../../shared/model/types'

interface Queued extends Omit<Upload, 'state'> { input: UploadInput }

/* Sends the photographs one at a time in the background, so choosing them is
   over the moment they are chosen and the rest of the app stays usable. */
export default function useUploadQueue(
  { send, toast }: { send: (input: UploadInput) => Promise<unknown>; toast: Toast },
) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const inputs = useRef(new Map<string, UploadInput>())
  const sending = useRef(false)

  const add = useCallback((items: Queued[]) => {
    for (const item of items) inputs.current.set(item.key, item.input)
    setUploads(list => enqueue(list, items.map(({ input, ...rest }) => rest)))
  }, [])

  const tryAgain = useCallback((key: string) => setUploads(list => retry(list, key)), [])
  const forget = useCallback((key: string) => {
    inputs.current.delete(key)
    setUploads(list => dismiss(list, key))
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
        setUploads(list => done(list, waiting.key))
      })
      .catch(error => {
        setUploads(list => fail(list, waiting.key, appErrorMessage(error, 'upload-photo')))
        toast(appErrorMessage(error, 'upload-photo'), 'error')
      })
      .finally(() => { sending.current = false })
  }, [uploads, send, toast])

  return { uploads, add, tryAgain, forget }
}
