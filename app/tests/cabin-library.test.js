import assert from 'node:assert/strict'
import test from 'node:test'
import { airlineCodeOf, isAirlineCabin, seatsFit } from '../src/cabin-library-core.ts'

/* The client's half of the airlines' cabin library: which airline a leg is
   with, whether a booking fits the cabin the server sent, and whether what
   came off the wire is a cabin at all. */

const KL789 = {
  airline: 'KL',
  family: 'B789',
  name: 'Boeing 787-9',
  seats: 275,
  cabins: [
    { name: 'World Business', rows: [1, 8], sections: [['A'], ['D', 'E'], ['K']] },
    {
      name: 'Premium Comfort',
      rows: [10, 12],
      sections: [
        ['A', 'C'],
        ['D', 'E', 'F'],
        ['G', 'J'],
      ],
    },
    {
      name: 'Economy',
      rows: [14, 38],
      sections: [
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
        ['G', 'H', 'J'],
      ],
    },
  ],
  exits: [1, 10, 28, 38],
  wing: [20, 31],
}

test('the airline is the two letters on the number, else the words on the booking', () => {
  assert.equal(airlineCodeOf({ carrier: 'KLM', number: 'KL 677' }), 'KL')
  assert.equal(airlineCodeOf({ carrier: 'Air Canada', number: 'AC1115' }), 'AC')
  assert.equal(airlineCodeOf({ carrier: 'Air Transat', number: 'ts 376' }), 'TS')
  assert.equal(airlineCodeOf({ carrier: 'Air Canada', number: '1115' }), 'AC')
  assert.equal(airlineCodeOf({ carrier: 'Air Canada Express', number: null }), 'QK')
  assert.equal(airlineCodeOf({ carrier: 'KLM Cityhopper', number: '' }), 'WA')
  assert.equal(airlineCodeOf({ carrier: 'WestJet Encore', number: '' }), 'WR')
  assert.equal(airlineCodeOf({ carrier: 'NS Intercity', number: 'IC 3155' }), 'IC')
  assert.equal(airlineCodeOf({ carrier: 'Deutsche Bahn', number: '' }), null)
})

test('a booking fits the cabin when every seat has a place in a class', () => {
  assert.equal(
    seatsFit(
      [
        { row: 31, letter: 'A' },
        { row: 2, letter: 'K' },
      ],
      KL789,
    ),
    true,
  )
  /* Row 9 is a gap in KLM's numbering; letter K exists only up front. */
  assert.equal(seatsFit([{ row: 9, letter: 'A' }], KL789), false)
  assert.equal(seatsFit([{ row: 31, letter: 'K' }], KL789), false)
  assert.equal(seatsFit([], KL789), true)
})

test('what comes off the wire is a cabin or it is nothing', () => {
  assert.equal(isAirlineCabin(KL789), true)
  assert.equal(isAirlineCabin(null), false)
  assert.equal(isAirlineCabin({ ...KL789, cabins: [] }), false)
  assert.equal(isAirlineCabin({ ...KL789, wing: [20] }), false)
  assert.equal(isAirlineCabin({ ...KL789, cabins: [{ name: 'Economy' }] }), false)
})
