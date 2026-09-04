import type { ChatMessage, Id } from './shared/model/types'

/* The chat's pure parts: the picker's emoji and the optimistic reaction
   toggle, tested without a server. The palette is deliberately short — a
   family reacts with a feeling, not a search box — and the composer takes
   any emoji the keyboard offers regardless. */

export const QUICK_EMOJI = ['❤️', '😂', '👍', '😮', '😢', '🎉', '🔥', '🙏'] as const

/** What the list should look like the instant a reaction is tapped, before
    the server answers — the same math the server will do. */
export function toggleReaction(
  messages: ChatMessage[],
  messageId: Id,
  emoji: string,
): ChatMessage[] {
  return messages.map(message => {
    if (message.id !== messageId) return message
    const existing = message.reactions.find(reaction => reaction.emoji === emoji)
    const reactions = existing
      ? message.reactions
          .map(reaction =>
            reaction.emoji === emoji
              ? { emoji, count: reaction.count + (reaction.mine ? -1 : 1), mine: !reaction.mine }
              : reaction,
          )
          .filter(reaction => reaction.count > 0)
      : [...message.reactions, { emoji, count: 1, mine: true }]
    return { ...message, reactions }
  })
}

/** Whether the tap means adding or removing — decided from the same state the toggle uses. */
export function reactionTurnsOn(messages: ChatMessage[], messageId: Id, emoji: string): boolean {
  const mine = messages
    .find(message => message.id === messageId)
    ?.reactions.find(reaction => reaction.emoji === emoji)?.mine
  return !mine
}
