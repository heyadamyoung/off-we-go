import { useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import { QUICK_EMOJI } from '../../../chat-core'
import type { ChatMessage, Id } from '../../../shared/model/types'

export interface ChatProps {
  messages: ChatMessage[]
  ready: boolean
  meId?: Id
  send: (body: string) => void
  react: (messageId: Id, emoji: string) => void
  remove: (messageId: Id) => void
}

const timeLabel = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/* The family's room. Bubbles read newest-at-the-bottom like every chat ever;
   reactions sit under a bubble as toggling chips; the composer offers a short
   emoji strip and takes anything the keyboard can type. */
export default function ChatPanel({ messages, ready, meId, send, react, remove }: ChatProps) {
  const [text, setText] = useState('')
  const [pickerFor, setPickerFor] = useState<Id | 'composer' | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const submit = () => {
    if (!text.trim()) return
    send(text)
    setText('')
    setPickerFor(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {ready && !messages.length && (
          <p className="hint p-4">Nothing yet. Say where to meet, or just send the 🎉.</p>
        )}
        {messages.map(message => {
          const mine = meId != null && message.userId === meId
          return (
            <div
              key={message.id}
              className={'group flex flex-col ' + (mine ? 'items-end' : 'items-start')}>
              <span className="px-1 text-[11px] text-faint">
                {message.by || 'Someone'} · {timeLabel(message.at)}
              </span>
              <div
                className={
                  'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ' +
                  (mine ? 'rounded-br-md bg-accent text-accent-ink' : 'rounded-bl-md bg-raised2') +
                  (message.pending ? ' opacity-60' : '')
                }>
                {message.body}
              </div>
              <div className="flex flex-wrap items-center gap-1 px-1 pt-1">
                {message.reactions.map(reaction => (
                  <button
                    key={reaction.emoji}
                    className={
                      'rounded-full border px-2 py-0.5 text-[12px] ' +
                      (reaction.mine
                        ? 'border-accent bg-accent-soft'
                        : 'border-line bg-raised hover:border-line2')
                    }
                    aria-label={`React ${reaction.emoji}`}
                    onClick={() => react(message.id, reaction.emoji)}>
                    {reaction.emoji} {reaction.count}
                  </button>
                ))}
                <button
                  className="rounded-full border border-line px-2 py-0.5 text-[12px] text-faint
                             opacity-0 hover:border-line2 group-hover:opacity-100 focus:opacity-100"
                  aria-label="Add a reaction"
                  onClick={() => setPickerFor(pickerFor === message.id ? null : message.id)}>
                  +
                </button>
                {mine && !message.pending && (
                  <button
                    className="px-1 text-[11px] text-faint opacity-0 hover:text-danger
                               group-hover:opacity-100 focus:opacity-100"
                    onClick={() => remove(message.id)}>
                    Delete
                  </button>
                )}
              </div>
              {pickerFor === message.id && (
                <div className="mt-1 flex gap-1 rounded-full border border-line bg-raised px-2 py-1">
                  {QUICK_EMOJI.map(emoji => (
                    <button
                      key={emoji}
                      className="rounded-full px-1 text-[16px] hover:bg-raised2"
                      aria-label={`React ${emoji}`}
                      onClick={() => {
                        react(message.id, emoji)
                        setPickerFor(null)
                      }}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      <div className="flex-none border-t border-line p-3">
        {pickerFor === 'composer' && (
          <div className="mb-2 flex gap-1">
            {QUICK_EMOJI.map(emoji => (
              <button
                key={emoji}
                className="rounded-full px-1.5 text-[18px] hover:bg-raised2"
                aria-label={`Insert ${emoji}`}
                onClick={() => setText(current => current + emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            className="grid size-9 flex-none place-items-center rounded-xl border border-line
                       text-[16px] hover:bg-raised2"
            aria-label="Emoji"
            onClick={() => setPickerFor(pickerFor === 'composer' ? null : 'composer')}>
            🙂
          </button>
          <textarea
            value={text}
            rows={1}
            placeholder="Message the trip"
            className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-canvas px-3
                       py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <button
            className="grid size-9 flex-none place-items-center rounded-xl bg-accent
                       text-accent-ink disabled:opacity-50"
            disabled={!text.trim()}
            onClick={submit}
            aria-label="Send">
            <Icon n="send" s={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
