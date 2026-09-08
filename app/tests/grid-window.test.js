import assert from 'node:assert/strict'
import test from 'node:test'
import { gridWindow, squareRowHeight } from '../src/grid-window-core.ts'

/* A phone-sized viewport over a three-across grid of square cells. */
const phone = { columns: 3, rowHeight: 128, viewportHeight: 640 }

test('a trip of ten thousand photographs puts a screenful in the document', () => {
  const window = gridWindow({ ...phone, total: 10_000, scrolled: 0 })

  const rendered = window.end - window.start
  assert.ok(rendered < 60, `a screenful and a little, not ${rendered}`)
  /* The whole point: what it costs to draw is set by the screen, not by how
     long somebody has been adding to the trip. */
  assert.equal(window.rows, Math.ceil(10_000 / 3))
})

test('the two spacers and the rendered rows always add up to the same height', () => {
  const total = 4321
  const rows = Math.ceil(total / 3)
  const full = rows * phone.rowHeight

  for (const scrolled of [0, 500, 12_345, full - 100, full * 2]) {
    const window = gridWindow({ ...phone, total, scrolled })
    /* Asserted before it is used: a window whose start is past its end
       renders nothing, and the height arithmetic below cancels out to the
       right answer anyway — so this invariant is what stops that passing. */
    assert.ok(window.start <= window.end, `start ${window.start} past end ${window.end}`)
    const renderedRows = Math.ceil((window.end - window.start) / 3)
    const measured = window.topPad + renderedRows * phone.rowHeight + window.bottomPad
    assert.equal(measured, full, `scrollbar changed size at ${scrolled}px`)
  }
})

test('a scroller sitting past the whole grid still shows the grid', () => {
  /* The trip panel has one scroller for all its views. Scroll a long list of
     stops, tap Photos, and the grid is measured as being somewhere far above
     the window — which used to put its first row past its last and render
     nothing at all. Not a slow grid or a short one: a blank one, with the
     scrollbar still claiming everything was there. */
  for (const scrolled of [2_000, 50_000, 1e7]) {
    const window = gridWindow({ ...phone, total: 12, scrolled })
    assert.ok(window.start <= window.end, `start ${window.start} past end ${window.end}`)
    assert.ok(
      window.end - window.start > 0,
      `nothing rendered with the scroller ${scrolled}px past a twelve-photograph grid`,
    )
  }

  // And on a grid long enough to really be scrolled past, it shows the end.
  const long = gridWindow({ ...phone, total: 3000, scrolled: 1e7 })
  assert.equal(long.end, 3000, 'the last photograph is what is nearest the scroller')
  assert.ok(long.start < long.end)
  assert.equal(long.bottomPad, 0)
})

test('scrolling moves the window down by whole rows', () => {
  const top = gridWindow({ ...phone, total: 900, scrolled: 0 })
  const down = gridWindow({ ...phone, total: 900, scrolled: 128 * 40 })

  assert.equal(top.start, 0, 'the top of the grid starts at the top of the grid')
  assert.equal(top.topPad, 0)
  assert.ok(down.start > top.start)
  assert.equal(down.start % 3, 0, 'a window that starts mid-row would shear the grid')
  assert.equal(down.topPad, (down.start / 3) * 128, 'the spacer stands exactly where the rows were')
})

test('rows are kept beyond each edge, so a flick does not show empty cells', () => {
  const window = gridWindow({ ...phone, total: 900, scrolled: 128 * 20 })
  const firstVisibleRow = 20
  assert.ok(window.start / 3 <= firstVisibleRow - 3, 'three rows held above')
  const lastVisibleRow = firstVisibleRow + Math.ceil(640 / 128)
  assert.ok(window.end / 3 >= lastVisibleRow + 3, 'and three below')
})

test('scrolled to the very bottom, the last photograph is rendered', () => {
  const total = 1000
  const rows = Math.ceil(total / 3)
  const window = gridWindow({ ...phone, total, scrolled: rows * 128 })
  assert.equal(window.end, total, 'the end of the grid must contain the end of the grid')
  assert.equal(window.bottomPad, 0)
})

test('before anything has been measured, everything is rendered', () => {
  /* A grid that is briefly heavy beats a grid that is briefly empty: with no
     row height there is no way to place anything, and showing nothing on the
     first frame reads as a trip having lost its photographs. */
  const unmeasured = gridWindow({ ...phone, rowHeight: 0, total: 40, scrolled: 0 })
  assert.deepEqual(
    { start: unmeasured.start, end: unmeasured.end },
    { start: 0, end: 40 },
    'no measurement means show it all, not show nothing',
  )
  const unlaidOut = gridWindow({ ...phone, viewportHeight: 0, total: 40, scrolled: 0 })
  assert.equal(unlaidOut.end, 40)
})

test('an empty grid asks for nothing', () => {
  const window = gridWindow({ ...phone, total: 0, scrolled: 0 })
  assert.deepEqual(
    { start: window.start, end: window.end, rows: window.rows, bottomPad: window.bottomPad },
    { start: 0, end: 0, rows: 0, bottomPad: 0 },
  )
})

test('nonsense inputs do not produce a window that renders nothing', () => {
  const negative = gridWindow({ ...phone, total: 900, scrolled: -500 })
  assert.equal(negative.start, 0, 'over-scrolling upwards still shows the top')
  const oneColumn = gridWindow({ ...phone, columns: 0, total: 10, scrolled: 0 })
  assert.equal(oneColumn.rows, 10, 'a grid always has at least one column')
})

test('a row is as tall as a square cell plus the gap beneath it', () => {
  // 360 wide, three across, 8px gaps: (360 - 16) / 3 = 114.67 per cell.
  const height = squareRowHeight(360, 3, 8)
  assert.ok(Math.abs(height - (114 + 2 / 3 + 8)) < 1e-9)
  // Three rows of that plus two gaps is what the browser will actually lay out.
  assert.ok(Math.abs(3 * height - 8 - (3 * (344 / 3) + 2 * 8)) < 1e-9)
})

test('an unmeasured container has no row height, rather than a made-up one', () => {
  assert.equal(squareRowHeight(0, 3, 8), 0)
  assert.equal(squareRowHeight(10, 3, 8), 0, 'narrower than its own gaps is not a grid')
})
