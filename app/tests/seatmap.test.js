import assert from 'node:assert/strict'
import test from 'node:test'
import { cabinFor, parseSeat } from '../src/seatmap-core.ts'

test('a seat string is a row and a letter, or nothing', () => {
  assert.deepEqual(parseSeat('31A'), { row: 31, letter: 'A' })
  assert.deepEqual(parseSeat(' 4 f '), { row: 4, letter: 'F' })
  assert.equal(parseSeat('window'), null)
  assert.equal(parseSeat('0A'), null)
  assert.equal(parseSeat(''), null)
  assert.equal(parseSeat(null), null)
})

test('letters A–F draw a narrow-body, anything past F a wide-body', () => {
  const narrow = cabinFor(['14A', '14C'])
  assert.equal(narrow.kind, 'narrow')
  assert.deepEqual(narrow.sections, [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
  ])

  const wide = cabinFor(['31A', '31K'])
  assert.equal(wide.kind, 'wide')
  // Every bookable wide-body letter has a cell, I skipped as airlines do.
  assert.deepEqual(wide.sections.flat(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'])
})

test('the cabin always reaches past the deepest booked row', () => {
  assert.equal(cabinFor(['14A']).rows, 32)
  assert.equal(cabinFor(['52C']).rows, 58)
  const { rows, wing } = cabinFor(['31A', '31B'])
  assert.ok(wing[0] > 1 && wing[1] < rows, 'the wing band sits inside the cabin')
  assert.ok(wing[0] < wing[1])
})

test('unparseable seats still yield a drawable default cabin', () => {
  const plan = cabinFor(['aisle please', null])
  assert.equal(plan.kind, 'narrow')
  assert.equal(plan.rows, 32)
})

/* With the airline's own configuration from the server, the cabin is that
   one: the classes at their rows, business wider across the same walls,
   the numbering's gaps kept, the doors and the wing where the airline puts
   them. A booking the configuration has no seat for falls back to the type. */
import { cabinGeometry, classOf, SEAT } from '../src/seatmap-core.ts'

const AC38M = {
  airline: 'AC',
  family: 'B38M',
  name: 'Boeing 737 MAX 8',
  seats: 169,
  cabins: [
    {
      name: 'Business',
      rows: [1, 4],
      sections: [
        ['A', 'C'],
        ['D', 'F'],
      ],
    },
    {
      name: 'Economy',
      rows: [12, 37],
      sections: [
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
      ],
    },
  ],
  exits: [1, 20, 21, 37],
  wing: [18, 26],
}

test("the airline's configuration is the cabin when the booking fits it", () => {
  const plan = cabinFor(['3F', '31A'], 'Boeing 737 MAX 8', AC38M)
  assert.equal(plan.aircraft, 'Boeing 737 MAX 8')
  assert.deepEqual(
    plan.cabins.map(cabin => cabin.name),
    ['Business', 'Economy'],
  )
  assert.equal(plan.rows, 37)
  assert.deepEqual(plan.wing, [18, 26])
  assert.deepEqual(plan.exits, [1, 20, 21, 37])
  assert.equal(classOf(plan, 3), 'Business')
  assert.equal(classOf(plan, 31), 'Economy')
  assert.equal(classOf(plan, 8), null)
})

test('a seat the configuration has no place for falls back to the type', () => {
  const plan = cabinFor(['8A'], 'Boeing 737 MAX 8', AC38M) // row 8 is in the gap
  assert.equal(plan.cabins, null)
  assert.equal(plan.aircraft, 'Boeing 737 MAX 8')
  assert.equal(cabinFor(['2B'], 'Boeing 737 MAX 8', AC38M).cabins, null)
  assert.equal(cabinFor(['2B'], 'Boeing 737 MAX 8', null).aircraft, 'Boeing 737 MAX 8')
})

test('the drawing: rows as numbered, a band per class, business seats wider to the same walls', () => {
  const g = cabinGeometry(cabinFor(['31A'], 'Boeing 737 MAX 8', AC38M))
  assert.deepEqual(g.rows.map(row => row.row).slice(0, 6), [1, 2, 3, 4, 12, 13])
  assert.equal(g.rows.length, 4 + 26)
  assert.deepEqual(
    g.bands.map(band => band.name),
    ['Business', 'Economy'],
  )
  const business = g.rows[0].seats
  const economy = g.rows[4].seats
  assert.equal(business.length, 4)
  assert.equal(economy.length, 6)
  assert.ok(business[0].w > economy[0].w, 'a business seat is wider')
  assert.equal(economy[0].w, SEAT)
  /* Both classes span the same walls, to the pixel. */
  const span = seats => seats[seats.length - 1].x + seats[seats.length - 1].w - seats[0].x
  assert.ok(Math.abs(span(business) - span(economy)) < 0.01)
  /* A door beside each row the airline lists; the wing over its rows. */
  assert.equal(g.exits.length, 4)
  assert.equal(g.exits[1], g.rows.find(row => row.row === 20).y)
  assert.equal(g.wing.top, g.rows.find(row => row.row === 18).y)
  assert.equal(g.wing.bottom, g.rows.find(row => row.row === 26).y + SEAT)
  assert.ok(g.bands[1].y < g.rows[4].y, 'the band sits above its first row')
  assert.ok(g.height > g.rows[g.rows.length - 1].y + SEAT)
})

test('without a configuration the drawing is the plain cabin: rows from 1, four doors, no bands', () => {
  const g = cabinGeometry(cabinFor(['14A', '14C']))
  assert.equal(g.rows.length, 32)
  assert.equal(g.rows[0].row, 1)
  assert.deepEqual(g.bands, [])
  assert.equal(g.exits.length, 4)
  assert.equal(g.rows[0].seats.length, 6)
})
