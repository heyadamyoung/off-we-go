import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(appRoot, 'deploy', 'merge-env.sh');

/* The deployment carries the connector's secrets to the box, because nobody
   edits /opt/wayfare/.env by hand. Getting that merge wrong either loses a
   value the site is already running on or mangles one on the way in, and
   either way it is discovered as a dead site. */
function merge(existing, additions) {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-env-'));
  const target = path.join(dir, '.env');
  const source = path.join(dir, 'release.env');
  writeFileSync(target, existing);
  writeFileSync(source, additions);
  const result = spawnSync('bash', [script, source, target], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return readFileSync(target, 'utf8');
}

test('a new key is appended and an existing one is replaced in place', () => {
  const merged = merge(
    'WAYFARE_DOMAIN=offwego.to\nMS_TENANT=common\nLOG_LEVEL=info\n',
    'MS_CLIENT_ID=c55713ba\nMS_TENANT=9c57b550\n',
  );

  assert.equal(
    merged,
    'WAYFARE_DOMAIN=offwego.to\nMS_TENANT=9c57b550\nLOG_LEVEL=info\nMS_CLIENT_ID=c55713ba\n',
  );
});

test('secrets survive the trip with their punctuation intact', () => {
  const secret = 'aLr8Q~lwl$xtT\\Xuh&f/VRY+qQ=hAp"I1r`Xp4';
  const merged = merge('LOG_LEVEL=info\n', `MS_CLIENT_SECRET=${secret}\n`);

  assert.equal(merged, `LOG_LEVEL=info\nMS_CLIENT_SECRET=${secret}\n`);
});

test('a value the pipeline did not set leaves the running one alone', () => {
  const merged = merge('MS_CLIENT_ID=already-here\n', 'MS_CLIENT_ID=\nMS_TENANT=\n');

  assert.equal(merged, 'MS_CLIENT_ID=already-here\n');
});

test('a key that appears twice is only replaced once', () => {
  const merged = merge('A=1\nA=2\n', 'A=3\n');

  assert.equal(merged, 'A=3\nA=2\n');
});

test('a key whose name is a prefix of another is not confused for it', () => {
  const merged = merge('MS_TENANT_ID=keep\nMS_TENANT=old\n', 'MS_TENANT=new\n');

  assert.equal(merged, 'MS_TENANT_ID=keep\nMS_TENANT=new\n');
});

test('comments, blank lines and a missing final newline are preserved', () => {
  const merged = merge('# managed by hand\n\nLOG_LEVEL=info', '# a comment\n\nMS_TENANT=common\n');

  assert.equal(merged, '# managed by hand\n\nLOG_LEVEL=info\nMS_TENANT=common\n');
});

test('the deployment refuses to invent an environment file it cannot find', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-env-'));
  const source = path.join(dir, 'release.env');
  writeFileSync(source, 'MS_TENANT=common\n');

  const result = spawnSync('bash', [script, source, path.join(dir, 'nope.env')], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /no environment file/i);
});
