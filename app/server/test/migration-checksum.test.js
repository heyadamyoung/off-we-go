import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

const moduleUnderTest = await import('../src/postgres.js')
const sha256 = value => createHash('sha256').update(value).digest('hex')

test('migration validation treats CRLF and LF as the same applied SQL', () => {
  assert.equal(typeof moduleUnderTest.migrationChecksumStatus, 'function')

  const unixSql = 'create table trips (id uuid primary key);\ncreate index trips_id on trips(id);\n'
  const windowsSql = unixSql.replaceAll('\n', '\r\n')
  const status = moduleUnderTest.migrationChecksumStatus(unixSql, sha256(windowsSql))

  assert.deepEqual(status, {
    matches: true,
    canonicalChecksum: sha256(unixSql),
  })
})

test('migration validation still rejects a real change to applied SQL', () => {
  assert.equal(typeof moduleUnderTest.migrationChecksumStatus, 'function')

  const appliedSql = 'create table trips (id uuid primary key);\n'
  const changedSql = 'create table trips (id uuid primary key, title text);\n'
  const status = moduleUnderTest.migrationChecksumStatus(changedSql, sha256(appliedSql))

  assert.equal(status.matches, false)
})
