import assert from 'node:assert/strict'
import test from 'node:test'
import { aircraftFamily, aircraftName } from '../src/cabin-core.ts'
import { cabinFor } from '../src/seatmap-core.ts'

/* Which cabin an aircraft has. What these pin: the ICAO code the boards and
   the transponder use, the IATA code and the words an airline writes all
   land on one family; a family's cross-section is the one the seat map
   draws; a name that contains another lands on the longer one; a booking
   whose letters the named aircraft does not have is drawn for the booking;
   and a type nobody knows is drawn as before, from the letters alone. */

test('the boards’ codes, the airlines’ codes and the words name one family', () => {
  for (const said of ['BCS3', 'A223', '223', 'CS3', 'Airbus A220-300', 'A220', 'a220-300']) {
    assert.equal(aircraftFamily(said)?.name, 'Airbus A220-300', said)
  }
  assert.equal(aircraftFamily('BCS1').name, 'Airbus A220-100')
  assert.deepEqual(aircraftFamily('A220').sections, [
    ['A', 'C'],
    ['D', 'E', 'F'],
  ])
  for (const said of ['B38M', '7M8', 'Boeing 737 MAX 8', '737-8 MAX']) {
    assert.equal(aircraftFamily(said)?.name, 'Boeing 737 MAX 8', said)
  }
  assert.equal(aircraftFamily('737-800').name, 'Boeing 737-800')
  assert.equal(aircraftFamily('Boeing 737').name, 'Boeing 737')
  assert.equal(aircraftFamily('A320neo').name, 'Airbus A320neo')
  assert.equal(aircraftFamily('A320').name, 'Airbus A320')
  assert.equal(aircraftFamily('A21N').name, 'Airbus A321neo')
  for (const said of ['DH8D', 'DH4', 'Q400', 'Dash 8-400', 'De Havilland Dash 8-400']) {
    assert.equal(aircraftFamily(said)?.name, 'De Havilland Dash 8-400', said)
  }
  assert.deepEqual(aircraftFamily('E75L').sections, [
    ['A', 'C'],
    ['D', 'F'],
  ])
  assert.equal(aircraftFamily('Embraer 175').name, 'Embraer 175')
  assert.equal(aircraftFamily('CRJ9').name, 'Bombardier CRJ900')
  assert.equal(aircraftFamily('789').name, 'Boeing 787-9')
  assert.equal(aircraftFamily('Boeing 787-9 Dreamliner').name, 'Boeing 787-9')
  assert.equal(aircraftFamily('B77W').name, 'Boeing 777-300ER')
  assert.equal(aircraftFamily('77W').sections.flat().length, 10)
  assert.equal(aircraftFamily('A333').name, 'Airbus A330-300')
  assert.deepEqual(aircraftFamily('Airbus A330-300').sections, [
    ['A', 'C'],
    ['D', 'E', 'F', 'G'],
    ['H', 'K'],
  ])
  assert.equal(aircraftFamily('A359').name, 'Airbus A350-900')
  assert.equal(aircraftFamily('GLF6'), null, 'a business jet nobody sits in rows on')
  assert.equal(aircraftFamily(''), null)
  assert.equal(aircraftFamily(null), null)
})

test('a ticket says the family’s name, or the words somebody typed, never a bare code', () => {
  assert.equal(aircraftName('BCS3'), 'Airbus A220-300')
  assert.equal(aircraftName('Airbus A220-300'), 'Airbus A220-300')
  assert.equal(aircraftName('Pilatus PC-12'), 'Pilatus PC-12')
  /* A code the file does not know is said as it came: a type worth seeing,
     and how the file grows. Nothing at all is still nothing. */
  assert.equal(aircraftName('GLF6'), 'GLF6')
  assert.equal(aircraftName('a22'), 'Airbus A220-300')
  assert.equal(aircraftName('??'), null)
  assert.equal(aircraftName(null), null)
})

test('the seat map draws the named aircraft’s cabin, about its length', () => {
  const a220 = cabinFor(['3E', '3F'], 'BCS3')
  assert.equal(a220.aircraft, 'Airbus A220-300')
  assert.deepEqual(a220.sections, [
    ['A', 'C'],
    ['D', 'E', 'F'],
  ])
  assert.equal(a220.kind, 'narrow')
  assert.equal(a220.rows, 36)
  assert.ok(a220.wing[0] > 1 && a220.wing[1] < a220.rows)

  const dash = cabinFor(['14A', '14C'], 'DH8D')
  assert.deepEqual(dash.sections, [
    ['A', 'C'],
    ['D', 'F'],
  ])
  assert.equal(dash.rows, 20)
  /* An airline that letters its two-and-two A B / C D says so in the booking. */
  assert.deepEqual(cabinFor(['14A', '14B'], 'CRJ9').sections, [
    ['A', 'B'],
    ['C', 'D'],
  ])

  const dreamliner = cabinFor(['31A', '31B'], 'Boeing 787-9')
  assert.equal(dreamliner.kind, 'wide')
  assert.equal(dreamliner.aircraft, 'Boeing 787-9')
  assert.deepEqual(dreamliner.sections.flat(), ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'J', 'K'])
  /* A booking deeper than the typical cabin still fits in the drawing. */
  assert.equal(cabinFor(['44A'], 'B789').rows, 46)
})

test('a booking the named aircraft cannot seat is drawn for the booking, and unnamed as before', () => {
  /* 14B does not exist on an A220, whose left bank is A and C: the booking
     is the truth, so the cabin is the letters’ and no type is claimed. */
  const other = cabinFor(['14A', '14B'], 'A220')
  assert.equal(other.aircraft, null)
  assert.deepEqual(other.sections, [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
  ])
  const unknown = cabinFor(['31A', '31K'], 'GLF6')
  assert.equal(unknown.aircraft, null)
  assert.equal(unknown.kind, 'wide')
  assert.equal(cabinFor(['14A'], null).rows, 32)
})
