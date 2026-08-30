import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scanRepository } from '../scripts/repositoryPrivacyCore.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function fixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'wayfare-privacy-'));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.name', 'Privacy Test');
  git(cwd, 'config', 'user.email', 'privacy@example.com');
  return cwd;
}

function commit(cwd, subject) {
  git(cwd, 'add', '.');
  git(cwd, 'commit', '--quiet', '-m', subject);
}

test('repository privacy scan accepts generic project history', () => {
  const cwd = fixture();
  try {
    writeFileSync(path.join(cwd, 'README.md'), 'Generic sample trip\n');
    commit(cwd, 'Add sample data');
    assert.deepEqual(scanRepository(cwd), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('repository privacy scan catches removed files, private text, and revealing subjects', () => {
  const cwd = fixture();
  try {
    writeFileSync(path.join(cwd, 'feat' + '1.png'), 'not really an image');
    writeFileSync(path.join(cwd, 'notes.txt'), 'adam.young1986' + '@outlook.com');
    commit(cwd, ['The Tower', 'is paid'].join(' '));

    const findings = scanRepository(cwd);
    assert.ok(findings.some(({ kind }) => kind === 'forbidden-path'));
    assert.ok(findings.some(({ kind }) => kind === 'private-text'));
    assert.ok(findings.some(({ kind }) => kind === 'revealing-subject'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('repository privacy scan catches identifying demo fixtures', () => {
  const cwd = fixture();
  try {
    const markers = [
      ['Anne', ' & Adam'].join(''),
      ['Adam', "'s iPhone"].join(''),
      ['Anne', "'s iPhone"].join(''),
      ["by: '", "Anne'"].join(''),
      ["name: '", "Adam'"].join(''),
      ["by:'", "Adam'"].join(''),
      ["by: '", "Adam'"].join(''),
      ["name:'", "Adam'"].join(''),
    ];
    writeFileSync(path.join(cwd, 'fixtures.txt'), markers.join('\n'));
    commit(cwd, 'Add test fixtures');

    const findings = scanRepository(cwd);
    for (const marker of markers) {
      assert.ok(findings.some(({ kind, value }) => kind === 'private-text' && value === marker), marker);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
