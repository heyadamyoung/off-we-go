import { useCallback, useRef, useState } from 'react'
import { askAssistant } from '../../../backend'
import { askedQuestion, sendableTranscript } from '../../../assistant-core'
import { track } from '../../../shared/lib/telemetry'
import { appErrorMessage } from '../../../user-messages-core'
import type { AssistantMessage, Id } from '../../../shared/model/types'

/* The chat, held above the panel so closing the sheet does not lose the
   afternoon's conversation. One question is in flight at a time: the model
   thinks for a while at full reasoning, and two overlapping answers to the
   same transcript would land out of order. */
export default function useAssistant({ tripId, slug }: { tripId: Id; slug: string }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const record = useRef(messages)
  record.current = messages
  const asking = useRef(false)

  const run = useCallback(
    async (sent: AssistantMessage[]) => {
      asking.current = true
      setMessages(sent)
      setBusy(true)
      setError(null)
      try {
        const reply = await askAssistant(tripId, slug, sendableTranscript(sent))
        setMessages(current => [...current, { role: 'assistant', text: reply }])
      } catch (caught) {
        /* A job's own verdict arrives as crafted, user-ready words; a rate
           limit gets the chat's own phrasing; anything else goes through the
           shared mapping. Either way the failure is an event — "the
           assistant failed at the airport" must be one query. */
        const final = caught as { final?: boolean; message?: string; status?: number }
        track('fail ask assistant', {
          trip: slug,
          reason: String(final.message || caught).slice(0, 160),
        })
        setError(
          final.final && final.message
            ? final.message
            : final.status === 429
              ? 'The assistant has too many questions at once — give it a minute, then try again.'
              : appErrorMessage(caught, 'ask-assistant'),
        )
      } finally {
        asking.current = false
        setBusy(false)
      }
    },
    [tripId, slug],
  )

  const ask = useCallback(
    async (text: string) => {
      const question = askedQuestion(text)
      if (!question || asking.current) return
      const sent = [...record.current, { role: 'user' as const, text: question }]
      /* Said before it is tried: a dead radio otherwise burns twelve minutes
         of polling to learn what the phone already knows. */
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setMessages(sent)
        setError('You are offline — the question was not sent. It will not send itself: retry.')
        return
      }
      await run(sent)
    },
    [run],
  )

  /* The failed question is still the last user turn in the transcript; retry
     replays it without writing it twice. */
  const retry = useCallback(async () => {
    if (asking.current) return
    const last = record.current[record.current.length - 1]
    if (last?.role !== 'user') return
    await run([...record.current])
  }, [run])

  return { messages, busy, error, ask, retry }
}
