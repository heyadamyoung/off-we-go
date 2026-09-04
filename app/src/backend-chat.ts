import { authClient, isSample, tripPath } from './backend-base'
import { trackError } from './shared/lib/telemetry'
import type { ChatMessage, Id } from './shared/model/types'

/* The trip's chat over the wire — and a self-contained copy for the sample
   trip, seeded with a real-feeling exchange so the public demo shows what
   the room is for. Sample state lives for the tab, like the rest of it. */

let sampleChat: ChatMessage[] | null = null
const sampleMessages = (): ChatMessage[] => {
  sampleChat ||= [
    {
      id: 'cm1',
      by: 'Maya',
      body: 'Rijksmuseum first tomorrow? Lines get wild after 10 🎨',
      at: new Date(Date.now() - 5_400_000).toISOString(),
      reactions: [{ emoji: '👍', count: 2, mine: false }],
    },
    {
      id: 'cm2',
      by: 'You',
      body: 'Deal — pancakes after 🥞',
      at: new Date(Date.now() - 4_900_000).toISOString(),
      reactions: [{ emoji: '❤️', count: 1, mine: false }],
    },
  ]
  return sampleChat
}
const sampleUid = () => 'cm' + Math.random().toString(36).slice(2, 10)

export async function loadMessages(tripId: Id): Promise<ChatMessage[]> {
  if (isSample(tripId)) return sampleMessages().map(message => ({ ...message }))
  try {
    const result = await authClient.request<{ messages: ChatMessage[] }>(
      `${tripPath(tripId)}/messages`,
    )
    return result.messages
  } catch (caught) {
    trackError('load chat', caught)
    throw caught
  }
}

export async function sendMessage(tripId: Id, body: string): Promise<ChatMessage> {
  if (isSample(tripId)) {
    const message = {
      id: sampleUid(),
      by: 'You',
      body,
      at: new Date().toISOString(),
      reactions: [],
    }
    sampleMessages().push(message)
    return { ...message }
  }
  return authClient.request(`${tripPath(tripId)}/messages`, { method: 'POST', body: { body } })
}

export async function deleteMessage(tripId: Id, messageId: Id): Promise<void> {
  if (isSample(tripId)) {
    sampleChat = sampleMessages().filter(message => message.id !== messageId)
    return
  }
  await authClient.request(`${tripPath(tripId)}/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  })
}

export async function setMessageReaction(
  tripId: Id,
  messageId: Id,
  emoji: string,
  on: boolean,
): Promise<void> {
  if (isSample(tripId)) {
    const message = sampleMessages().find(value => value.id === messageId)
    if (!message) return
    const existing = message.reactions.find(reaction => reaction.emoji === emoji)
    if (on && !existing) message.reactions.push({ emoji, count: 1, mine: true })
    else if (on && existing && !existing.mine) {
      existing.count++
      existing.mine = true
    } else if (!on && existing?.mine) {
      existing.count--
      existing.mine = false
      if (existing.count <= 0)
        message.reactions = message.reactions.filter(reaction => reaction !== existing)
    }
    return
  }
  await authClient.request(
    `${tripPath(tripId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    { method: on ? 'PUT' : 'DELETE', body: { emoji } },
  )
}
