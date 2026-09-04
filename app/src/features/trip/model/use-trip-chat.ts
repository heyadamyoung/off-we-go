import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteMessage,
  loadMessages,
  sendMessage,
  setMessageReaction,
  subscribeToTrip,
} from '../../../backend'
import { reactionTurnsOn, toggleReaction } from '../../../chat-core'
import { trackError } from '../../../shared/lib/telemetry'
import { appErrorMessage } from '../../../user-messages-core'
import type { ChatMessage, Id, Toast } from '../../../shared/model/types'

/* The trip's chat, live: loaded once, then refreshed whenever the stream
   announces 'chat' — its own slice, never the whole trip. Sending and
   reacting are optimistic; the announce that follows squares everyone,
   including us. */
export default function useTripChat({ tripId, toast }: { tripId: Id; toast: Toast }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [ready, setReady] = useState(false)
  const alive = useRef(true)

  const refresh = useCallback(() => {
    loadMessages(tripId)
      .then(list => {
        if (alive.current) {
          setMessages(list)
          setReady(true)
        }
      })
      .catch(() => {
        if (alive.current) setReady(true) // trackError already fired in the loader
      })
  }, [tripId])

  useEffect(() => {
    alive.current = true
    refresh()
    const stop = subscribeToTrip(tripId, kind => {
      if (kind === 'chat') refresh()
    })
    return () => {
      alive.current = false
      stop()
    }
  }, [tripId, refresh])

  const send = useCallback(
    async (body: string) => {
      const text = body.trim().slice(0, 2000)
      if (!text) return
      const ghost: ChatMessage = {
        id: 'pending-' + Date.now(),
        by: 'You',
        body: text,
        at: new Date().toISOString(),
        reactions: [],
        pending: true,
      }
      setMessages(current => [...current, ghost])
      try {
        const saved = await sendMessage(tripId, text)
        setMessages(current => current.map(message => (message.id === ghost.id ? saved : message)))
      } catch (caught) {
        setMessages(current => current.filter(message => message.id !== ghost.id))
        trackError('send chat message', caught)
        toast(appErrorMessage(caught, 'post-comment'), 'error')
      }
    },
    [tripId, toast],
  )

  const react = useCallback(
    (messageId: Id, emoji: string) => {
      const on = reactionTurnsOn(messages, messageId, emoji)
      setMessages(current => toggleReaction(current, messageId, emoji))
      setMessageReaction(tripId, messageId, emoji, on).catch(caught => {
        setMessages(current => toggleReaction(current, messageId, emoji)) // undo
        trackError('react to message', caught)
      })
    },
    [tripId, messages],
  )

  const remove = useCallback(
    async (messageId: Id) => {
      const kept = messages
      setMessages(current => current.filter(message => message.id !== messageId))
      try {
        await deleteMessage(tripId, messageId)
      } catch (caught) {
        setMessages(kept)
        trackError('delete chat message', caught)
        toast(appErrorMessage(caught, 'delete-comment'), 'error')
      }
    },
    [tripId, messages, toast],
  )

  return { messages, ready, send, react, remove }
}
