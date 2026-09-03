/* The trip assistant: what the browser may send and what the model is told.

   Everything here is pure. The process that runs the model — the Codex CLI,
   signed in to a personal account — lives in codex.js, and the route in
   app.js is the only place the two meet.

   The prompt deliberately carries no trip data. The agent is connected to
   this server's own MCP endpoint with a read-only token scoped to the asking
   user (agent-token.js), so it queries for what a question actually needs —
   the itinerary for a packing question, the live positions for a where-are-
   they question — instead of every request hauling all of both. */

const ROLES = new Set(['user', 'assistant'])

export const MESSAGE_LIMIT = 40
export const MESSAGE_LENGTH_LIMIT = 8000

/* The conversation as the browser sent it, or null if it is not one: an
   array of user/assistant turns, each a bounded string, ending on the user
   turn the model is being asked to answer. */
export function readAssistantMessages(body) {
  const raw = body?.messages
  if (!Array.isArray(raw) || !raw.length || raw.length > MESSAGE_LIMIT) return null
  const messages = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null
    if (!ROLES.has(value.role) || typeof value.text !== 'string') return null
    const text = value.text.trim()
    if (!text || text.length > MESSAGE_LENGTH_LIMIT) return null
    messages.push({ role: value.role, text })
  }
  if (messages[messages.length - 1].role !== 'user') return null
  return messages
}

/* One prompt per question, self-contained: the model keeps no state between
   requests, so the conversation travels with every ask — but the trip itself
   stays behind the tools. The asker's role decides which prompt they get:
   an editor's agent is told it can edit and how to do so carefully; a
   viewer's agent holds a token that has no write tools, and is told so,
   rather than left to discover it mid-answer. */
export function assistantPrompt({ user, trip, canEdit = false, now = new Date(), messages }) {
  return [
    'You are the travel assistant inside Off We Go, a private family trip',
    'journal. The travellers ask you anything about their trip: plans, places,',
    'distances, what to see, what to skip, where everyone is.',
    '',
    'You are connected to the Off We Go MCP server as this traveller.',
    'Look the trip up rather than guessing:',
    '- get_trip — the itinerary: stops with days, times, notes and coordinates,',
    '  plus members, route, photos and comments. Pass the slug below.',
    '- get_live_positions — where the phones are right now; it takes the trip',
    '  id that get_trip returns.',
    '- list_trips — their other trips, if a question reaches beyond this one.',
    ...(canEdit
      ? [
          'This traveller can edit the trip, so when they ask you to change it, do:',
          '- create_stop / update_stop / delete_stop shape the itinerary, and',
          '  update_trip its title, crew and dates.',
          '- replace_route redraws the hand-drawn route as ordered [lng, lat] pairs.',
          '- update_photo, add_comment and the other tools mirror what the app can do.',
          'Call get_trip first so you work with real ids. Change exactly what was',
          'asked and nothing more; use destructive tools (delete_stop, delete_photo,',
          'replace_route) and invitations only on an explicit, unambiguous request.',
          'End by saying plainly what you changed.',
        ]
      : [
          'Your access is read-only: this traveller follows the trip but cannot',
          'edit it, and neither can you. If they ask for a change, explain that',
          "one of the trip's editors has to make it.",
        ]),
    'Fetch only what the question needs. Beyond these tools you have no',
    'filesystem and no browsing — never pretend otherwise, and say when you',
    'are unsure. Answer from what the tools return plus what you know about',
    'the world. Be concrete and conversational; plain text, no markdown tables.',
    '',
    `Asking: ${user.email || 'a trip member'}. The trip on their screen is` +
      ` "${trip.title}" (slug: ${trip.slug}).`,
    `The current time is ${now.toISOString()}.`,
    '',
    '## The conversation so far',
    ...messages.map(
      message => `${message.role === 'user' ? 'Traveller' : 'Assistant'}: ${message.text}`,
    ),
    '',
    "Reply with the assistant's next message only.",
  ].join('\n')
}
