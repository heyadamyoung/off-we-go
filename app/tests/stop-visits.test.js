import assert from 'node:assert/strict'
import test from 'node:test'
import { AWAY_MS, visitOf } from '../server/src/stop-visits.js'

/* When somebody actually got there, and when they actually left.
 *
 * The itinerary says a quarter to ten. The phone knows it was twenty past. The
 * app has held both facts for as long as it has had a map on it and has never
 * once put them in the same sentence: the live layer works out an arrival every
 * few seconds, uses it to decide which pin is lit, and throws the time away.
 *
 * This keeps it. Two rules do all the work and both are about honesty rather
 * than cleverness. An arrival is the first fix that could be at the place —
 * could, not must, because a phone is least certain indoors and indoors is
 * where people are. A departure is only ever reported when a later fix proves
 * they went somewhere else; a phone that goes quiet has not left anywhere.
 */

const MUSEUM = { id: 's1', lng: 4.8852, lat: 52.36, day: '2026-09-16' }

/* Metres, roughly, as an offset in latitude — good enough at this scale and it
   keeps the fixtures readable as distances rather than as coordinates. */
const away = (metres, at, rest = {}) => ({
  lng: MUSEUM.lng,
  lat: MUSEUM.lat + metres / 111_320,
  at: new Date(at),
  ...rest,
})

const at = (clock, rest = {}) => away(0, `2026-09-16T${clock}:00Z`, rest)

test('the first fix that could be at the place is the arrival', () => {
  const visit = visitOf(MUSEUM, [away(4000, '2026-09-16T09:50:00Z'), at('10:20'), at('10:35')])
  assert.equal(visit?.arrivedAt?.toISOString(), '2026-09-16T10:20:00.000Z')
})

test('a fix going too fast to be stopping is passing, not arriving', () => {
  /* A tram through the square is not an afternoon at the museum. */
  const visit = visitOf(MUSEUM, [at('10:00', { speed: 18 }), at('10:20', { speed: 0.4 })])
  assert.equal(visit?.arrivedAt?.toISOString(), '2026-09-16T10:20:00.000Z')
})

test('a vague fix that could be inside counts as being inside', () => {
  /* Indoors, among tall buildings, is where a phone is least sure and where
     somebody is most likely to be at the thing. Asking a fix to PROVE where it
     is asks the impossible of exactly the fixes that matter. */
  const visit = visitOf(MUSEUM, [away(900, '2026-09-16T10:20:00Z', { accuracy: 600 })])
  assert.equal(visit?.arrivedAt?.toISOString(), '2026-09-16T10:20:00.000Z')
})

test('walking past on an earlier day is not the visit', () => {
  const visit = visitOf(MUSEUM, [away(0, '2026-09-14T11:00:00Z'), away(0, '2026-09-16T10:20:00Z')])
  assert.equal(visit?.arrivedAt?.toISOString(), '2026-09-16T10:20:00.000Z')
})

test('the departure is the last fix there, once a later one proves they left', () => {
  const visit = visitOf(MUSEUM, [
    at('10:20'),
    at('11:00'),
    at('11:40'),
    away(3000, '2026-09-16T12:10:00Z'),
  ])
  assert.equal(visit?.leftAt?.toISOString(), '2026-09-16T11:40:00.000Z')
})

test('a phone that goes quiet has not left anywhere', () => {
  /* The one thing this must never do is invent a departure. Somebody inside a
     building with no signal is still inside the building. */
  const visit = visitOf(MUSEUM, [at('10:20'), at('11:40')])
  assert.equal(visit?.arrivedAt?.toISOString(), '2026-09-16T10:20:00.000Z')
  assert.equal(visit?.leftAt, null)
})

test('a stray fix in the middle does not end the visit', () => {
  /* GPS wanders. One reading across the canal between two readings in the
     hall is a reading, not an exit. */
  const visit = visitOf(MUSEUM, [
    at('10:20'),
    away(3000, '2026-09-16T10:50:00Z'),
    at('11:00'),
    at('11:40'),
    away(4000, '2026-09-16T12:30:00Z'),
  ])
  assert.equal(visit?.leftAt?.toISOString(), '2026-09-16T11:40:00.000Z')
})

test('coming back in the evening is a different visit, not a six-hour one', () => {
  const visit = visitOf(MUSEUM, [
    at('10:20'),
    at('11:40'),
    away(5000, '2026-09-16T13:00:00Z'),
    at('19:00'),
    away(5000, '2026-09-16T20:00:00Z'),
  ])
  assert.equal(visit?.leftAt?.toISOString(), '2026-09-16T11:40:00.000Z')
})

test('a gap is measured between the fixes there, not from the arrival', () => {
  /* An afternoon of steady fixes is one visit however long it runs. */
  const steady = []
  for (let minute = 0; minute <= 300; minute += 20)
    steady.push(away(0, Date.UTC(2026, 8, 16, 10, minute)))
  steady.push(away(5000, Date.UTC(2026, 8, 16, 16, 0)))
  const visit = visitOf(MUSEUM, steady)
  assert.equal(visit?.leftAt?.toISOString(), '2026-09-16T15:00:00.000Z')
  assert.ok(
    AWAY_MS < 5 * 60 * 60 * 1000,
    'the gap that ends a visit must be shorter than a day out',
  )
})

test('nothing near enough is no visit at all, rather than a guess', () => {
  assert.equal(visitOf(MUSEUM, [away(9000, '2026-09-16T10:20:00Z')]), null)
})

test('a stop with nowhere to be, or a trip with no fixes, is null rather than a throw', () => {
  assert.equal(visitOf({ id: 's1', lng: null, lat: null }, [at('10:20')]), null)
  assert.equal(visitOf(MUSEUM, []), null)
  assert.equal(visitOf(MUSEUM, null), null)
  assert.equal(visitOf(null, [at('10:20')]), null)
})

test('fixes arriving out of order are read in time order all the same', () => {
  /* A phone offline for an hour flushes its queue in whatever order it likes,
     and the earliest arrival is the arrival however it reached the table. */
  const visit = visitOf(MUSEUM, [at('11:40'), at('10:20'), away(6000, '2026-09-16T12:10:00Z')])
  assert.equal(visit?.arrivedAt?.toISOString(), '2026-09-16T10:20:00.000Z')
  assert.equal(visit?.leftAt?.toISOString(), '2026-09-16T11:40:00.000Z')
})

test('a stop with no day of its own takes the first arrival it can find', () => {
  const undated = { id: 's2', lng: MUSEUM.lng, lat: MUSEUM.lat }
  const visit = visitOf(undated, [away(0, '2026-09-14T11:00:00Z')])
  assert.equal(visit?.arrivedAt?.toISOString(), '2026-09-14T11:00:00.000Z')
})

test('a visit remembers whose clock it happened on', () => {
  /* The plan is a wall clock — "09:45", the way the ticket prints it — and an
     arrival is an absolute instant. Putting the two in one sentence needs the
     timezone of the place, and the only thing that was definitely there is the
     phone that recorded the fix. So the visit carries the zone its arrival was
     recorded in, and a grandmother in Sydney reading "arrived 10:20" is read
     the Amsterdam morning rather than her own. */
  const visit = visitOf(MUSEUM, [
    away(0, '2026-09-16T08:20:00Z', { zone: 'Europe/Amsterdam' }),
    away(0, '2026-09-16T09:40:00Z', { zone: 'Europe/Amsterdam' }),
  ])
  assert.equal(visit?.zone, 'Europe/Amsterdam')
})

test('a phone that never said where it was leaves the zone unknown, not guessed', () => {
  assert.equal(visitOf(MUSEUM, [at('10:20')])?.zone, null)
})
