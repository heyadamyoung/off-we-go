import assert from 'node:assert/strict'
import test from 'node:test'
import { orderingMinutes, scheduleOrder } from '../src/stop-order-core.ts'

/* The order an itinerary reads in.

   It used to be decided by a sequence number: invisible, trip-wide, and
   defaulted to zero by two of the three ways a stop could be created — which
   is the front of the entire trip. So a castle visited at half past three sat
   ahead of two places from that morning, because it had been added later. That
   was reported with a photograph of the strip.

   The clock decides now, and the sequence settles what the clock cannot. */

test('a stop with no hour sits where the itinerary put it, not at the end of the day', () => {
  /* The obvious rule — timed stops in time order, untimed ones after them —
     is wrong on the commonest day there is. Breakfast, the museum at half nine,
     lunch, the castle at half three: two of those name an hour and two never
     will, and sending the two that do not to the end of the day reads as
     Museum, Castle, Breakfast, Lunch. Nobody's morning.

     So an hour is carried forward across the stops that name none. A stop with
     no time happens after whatever it was placed after, which is what its
     place in the itinerary was already saying. Nothing before the first timed
     stop of the day carries anything, so it stays at the front where it was
     put. */
  const day = '2026-09-13'
  const order = orderingMinutes([
    { id: 'breakfast', day, seq: 0 },
    { id: 'museum', day, startsAt: '09:30', endsAt: '12:30', seq: 1 },
    { id: 'lunch', day, seq: 2 },
    { id: 'castle', day, startsAt: '15:30', seq: 3 },
  ])

  assert.equal(order.get('breakfast'), null, 'before any hour the day has named')
  assert.equal(order.get('museum'), 570)
  assert.equal(order.get('lunch'), 570, 'carried from the stop it follows')
  assert.equal(order.get('castle'), 930)
})

test('the carry is per day, and follows the order somebody arranged', () => {
  /* Read in sequence order, not in the order the rows arrive: the walk is
     what carries the hour, so a list handed over shuffled must still carry it
     the way the itinerary reads. And it stops at midnight — yesterday's last
     hour says nothing about this morning. */
  const order = orderingMinutes([
    { id: 'afterDinner', day: '2026-09-13', seq: 3 },
    { id: 'dinner', day: '2026-09-13', startsAt: '19:00', seq: 2 },
    { id: 'firstThing', day: '2026-09-14', seq: 0 },
    { id: 'brunch', day: '2026-09-14', startsAt: '11:00', seq: 1 },
  ])

  assert.equal(order.get('dinner'), 1140)
  assert.equal(order.get('afterDinner'), 1140, 'carried across the shuffle')
  assert.equal(order.get('firstThing'), null, 'a new day carries nothing over')
  assert.equal(order.get('brunch'), 660)
})

test('a stop with no day is nobody’s hour', () => {
  /* Undated stops are their own pile everywhere else, and one must not pick up
     an hour from a day it is not on. */
  const order = orderingMinutes([
    { id: 'dated', day: '2026-09-13', startsAt: '09:00', seq: 0 },
    { id: 'someday', seq: 1 },
    { id: 'alsoSomeday', seq: 2 },
  ])

  assert.equal(order.get('dated'), 540)
  assert.equal(order.get('someday'), null)
  assert.equal(order.get('alsoSomeday'), null)
})

test('the end of a window is not what the next thing is ordered by', () => {
  /* A stop running 09:30 to 12:30 is carried forward as half past nine, not
     half past twelve: what follows it follows the thing, and the thing began
     at half past nine. Ordering by the end would put a long morning after a
     short one that started later. */
  const day = '2026-09-13'
  const order = orderingMinutes([
    { id: 'long', day, startsAt: '09:30', endsAt: '17:00', seq: 0 },
    { id: 'short', day, startsAt: '10:00', endsAt: '10:15', seq: 1 },
  ])

  assert.equal(order.get('long'), 570)
  assert.equal(order.get('short'), 600)
})

test('the whole trip comes out in the order it happens', () => {
  /* The shared entry point, which the strip and the rule deciding what comes
     next both read — one module, because two answers to "what is after this"
     is how the app came to say UP NEXT about a place already behind
     somebody. */
  const ordered = scheduleOrder([
    { id: 'someday', name: 'Someday', seq: 0 },
    { id: 'urquhart', day: '2026-09-13', startsAt: '15:30', seq: 0 },
    { id: 'lunch', day: '2026-09-14', seq: 2 },
    { id: 'eilean', day: '2026-09-13', startsAt: '09:45', seq: 4 },
    { id: 'museum', day: '2026-09-14', startsAt: '09:30', seq: 1 },
    { id: 'breakfast', day: '2026-09-14', seq: 0 },
    { id: 'clachan', day: '2026-09-13', startsAt: '11:20', endsAt: '11:50', seq: 5 },
  ])

  assert.deepEqual(
    ordered.map(stop => stop.id),
    ['eilean', 'clachan', 'urquhart', 'breakfast', 'museum', 'lunch', 'someday'],
  )
})

test('an undated stop is not a point in the trip, so it holds no place in it', () => {
  const ordered = scheduleOrder([
    { id: 'nowhere', seq: 0 },
    { id: 'friday', day: '2026-09-11', seq: 9 },
  ])

  assert.deepEqual(
    ordered.map(stop => stop.id),
    ['friday', 'nowhere'],
  )
})

test('the list handed in is left alone', () => {
  /* Sorted into a new array: the caller's list is state somewhere, and
     reordering it underneath them is how a render loop starts. */
  const stops = [
    { id: 'late', day: '2026-09-13', startsAt: '18:00', seq: 0 },
    { id: 'early', day: '2026-09-13', startsAt: '08:00', seq: 1 },
  ]
  const ordered = scheduleOrder(stops)
  assert.deepEqual(
    stops.map(stop => stop.id),
    ['late', 'early'],
  )
  assert.deepEqual(
    ordered.map(stop => stop.id),
    ['early', 'late'],
  )
})

test('nothing at all is answered, not thrown at', () => {
  assert.deepEqual(scheduleOrder([]), [])
  assert.deepEqual(orderingMinutes([]), new Map())
  assert.deepEqual(orderingMinutes(null), new Map())
})
