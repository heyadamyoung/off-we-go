import assert from 'node:assert/strict'
import test from 'node:test'
import { squareRowHeight } from '../src/grid-window-core.ts'
import {
  ELSEWHERE,
  groupByStop,
  groupPhotos,
  layoutGroups,
  ungrouped,
  windowRows,
} from '../src/photo-groups-core.ts'

const stops = [
  { id: 'rijks', name: 'Rijksmuseum', seq: 1 },
  { id: 'anne', name: 'Anne Frank House', seq: 0 },
  { id: 'centraal', name: 'Centraal', seq: 2 },
]

const photo = (id, stopId, takenAt, seq = 0) => ({ id, stopId, takenAt, seq })

test('a card per itinerary item, in the order the trip visits them', () => {
  const groups = groupByStop(
    [photo('a', 'centraal'), photo('b', 'anne'), photo('c', 'rijks')],
    stops,
  )
  assert.deepEqual(
    groups.map(group => group.title),
    ['Anne Frank House', 'Rijksmuseum', 'Centraal'],
    'the itinerary decides the order, not the photographs',
  )
})

test('a stop nobody photographed is not an empty card', () => {
  /* A column of empty cards is a worse way to read an itinerary than the
     itinerary is. */
  const groups = groupByStop([photo('a', 'rijks')], stops)
  assert.deepEqual(
    groups.map(group => group.title),
    ['Rijksmuseum'],
  )
})

test('everything filed nowhere is gathered at the end, not dropped', () => {
  const groups = groupByStop([photo('a', null), photo('b', 'rijks'), photo('c')], stops)
  assert.equal(groups.at(-1).title, ELSEWHERE)
  assert.deepEqual(
    groups.at(-1).photos.map(item => item.id),
    ['a', 'c'],
  )
  // Every photograph appears exactly once across the cards, always.
  assert.equal(groups.flatMap(group => group.photos).length, 3)
})

test('a photograph filed at a stop that no longer exists is still shown', () => {
  /* The server re-files a trip whenever its stops change, so this should not
     happen — but a photograph is not worth losing to a race. */
  const groups = groupByStop([photo('ghost', 'deleted'), photo('a', 'rijks')], stops)
  assert.equal(groups.at(-1).title, ELSEWHERE)
  assert.ok(groups.at(-1).photos.some(item => item.id === 'ghost'))
})

test('no photographs is no cards, rather than a page of empty ones', () => {
  assert.deepEqual(groupByStop([], stops), [])
  assert.deepEqual(ungrouped([]), [])
})

test('ungrouped is everything at once, newest first', () => {
  const groups = ungrouped([
    photo('old', null, '2027-06-01T09:00:00.000Z'),
    photo('new', null, '2027-06-03T09:00:00.000Z'),
    photo('mid', null, '2027-06-02T09:00:00.000Z'),
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].photos.map(item => item.id),
    ['new', 'mid', 'old'],
  )
})

test('a photograph with no time of its own keeps its place in the queue', () => {
  /* Date.parse of undefined is NaN, and a sort that lets NaN decide puts rows
     in whatever order the engine's sort happens to walk them. */
  const groups = ungrouped([
    photo('first', null, null, 1),
    photo('second', null, null, 2),
    photo('third', null, null, 3),
  ])
  assert.deepEqual(
    groups[0].photos.map(item => item.id),
    ['third', 'second', 'first'],
    'arrival order, backwards, which is what the flat grid always did',
  )
})

test('an unreadable timestamp does not reorder everything around it', () => {
  const groups = ungrouped([
    photo('good', null, '2027-06-01T09:00:00.000Z', 1),
    photo('broken', null, 'not a date', 2),
    photo('later', null, '2027-06-02T09:00:00.000Z', 3),
  ])
  assert.equal(groups[0].photos.length, 3, 'nothing is lost to a bad value')
})

test('the mode chooses between the two', () => {
  const photos = [photo('a', 'rijks'), photo('b', null)]
  assert.equal(groupPhotos(photos, stops, 'stop').length, 2)
  assert.equal(groupPhotos(photos, stops, 'date').length, 1)
})

/* Layout and windowing. */

const many = (count, stopId) =>
  Array.from({ length: count }, (_, index) => photo(`${stopId}-${index}`, stopId, null, index))

const sizes = { columns: 3, rowHeight: 100, headerHeight: 40 }

test('a card is a header and its rows, stacked in order', () => {
  const groups = groupByStop(many(7, 'rijks'), stops)
  const { rows, height } = layoutGroups(groups, sizes)
  assert.equal(rows[0].kind, 'header')
  // 7 photographs across 3 columns is 3 rows, the last one short.
  assert.equal(rows.filter(row => row.kind === 'photos').length, 3)
  assert.equal(rows.at(-1).items.length, 1)
  assert.equal(height, 40 + 3 * 100)
})

test('every row knows where it starts, and they do not overlap', () => {
  const groups = groupByStop([...many(5, 'anne'), ...many(4, 'rijks')], stops)
  const { rows, height } = layoutGroups(groups, sizes)
  let expected = 0
  for (const row of rows) {
    assert.equal(row.top, expected, `${row.key} starts in the wrong place`)
    expected += row.height
  }
  assert.equal(height, expected, 'the height is exactly what the rows take up')
})

test('a collapsed card keeps its header and gives back its rows', () => {
  const groups = groupByStop([...many(9, 'anne'), ...many(9, 'rijks')], stops)
  const open = layoutGroups(groups, sizes)
  const shut = layoutGroups(groups, { ...sizes, collapsed: new Set(['anne']) })

  assert.equal(shut.rows.filter(row => row.kind === 'header').length, 2, 'both are still listed')
  assert.equal(shut.height, open.height - 3 * 100, 'exactly the rolled-up rows')
  assert.ok(!shut.rows.some(row => row.kind === 'photos' && row.group.key === 'anne'))
})

test('with everything rolled up there is nothing but headers', () => {
  const groups = groupByStop([...many(9, 'anne'), ...many(9, 'rijks')], stops)
  const shut = layoutGroups(groups, { ...sizes, collapsed: new Set(['anne', 'rijks']) })
  assert.equal(shut.height, 80)
  assert.ok(shut.rows.every(row => row.kind === 'header'))
})

test('the ungrouped list draws no header at all', () => {
  const { rows } = layoutGroups(ungrouped(many(6, null)), { ...sizes, showHeaders: false })
  assert.ok(rows.every(row => row.kind === 'photos'))
})

const scrolledTo = (rows, height, scrolled, viewportHeight = 500) =>
  windowRows(rows, height, { scrolled, viewportHeight })

test('only what is near the viewport is in the document', () => {
  const groups = groupByStop(many(3000, 'rijks'), stops)
  const { rows, height } = layoutGroups(groups, sizes)
  const view = scrolledTo(rows, height, 0)
  assert.ok(view.end - view.start < 20, `${view.end - view.start} rows for one screenful`)
  assert.equal(view.topPad, 0)
})

test('the spacers and the rendered rows always add up to the whole grid', () => {
  /* The scrollbar must not change size as you move through the grid. */
  const groups = groupByStop([...many(400, 'anne'), ...many(400, 'rijks')], stops)
  const { rows, height } = layoutGroups(groups, sizes)
  for (const scrolled of [0, 250, 1000, 9999, height - 100, height * 2]) {
    const view = scrolledTo(rows, height, scrolled)
    assert.ok(view.start <= view.end, `start ${view.start} is past end ${view.end}`)
    const rendered = rows.slice(view.start, view.end).reduce((total, row) => total + row.height, 0)
    assert.equal(
      view.topPad + rendered + view.bottomPad,
      height,
      `the grid changed height at ${scrolled}`,
    )
  }
})

test('a scroller sitting past the whole grid still draws the end of it', () => {
  /* The panel shares one scroller across its views, so arriving here from a
     longer one arrives already scrolled past everything. Rendering nothing is
     a blank grid with an honest scrollbar, which is the worst of both. */
  const groups = groupByStop(many(60, 'rijks'), stops)
  const { rows, height } = layoutGroups(groups, sizes)
  for (const beyond of [height, height + 500, height * 3]) {
    const view = scrolledTo(rows, height, beyond)
    assert.ok(view.end > view.start, `nothing rendered at ${beyond}`)
    assert.equal(view.end, rows.length, 'the end of the grid is what is nearest')
  }
})

test('scrolling to a card shows that card', () => {
  const groups = groupByStop([...many(300, 'anne'), ...many(300, 'rijks')], stops)
  const { rows, height } = layoutGroups(groups, sizes)
  const second = rows.find(row => row.kind === 'header' && row.group.key === 'rijks')
  const view = scrolledTo(rows, height, second.top)
  const shown = rows.slice(view.start, view.end)
  assert.ok(shown.includes(second), 'its own header')
  assert.ok(shown.some(row => row.kind === 'photos' && row.group.key === 'rijks'))
})

test('before anything has been measured, everything is rendered', () => {
  const groups = groupByStop(many(30, 'rijks'), stops)
  const { rows, height } = layoutGroups(groups, sizes)
  const view = windowRows(rows, height, { scrolled: 0, viewportHeight: 0 })
  assert.deepEqual(view, { start: 0, end: rows.length, topPad: 0, bottomPad: 0 })
})

test('an empty grid is a window over nothing, not an error', () => {
  assert.deepEqual(windowRows([], 0, { scrolled: 0, viewportHeight: 500 }), {
    start: 0,
    end: 0,
    topPad: 0,
    bottomPad: 0,
  })
})

test('a trip of thousands is still laid out in a blink', () => {
  /* The ceiling this removes was invented to work around the grid. If laying
     it out were slow, it would just be a different ceiling. */
  const photos = Array.from({ length: 20_000 }, (_, index) =>
    photo(`p${index}`, index % 3 === 0 ? 'rijks' : index % 3 === 1 ? 'anne' : null, null, index),
  )
  const started = performance.now()
  const groups = groupByStop(photos, stops)
  const { rows, height } = layoutGroups(groups, sizes)
  const view = scrolledTo(rows, height, height / 2)
  const took = performance.now() - started
  assert.equal(groups.flatMap(group => group.photos).length, 20_000)
  assert.ok(view.end - view.start < 20)
  assert.ok(took < 500, `${Math.round(took)}ms to arrange twenty thousand photographs`)
})

test('rows are kept beyond each edge, so a flick does not show empty cells', () => {
  /* A row has to exist before it is visible. Without overscan every flick
     shows a band of nothing while the next rows are built. */
  const groups = groupByStop(many(600, 'rijks'), stops)
  const { rows, height } = layoutGroups(groups, sizes)
  const view = scrolledTo(rows, height, 4000)
  assert.ok(view.topPad < 4000, 'rows above the fold are rendered')
  const bottomEdge = height - view.bottomPad
  assert.ok(bottomEdge > 4000 + 500, 'and rows below it')
})

test('nonsense does not produce a window that renders nothing', () => {
  /* A measurement can arrive negative or not-a-number while a panel is
     opening, and a blank grid is a worse answer than a heavy one. */
  const groups = groupByStop(many(30, 'rijks'), stops)
  const { rows, height } = layoutGroups(groups, sizes)
  for (const scrolled of [-500, Number.NaN]) {
    const view = windowRows(rows, height, { scrolled, viewportHeight: 500 })
    assert.ok(view.end > view.start, `nothing rendered for scrolled=${scrolled}`)
  }
  const unmeasured = windowRows(rows, height, { scrolled: 0, viewportHeight: Number.NaN })
  assert.equal(unmeasured.end, rows.length, 'an unmeasured viewport renders everything')
})

test('a cell is as wide as the space left once the gaps are taken out', () => {
  /* Kept from the uniform grid this replaced: the row height is still a
     square cell plus the gap beneath it, and it is still the one number the
     whole layout is built on. */
  assert.equal(squareRowHeight(360, 3, 8), (360 - 16) / 3 + 8)
  assert.equal(squareRowHeight(0, 3, 8), 0)
  assert.equal(squareRowHeight(10, 3, 8), 0, 'narrower than its own gaps is not a grid')
})
