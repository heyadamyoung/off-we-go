import assert from 'node:assert/strict'
import test from 'node:test'
import { worthWaking } from '../src/follower-notify.ts'

/* Which buzz comes first.
 *
 * Somebody coming back after an afternoon away gets a handful of
 * notifications, not one for every hour they missed — so the order decides
 * what they actually read. The rest of that file is a plugin call that cannot
 * run outside a phone; this is the only judgement in it.
 */

const notice = (kind, id) => ({ id: `${kind}:${id}`, kind, title: `${kind} ${id}` })

test('a landing leads, because a family watching a plane read nothing past it', () => {
  const order = worthWaking([
    notice('photos', 'p1'),
    notice('arrived', 's1'),
    notice('landed', 'g1'),
  ])
  assert.deepEqual(
    order.map(one => one.kind),
    ['landed', 'arrived', 'photos'],
  )
})

test('a place beats the pictures taken at it, which are usually of the place', () => {
  const order = worthWaking([notice('photos', 'p1'), notice('arrived', 's1')])
  assert.deepEqual(
    order.map(one => one.kind),
    ['arrived', 'photos'],
  )
})

test('two of a kind stay in the order the day ran them', () => {
  const order = worthWaking([notice('landed', 'g1'), notice('landed', 'g2')])
  assert.deepEqual(
    order.map(one => one.id),
    ['landed:g1', 'landed:g2'],
  )
})

test('sorting does not disturb the list it was handed', () => {
  const given = [notice('photos', 'p1'), notice('landed', 'g1')]
  worthWaking(given)
  assert.equal(given[0].kind, 'photos', 'the caller’s array was reordered under it')
})

test('nothing to say is an empty list rather than a throw', () => {
  assert.deepEqual(worthWaking([]), [])
})

test('what the airport said comes before everything, the landing it may be included', () => {
  const order = worthWaking([
    notice('photos', 'p1'),
    notice('landed', 'g1'),
    notice('flight', 'f1'),
    notice('arrived', 's1'),
  ])
  assert.deepEqual(
    order.map(one => one.kind),
    ['flight', 'landed', 'arrived', 'photos'],
  )
})
