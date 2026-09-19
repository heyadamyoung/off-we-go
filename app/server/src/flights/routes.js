/* The boards, and what they said about a leg, over HTTP.
 *
 * Five routes. The airports the app has a board for, with each source's
 * health; a whole board, normalized, for a screen that wants to show one; a
 * single flight looked up on a board, for the assistant and for a leg being
 * typed in; the snapshot and event trail behind a leg on a trip, which is
 * where "the airport says" on the card comes from; and where the aircraft
 * is, for the map, while the leg is in the air. All behind a login, like
 * every other /api route, and the trip ones behind membership. */

import {
  FLYING_AFTER_MS,
  FLYING_BEFORE_MS,
  flightNumberOf,
  inFlyingWindow,
  matchFlight,
  normalizeFlightNumber,
} from './model.js'
import { callsignFor } from './providers/adsb.js'

const BOARDS = { departures: 'departure', arrivals: 'arrival' }
const DAY = /^\d{4}-\d\d-\d\d$/

/* The window is the model's (the watch keeps the same one); the names stay
   for whoever imports them here. */
export const POSITION_BEFORE_MS = FLYING_BEFORE_MS
export const POSITION_AFTER_MS = FLYING_AFTER_MS

export function registerFlightRoutes(app, { repository, sources, authenticated }) {
  app.get('/api/flights/airports', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const health = sources.health()
    return {
      airports: sources.airports().map(airport => ({
        ...airport,
        health: health[airport.source] || null,
      })),
    }
  })

  app.get('/api/flights/:airport/:board', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const direction = BOARDS[request.params.board]
    if (!direction) return reply.code(404).send({ error: 'A board is departures or arrivals' })
    const date = request.query?.date
    if (date !== undefined && !DAY.test(String(date))) {
      return reply.code(400).send({ error: 'date is YYYY-MM-DD' })
    }
    const board = await sources.board(request.params.airport, direction, date || null)
    if (!board) return reply.code(404).send({ error: 'No board is read for that airport' })
    if (!board.value) {
      return reply
        .code(503)
        .send({ error: `The board could not be read: ${board.error?.message || 'unknown'}` })
    }
    return {
      airport: String(request.params.airport).toUpperCase(),
      board: request.params.board,
      fetchedAt: board.fetchedAt ? new Date(board.fetchedAt).toISOString() : null,
      stale: board.stale,
      flights: board.value,
    }
  })

  /* One flight on one airport's boards: the departures board when it
     leaves from there, the arrivals board when it lands there, the caller
     saying which or both being tried. */
  app.get('/api/flights/status', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const flight = normalizeFlightNumber(request.query?.flight)
    if (!flight) return reply.code(400).send({ error: 'flight is a number like AC872' })
    const airport = String(request.query?.airport || '').toUpperCase()
    if (!sources.providerFor(airport)) {
      return reply.code(404).send({ error: 'No board is read for that airport' })
    }
    const date = request.query?.date
    if (date !== undefined && !DAY.test(String(date))) {
      return reply.code(400).send({ error: 'date is YYYY-MM-DD' })
    }
    const around = date ? `${date}T12:00:00.000Z` : new Date().toISOString()
    const wanted = request.query?.direction
    const directions = wanted ? [wanted] : ['departure', 'arrival']
    for (const direction of directions) {
      if (!['departure', 'arrival'].includes(direction)) {
        return reply.code(400).send({ error: 'direction is departure or arrival' })
      }
      const board = await sources.board(airport, direction, date || null)
      const found = matchFlight(board?.value, flight, around)
      if (found)
        return {
          flight: found,
          fetchedAt: new Date(board.fetchedAt).toISOString(),
          stale: board.stale,
        }
    }
    return reply.code(404).send({ error: `${flight} is not on the ${airport} board` })
  })

  app.get('/api/trips/:tripId/segments/:segmentId/flight', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const found = await repository.flightForSegment(
      user,
      request.params.tripId,
      request.params.segmentId,
    )
    if (!found) return reply.code(404).send({ error: 'That segment was not found' })
    return found
  })

  app.get('/api/trips/:tripId/segments/:segmentId/position', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const segments = await repository.listSegments(user, request.params.tripId)
    const leg = (segments || []).find(one => one.id === request.params.segmentId)
    if (!leg) return reply.code(404).send({ error: 'That segment was not found' })
    const callsign = callsignFor(flightNumberOf(leg))
    if (!callsign) return { callsign: null, aircraft: null, reason: 'no-callsign' }
    const now = typeof sources.now === 'function' ? sources.now() : Date.now()
    const heard = await sources.position(callsign)
    /* Outside the flying window whatever answers to the callsign is an
       earlier rotation of the number — not this leg's aircraft, but the type
       it will almost surely be, which is what the seat map wants. */
    if (!inFlyingWindow(leg, now)) {
      return { callsign, aircraft: null, usual: heard.value?.type || null, reason: 'not-flying' }
    }
    return {
      callsign,
      aircraft: heard.value || null,
      fetchedAt: heard.fetchedAt ? new Date(heard.fetchedAt).toISOString() : null,
      stale: heard.stale,
      reason: heard.value ? null : heard.error ? 'unavailable' : 'not-heard',
    }
  })
}
