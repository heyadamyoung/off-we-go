import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLabel, shortSha } from '../src/build-identity-core.ts'

test('a commit is named short, the way everything else names one', () => {
  assert.equal(shortSha('6b51de13f8ef6d02f5de9c9bb4740017dc8b830c'), '6b51de1')
  assert.equal(shortSha('6B51DE13F8EF'), '6b51de1')
})

test('anything that is not a commit is not shown as one', () => {
  for (const value of ['', null, undefined, 'dev', 'main', 'v1.2.3', '123456'])
    assert.equal(shortSha(value), '', `${value} is not a commit`)
})

test('a phone says the version and build a TestFlight screen says, and the commit', () => {
  assert.equal(
    buildLabel('6b51de13f8ef6d02f5de9c9bb4740017dc8b830c', { version: '1.4.12', build: '144' }),
    '1.4.12 (144) · 6b51de1',
  )
})

test('the web has no version of its own, so it says the commit alone', () => {
  assert.equal(buildLabel('6b51de13f8ef', null), '6b51de1')
})

test('a build number with no version names nothing, and is left out', () => {
  assert.equal(buildLabel('6b51de13f8ef', { build: '144' }), '6b51de1')
  assert.equal(buildLabel(null, { version: '1.4.12', build: '144' }), '1.4.12 (144)')
})

test('a build that carries nothing says nothing rather than something empty', () => {
  assert.equal(buildLabel(null, null), '')
  assert.equal(buildLabel('dev', {}), '')
})
