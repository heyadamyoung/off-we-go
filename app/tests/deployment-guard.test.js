import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the deployment SSH entrypoint rejects arbitrary commands', () => {
  const result = spawnSync('bash', ['-lc', './deploy/github-deploy.sh'], {
    cwd: appRoot,
    env: {
      ...process.env,
      SSH_ORIGINAL_COMMAND: 'bash -i',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 64, result.stderr || result.error?.message);
  assert.match(result.stderr, /refusing unauthorized deploy command/i);
});
