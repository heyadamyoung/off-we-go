import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PROFILE_TAB,
  PROFILE_TABS,
  PROFILE_TAB_LABELS,
  parseProfileSearch,
} from '../src/profile-tabs-core.ts'

test('every tab has a label, and every label a tab', () => {
  assert.deepEqual(
    PROFILE_TAB_LABELS.map(([tab]) => tab),
    [...PROFILE_TABS],
  )
  for (const [, label] of PROFILE_TAB_LABELS)
    assert.ok(label.length, 'a tab with no name is not a tab')
})

test('the tab is in the address, and comes back out of it', () => {
  assert.deepEqual(parseProfileSearch({ tab: 'alerts' }), { tab: 'alerts' })
  assert.deepEqual(parseProfileSearch({ tab: 'signin' }), { tab: 'signin' })
  assert.deepEqual(parseProfileSearch({ tab: 'DATA' }), { tab: 'data' }, 'however it was typed')
})

/* The first tab is where you land, so it does not need saying in the URL. */
test('the default tab leaves no trace', () => {
  assert.deepEqual(parseProfileSearch({ tab: DEFAULT_PROFILE_TAB }), {})
  assert.deepEqual(parseProfileSearch({}), {})
})

test('a tab that does not exist is the first one, not an empty page', () => {
  assert.deepEqual(parseProfileSearch({ tab: 'nonsense' }), {})
  assert.deepEqual(parseProfileSearch({ tab: 7 }), {})
  assert.deepEqual(parseProfileSearch({}), {})
})
