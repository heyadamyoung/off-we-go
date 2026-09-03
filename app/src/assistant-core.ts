import type { AssistantMessage } from './shared/model/types'

/* What one question is allowed to be, mirrored from the server's limits so a
   too-long paste fails here with the text still in the box, not there. */
export const QUESTION_LENGTH_LIMIT = 8000

export function askedQuestion(text: string): string | null {
  const value = String(text ?? '').trim()
  if (!value) return null
  return value.slice(0, QUESTION_LENGTH_LIMIT)
}

export const TRANSCRIPT_MESSAGE_LIMIT = 24
export const TRANSCRIPT_CHAR_BUDGET = 24_000

/* The tail of the conversation that travels with a question. The model keeps
   no state between asks, so every request carries its own history — but a
   long afternoon of chat must not grow past the server's body limit, so the
   oldest turns fall off first and the newest always survives. */
export function sendableTranscript(
  messages: AssistantMessage[],
  { limit = TRANSCRIPT_MESSAGE_LIMIT, budget = TRANSCRIPT_CHAR_BUDGET } = {},
): AssistantMessage[] {
  const tail: AssistantMessage[] = []
  let spent = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    spent += message.text.length
    if (tail.length && (tail.length >= limit || spent > budget)) break
    tail.unshift(message)
  }
  return tail
}
