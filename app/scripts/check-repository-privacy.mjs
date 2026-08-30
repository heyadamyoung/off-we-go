#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepository } from './repositoryPrivacyCore.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..');
const findings = scanRepository(repositoryRoot);

if (findings.length) {
  for (const finding of findings) {
    const commit = finding.commit ? ` (${finding.commit.slice(0, 8)})` : '';
    console.error(`${finding.kind}: ${finding.value}${commit}`);
  }
  process.exitCode = 1;
} else {
  console.log('Repository privacy scan passed.');
}
