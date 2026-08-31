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

test('production compose runs a private pinned Logto service behind the existing web proxy', () => {
  const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: appRoot,
    env: {
      ...process.env,
      WAYFARE_DOMAIN: 'wayfare.example.com',
      WAYFARE_ADMIN_EMAIL: 'owner@example.com',
      APPLE_TEAM_ID: 'R65UN25Q64',
      POSTGRES_PASSWORD: 'database-secret',
      WAYFARE_SESSION_SECRET: 'session-secret-that-is-long-enough',
      WAYFARE_OAUTH_SECRET: 'oauth-secret-that-is-long-enough',
      WAYFARE_OIDC_ISSUER: 'https://auth.example.com/oidc',
      WAYFARE_OIDC_CLIENT_ID: 'wayfare-web',
      WAYFARE_OIDC_CLIENT_SECRET: 'oidc-secret',
      LOGTO_DOMAIN: 'auth.example.com',
      LOGTO_ADMIN_DOMAIN: 'auth-admin.example.com',
      LOGTO_POSTGRES_PASSWORD: 'logto-database-secret',
      LOGTO_SECRET_VAULT_KEK: 'base64-key',
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'Wayfare <owner@example.com>',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const compose = JSON.parse(result.stdout);
  assert.equal(compose.services.logto.image, 'ghcr.io/logto-io/logto:1.41.0');
  assert.equal(compose.services.logto.ports, undefined, 'Logto ports must not bypass Caddy');
  assert.equal(compose.services.logto.environment.ENDPOINT, 'https://auth.example.com');
  assert.equal(compose.services.logto.environment.ADMIN_ENDPOINT, 'https://auth-admin.example.com');
  assert.equal(compose.services.logto.environment.TRUST_PROXY_HEADER, '1');
  assert.equal(compose.services.web.environment.LOGTO_DOMAIN, 'auth.example.com');
  assert.equal(compose.services.web.environment.LOGTO_ADMIN_DOMAIN, 'auth-admin.example.com');
});
