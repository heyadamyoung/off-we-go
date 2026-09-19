/* Where exactly you are sitting, from the booking and, when anybody has
   named it, the aircraft. Real airline cabin drawings are licensed art; the
   question a family actually asks — front or back, window or aisle, together
   or split across an aisle, over the wing or clear of it — is answered by a
   schematic cabin. With the airline's own configuration on file for the
   type (the server keeps a library), the cabin is that one: business up
   front at two across, the exits where the airline puts them, the wing
   under the rows it is under. With only the aircraft named, the cabin is
   the type's cross-section and about its length; without one, the seat
   letters carry the truth: A–F is a narrow-body's two triples, anything
   beyond F only exists on a wide-body. The drawing owns honesty about the
   rest ("representative"), this module owns the geometry. */

import { aircraftFamily } from './cabin-core'
import { type AirlineCabin, type CabinClass, classOfRow, seatsFit } from './cabin-library-core'

export interface SeatPlace {
  row: number
  letter: string
}

export interface CabinPlan {
  /** seat letters in window→window order, one array per bank between aisles */
  sections: string[][]
  rows: number
  /** first and last row shaded as the wing */
  wing: [number, number]
  kind: 'narrow' | 'wide'
  /** the aircraft the cabin is drawn for, when one was named and fits the booking */
  aircraft: string | null
  /** the airline's own classes, when its configuration is on file and fits */
  cabins: CabinClass[] | null
  /** rows a door sits beside, when the airline's configuration says */
  exits: number[] | null
}

/* "31A", "4 f", " 12C " — a row and a letter, or nothing. */
export function parseSeat(seat: string | null | undefined): SeatPlace | null {
  const m = /^\s*(\d{1,3})\s*([A-Za-z])\s*$/.exec(seat || '')
  if (!m) return null
  const row = Number(m[1])
  if (!row) return null
  return { row, letter: m[2].toUpperCase() }
}

const NARROW: string[][] = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
]
/* The wide superset: 3-4-3 holds every letter an A330's 2-4-2, a 787's
   3-3-3 or a 777's 3-4-3 can book (I is skipped by every airline). */
const WIDE: string[][] = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'J', 'K'],
]
/* Two-and-two lettered the other way, for an airline that books a B. */
const ABCD: string[][] = [
  ['A', 'B'],
  ['C', 'D'],
]

const widest = (cabins: CabinClass[]): string[][] =>
  cabins.reduce((best, cabin) =>
    cabin.sections.flat().length > best.sections.flat().length ? cabin : best,
  ).sections

export function cabinFor(
  seats: Array<string | null | undefined>,
  aircraft?: string | null,
  library?: AirlineCabin | null,
): CabinPlan {
  const places = seats.map(parseSeat).filter((place): place is SeatPlace => place !== null)
  const letters = new Set(places.map(place => place.letter))
  const deepest = Math.max(0, ...places.map(place => place.row))
  if (library && seatsFit(places, library)) {
    const sections = widest(library.cabins)
    return {
      sections,
      rows: library.cabins[library.cabins.length - 1].rows[1],
      wing: library.wing,
      kind: sections.length > 2 ? 'wide' : 'narrow',
      aircraft: library.name,
      cabins: library.cabins,
      exits: library.exits,
    }
  }
  const family = aircraftFamily(aircraft)
  if (family) {
    let sections = family.sections
    if (sections.length === 2 && sections.flat().length === 4 && letters.has('B')) sections = ABCD
    /* A booked letter the family has no seat for is a booking on a
       different aircraft than the one named, and the booking is the one
       thing here that is certainly true: draw for it, and say no type. */
    if (places.every(place => sections.flat().includes(place.letter))) {
      const rows = Math.max(family.rows, deepest + 2)
      return {
        sections,
        rows,
        wing: wingOf(rows),
        kind: sections.length > 2 ? 'wide' : 'narrow',
        aircraft: family.name,
        cabins: null,
        exits: null,
      }
    }
  }
  const wide = places.some(place => place.letter > 'F')
  const sections = wide ? WIDE : NARROW
  /* Enough cabin behind the deepest booked row that it never sits on the
     tail cone, and never fewer rows than the family the layout belongs to. */
  const rows = Math.max(deepest + 6, wide ? 46 : 32)
  return {
    sections,
    rows,
    wing: wingOf(rows),
    kind: wide ? 'wide' : 'narrow',
    aircraft: null,
    cabins: null,
    exits: null,
  }
}

const wingOf = (rows: number): [number, number] => [Math.ceil(rows * 0.34), Math.floor(rows * 0.62)]

/* ---- the drawing's numbers ------------------------------------------- */

export const SEAT = 16
export const GAP = 4
export const AISLE = 14
export const ROW_H = SEAT + GAP
export const LEFT = 30 // row numbers live here
export const PAD = 12
export const NOSE = 56
export const TAIL = 48
/** the strip a class's name sits in, above its first row */
export const BAND = 18

export interface DrawnSeat {
  letter: string
  x: number
  w: number
}
export interface DrawnRow {
  row: number
  y: number
  seats: DrawnSeat[]
}
export interface DrawnBand {
  name: string
  y: number
}
export interface CabinGeometry {
  width: number
  height: number
  /** the fuselage's left and right walls */
  left: number
  right: number
  rows: DrawnRow[]
  bands: DrawnBand[]
  /** y of each door, both walls */
  exits: number[]
  wing: { top: number; bottom: number }
}

const acrossAt = (sections: string[][], seat: number): number =>
  sections.reduce((sum, bank) => sum + bank.length * seat + (bank.length - 1) * GAP, 0) +
  (sections.length - 1) * AISLE

/* The seats of one row across a fuselage of a given inner width: the
   widest class fills it at full seat width; a class with fewer across
   spreads its seats to the same walls, wider each, the way a business
   seat is wider. */
function dealRow(sections: string[][], inner: number, start: number): DrawnSeat[] {
  const seats = sections.flat().length
  const banks = sections.length
  const w = (inner - (banks - 1) * AISLE - (seats - banks) * GAP) / seats
  const out: DrawnSeat[] = []
  let x = start
  for (const bank of sections) {
    for (const letter of bank) {
      out.push({ letter, x, w })
      x += w + GAP
    }
    x += AISLE - GAP
  }
  return out
}

/** Every row, band, door and the wing as x and y on the drawing. */
export function cabinGeometry(plan: CabinPlan): CabinGeometry {
  const inner = acrossAt(plan.sections, SEAT)
  const start = LEFT + PAD
  const right = start + inner + PAD
  const rows: DrawnRow[] = []
  const bands: DrawnBand[] = []
  let y = NOSE
  if (plan.cabins) {
    for (const cabin of plan.cabins) {
      bands.push({ name: cabin.name, y })
      y += BAND
      for (let row = cabin.rows[0]; row <= cabin.rows[1]; row++) {
        rows.push({ row, y, seats: dealRow(cabin.sections, inner, start) })
        y += ROW_H
      }
    }
  } else {
    for (let row = 1; row <= plan.rows; row++) {
      rows.push({ row, y, seats: dealRow(plan.sections, inner, start) })
      y += ROW_H
    }
  }
  const height = y - GAP + TAIL
  const yOf = (row: number): number => {
    /* A row in a gap of the numbering draws where its neighbour does. */
    const drawn = rows.find(one => one.row >= row) || rows[rows.length - 1]
    return drawn.y
  }
  const exits = plan.exits
    ? plan.exits.map(yOf)
    : [NOSE - 2, yOf(plan.wing[0]) - 6, yOf(plan.wing[1]) + SEAT + 2, height - TAIL + 6]
  return {
    width: right + 4,
    height,
    left: LEFT,
    right,
    rows,
    bands,
    exits,
    wing: { top: yOf(plan.wing[0]), bottom: yOf(plan.wing[1]) + SEAT },
  }
}

/** The class a booked row is in, for the chips: "Maya · 31A · Economy". */
export function classOf(plan: CabinPlan, row: number): string | null {
  if (!plan.cabins) return null
  const cabin = classOfRow({ cabins: plan.cabins } as AirlineCabin, row)
  return cabin ? cabin.name : null
}
