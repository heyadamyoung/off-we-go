import { useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import type { AssistantMessage } from '../../../shared/model/types'

interface AssistantChatProps {
  messages: AssistantMessage[]
  busy: boolean
  error: string | null
  /** editors' questions can also change the trip; viewers' never do */
  canEdit: boolean
  onAsk: (text: string) => void
  onClose: () => void
}

/* The chat with the trip's AI, over the map's right edge where its button
   lives. A sheet like the detail card rather than a full screen: the map is
   what most questions are about, and it stays visible beside the answer. */
export default function AssistantChat({
  messages,
  busy,
  error,
  canEdit,
  onAsk,
  onClose,
}: AssistantChatProps) {
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    box.current?.focus()
  }, [])
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages, busy, error])

  const send = () => {
    if (busy || !text.trim()) return
    onAsk(text)
    setText('')
  }

  return (
    <div
      className="sheet rise absolute bottom-[var(--trip-2)] right-4 z-[7] flex w-[380px] flex-col
                    overflow-hidden rounded-[18px]
                    max-h-[calc(100%_-_var(--trip-top)_-_var(--trip-2)_-_12px)]
                    max-sm:inset-x-3 max-sm:bottom-[var(--trip-1)] max-sm:w-auto
                    max-sm:max-h-[calc(100%_-_var(--trip-top)_-_var(--trip-1)_-_12px)]">
      <div className="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3">
        <Icon n="spark" s={16} className="text-accent" />
        <b className="flex-1 text-[13px] font-extrabold">Ask about this trip</b>
        <button
          className="grid size-[30px] place-items-center rounded-lg text-muted hover:bg-raised2
                           hover:text-ink"
          onClick={onClose}
          aria-label="Close">
          <Icon n="x" s={14} />
        </button>
      </div>

      <div
        ref={scroller}
        className="flex min-h-[120px] flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
        {messages.length === 0 && (
          <p className="m-0 text-[13px] leading-relaxed text-muted">
            {canEdit
              ? 'Whatever you want to know — the plan, the places, where everyone is. ' +
                'You can also ask for changes: "add a stop at the ferry dock on day 3". ' +
                'Answers take a little while: it thinks hard first.'
              : 'Whatever you want to know — the plan, the places, where everyone is. ' +
                'Answers take a little while: it thinks hard first.'}
          </p>
        )}
        {messages.map((message, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: chat turns are append-only and carry no ids; index is their identity
            key={index}
            className={
              'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ' +
              (message.role === 'user'
                ? 'self-end rounded-br-md bg-accent text-accent-ink'
                : 'self-start rounded-bl-md bg-raised2 text-ink')
            }>
            {message.text}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 self-start px-1 text-[13px] text-muted">
            <Icon n="spark" s={13} className="animate-pulse text-accent" />
            Thinking…
          </div>
        )}
        {error && !busy && <div className="self-start px-1 text-[12.5px] text-muted">{error}</div>}
      </div>

      <div className="flex flex-none items-end gap-2 border-t border-line p-3">
        <textarea
          ref={box}
          value={text}
          rows={2}
          placeholder="Ask anything about the trip"
          className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2
                     text-[13px] leading-relaxed outline-none focus:border-accent"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button
          className="grid size-9 flex-none place-items-center rounded-xl bg-accent
                           text-accent-ink disabled:opacity-50"
          disabled={busy || !text.trim()}
          onClick={send}
          aria-label="Send">
          <Icon n="send" s={15} />
        </button>
      </div>
    </div>
  )
}
