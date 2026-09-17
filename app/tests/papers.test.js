import assert from 'node:assert/strict'
import test from 'node:test'
import { papersOnTrip } from '../src/papers-core.ts'

/* Everything you are carrying, in one list, with the next thing at the top.
 *
 * Until now a document was reachable only through the stop or the leg it hangs
 * off: to find the boarding pass you had to remember you filed it on that
 * flight, go to Travel, find the flight, open its papers, then the file. Five
 * taps and a memory test — and if you have to remember where you put it, your
 * email is just as fast, which is why nobody used it.
 *
 * So the order is the feature. At a desk with a queue behind you, the paper you
 * want is almost always for the thing that is about to happen.
 */

const NOW = Date.parse('2026-09-19T12:00:00Z')

const doc = (id, name, rest = {}) => ({
  id,
  name,
  kind: 'ticket',
  mime: 'application/pdf',
  src: `/api/media/${id}.pdf`,
  ...rest,
})

const stop = (id, name, rest = {}) => ({ id, name, lng: 4.9, lat: 52.4, ...rest })

const leg = (id, rest = {}) => ({
  id,
  mode: 'flight',
  carrier: 'KLM',
  number: 'KL 677',
  fromName: 'Amsterdam',
  toName: 'Calgary',
  departsAt: '2026-09-19T16:10:00.000Z',
  ...rest,
})

test('a trip with no paperwork is an empty list rather than a throw', () => {
  assert.deepEqual(papersOnTrip({}, NOW), [])
  assert.deepEqual(papersOnTrip({ stops: [], segments: [] }, NOW), [])
  assert.deepEqual(papersOnTrip({ stops: [stop('s1', 'Museum')] }, NOW), [])
})

test('papers come from both homes, because a traveller does not care which', () => {
  const found = papersOnTrip(
    {
      stops: [
        stop('s1', 'Anne Frank House', {
          day: '2026-09-19',
          startsAt: '15:45',
          documents: [doc('d1', 'Timed entry')],
        }),
      ],
      segments: [leg('g1', { documents: [doc('d2', 'Boarding pass')] })],
    },
    NOW,
  )
  /* And in the order they happen: the 15:45 slot really is before the 16:10
     flight, whichever list each came out of. */
  assert.deepEqual(
    found.map(p => p.name),
    ['Timed entry', 'Boarding pass'],
  )
})

test('each paper says what it is for, so the list reads without opening anything', () => {
  const found = papersOnTrip(
    { segments: [leg('g1', { documents: [doc('d1', 'Boarding pass')] })] },
    NOW,
  )
  assert.equal(found[0].for, 'KL 677 · Amsterdam → Calgary')
  assert.equal(found[0].segmentId, 'g1')
})

test('a stop’s paper is named for the stop', () => {
  const found = papersOnTrip(
    {
      stops: [
        stop('s1', 'Hotel Jakarta', { day: '2026-09-19', documents: [doc('d1', 'Booking')] }),
      ],
    },
    NOW,
  )
  assert.equal(found[0].for, 'Hotel Jakarta')
  assert.equal(found[0].stopId, 's1')
})

test('the next thing leads, because that is the paper somebody is reaching for', () => {
  const found = papersOnTrip(
    {
      stops: [
        stop('s1', 'Tonight', {
          day: '2026-09-19',
          startsAt: '20:00',
          documents: [doc('d2', 'Dinner')],
        }),
      ],
      segments: [leg('g1', { documents: [doc('d1', 'Boarding pass')] })],
    },
    NOW,
  )
  assert.deepEqual(
    found.map(p => p.name),
    ['Boarding pass', 'Dinner'],
  )
})

test('what has already happened sinks, most recent first', () => {
  /* Yesterday's boarding pass is not what you want at today's desk, but it is
     the one you might want to show somebody, so it beats last week's. */
  const found = papersOnTrip(
    {
      segments: [
        leg('g1', {
          departsAt: '2026-09-17T08:00:00.000Z',
          number: 'KL 1',
          documents: [doc('d1', 'Old')],
        }),
        leg('g2', {
          departsAt: '2026-09-18T08:00:00.000Z',
          number: 'KL 2',
          documents: [doc('d2', 'Newer')],
        }),
        leg('g3', {
          departsAt: '2026-09-19T16:10:00.000Z',
          number: 'KL 3',
          documents: [doc('d3', 'Next')],
        }),
      ],
    },
    NOW,
  )
  assert.deepEqual(
    found.map(p => p.name),
    ['Next', 'Newer', 'Old'],
  )
})

test('a paper for nothing in particular sits between the future and the past', () => {
  /* Insurance, a passport scan: always relevant, never due. Above what is
     finished, below what is about to happen. */
  const found = papersOnTrip(
    {
      stops: [
        stop('s1', 'Anywhere', { documents: [doc('d2', 'Insurance')] }),
        stop('s2', 'Done', {
          day: '2026-09-17',
          startsAt: '09:00',
          documents: [doc('d3', 'Yesterday')],
        }),
      ],
      segments: [leg('g1', { documents: [doc('d1', 'Boarding pass')] })],
    },
    NOW,
  )
  assert.deepEqual(
    found.map(p => p.name),
    ['Boarding pass', 'Insurance', 'Yesterday'],
  )
})

test('several papers on one thing keep the order they were filed in', () => {
  const found = papersOnTrip(
    {
      segments: [
        leg('g1', { documents: [doc('d1', 'Maya'), doc('d2', 'Alex'), doc('d3', 'Kid')] }),
      ],
    },
    NOW,
  )
  assert.deepEqual(
    found.map(p => p.name),
    ['Maya', 'Alex', 'Kid'],
  )
})

test('a document with nowhere to fetch it from is not a paper', () => {
  const found = papersOnTrip(
    { segments: [leg('g1', { documents: [{ ...doc('d1', 'Ghost'), src: '' }] })] },
    NOW,
  )
  assert.deepEqual(found, [])
})

/* What a paper gets drawn AS is not this module's question — a picture, a
   rendered PDF or an honest handover is paper-kind-core's rule, and it is
   tested there. This one only says what a trip is carrying and in what order. */
