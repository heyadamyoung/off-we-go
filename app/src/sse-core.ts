/* Reading Server-Sent Events off a byte stream.

   Not EventSource: that API cannot send an Authorization header, and the whole
   API is behind a bearer token. A streaming fetch can, so the frames are
   parsed here instead — which also makes the parsing something that can be
   tested without a server. */

export interface SseFrame {
  id?: string
  event?: string
  data: string
}

/* A frame ends at a blank line, so a chunk may hold several frames and half of
   another. Returns what is complete and what is left over. */
export function readFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = normalised.split('\n\n')
  const rest = parts.pop() ?? ''
  const frames: SseFrame[] = []

  for (const part of parts) {
    const frame: SseFrame = { data: '' }
    const data: string[] = []
    for (const line of part.split('\n')) {
      // A line starting with a colon is a comment — the heartbeat is one.
      if (!line || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'data') data.push(value)
      else if (field === 'id') frame.id = value
      else if (field === 'event') frame.event = value
    }
    if (!data.length) continue          // a frame of only comments is not an event
    frame.data = data.join('\n')
    frames.push(frame)
  }

  return { frames, rest }
}

/** The payload of a frame, or null when it is not the JSON we expected. */
export function frameJson<T>(frame: SseFrame): T | null {
  try {
    const value = JSON.parse(frame.data)
    return value && typeof value === 'object' ? value as T : null
  } catch {
    return null
  }
}
