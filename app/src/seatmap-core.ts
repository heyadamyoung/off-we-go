/* Where exactly you are sitting, from the booking and, when anybody has
   named it, the aircraft. Real airline cabin drawings are licensed art; the
   question a family actually asks — front or back, window or aisle, together
   or split across an aisle, over the wing or clear of it — is answered by a
   schematic cabin. With the aircraft named (by the airport's board, the
   transponder, or the booking), the cabin is that type's cross-section and
   about its length; without one, the seat letters carry the truth: A–F is
   a narrow-body's two triples, anything beyond F only exists on a wide-body.
   The drawing owns honesty about the rest ("typical layout"), this module
   owns the geometry. */

import { aircraftFamily } from './cabin-core'

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

export function cabinFor(
  seats: Array<string | null | undefined>,
  aircraft?: string | null,
): CabinPlan {
  const places = seats.map(parseSeat).filter((place): place is SeatPlace => place !== null)
  const letters = new Set(places.map(place => place.letter))
  const deepest = Math.max(0, ...places.map(place => place.row))
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
      }
    }
  }
  const wide = places.some(place => place.letter > 'F')
  const sections = wide ? WIDE : NARROW
  /* Enough cabin behind the deepest booked row that it never sits on the
     tail cone, and never fewer rows than the family the layout belongs to. */
  const rows = Math.max(deepest + 6, wide ? 46 : 32)
  return { sections, rows, wing: wingOf(rows), kind: wide ? 'wide' : 'narrow', aircraft: null }
}

const wingOf = (rows: number): [number, number] => [Math.ceil(rows * 0.34), Math.floor(rows * 0.62)]
