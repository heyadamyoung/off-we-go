import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ZOOM,
  rememberStreetNames,
  streetNamePlan,
  STREET_NAME_ZOOM,
  streetNamesWanted,
} from '../src/map-labels-core.ts'

test('street names start early enough to be read at the zoom a trip sits at', () => {
  /* A day on one screen is zoom 11 or 12. CARTO starts its majors at 13 and
     everything else at 14, 15 and 16, so the roads were drawn and none of
     them were named. */
  assert.ok(STREET_NAME_ZOOM.roadname_major <= 11)
  assert.ok(STREET_NAME_ZOOM.roadname_pri <= 12)
})

test('the ladder still holds: bigger roads are named before smaller ones', () => {
  const { roadname_major, roadname_pri, roadname_sec, roadname_minor } = STREET_NAME_ZOOM
  assert.ok(roadname_major < roadname_pri)
  assert.ok(roadname_pri < roadname_sec)
  assert.ok(roadname_sec < roadname_minor)
})

test('every street-name layer is named in the plan, shown or hidden', () => {
  const shown = streetNamePlan(true)
  assert.deepEqual(shown.map(change => change.id).sort(), Object.keys(STREET_NAME_ZOOM).sort())
  assert.ok(shown.every(change => change.visibility === 'visible'))
  assert.ok(shown.every(change => change.maxzoom === MAX_ZOOM))
  assert.ok(streetNamePlan(false).every(change => change.visibility === 'none'))
})

test('hiding them hides them, rather than putting the old numbers back', () => {
  /* Quieter-but-still-there is a control nobody can tell they have used. */
  assert.ok(streetNamePlan(false).every(change => change.visibility === 'none'))
})

test('the map names its roads unless somebody has said otherwise', () => {
  assert.equal(streetNamesWanted({ getItem: () => null }), true)
  assert.equal(streetNamesWanted({ getItem: () => 'on' }), true)
  assert.equal(streetNamesWanted({ getItem: () => 'off' }), false)
})

test('a browser that refuses storage still gets a map with names on it', () => {
  const refuses = {
    getItem() {
      throw new Error('private mode')
    },
    setItem() {
      throw new Error('private mode')
    },
  }
  assert.equal(streetNamesWanted(refuses), true)
  assert.doesNotThrow(() => rememberStreetNames(false, refuses))
  assert.equal(streetNamesWanted(null), true)
})

test('the choice is written where it will be read back', () => {
  const store = new Map()
  const fake = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  }
  rememberStreetNames(false, fake)
  assert.equal(streetNamesWanted(fake), false)
  rememberStreetNames(true, fake)
  assert.equal(streetNamesWanted(fake), true)
})
