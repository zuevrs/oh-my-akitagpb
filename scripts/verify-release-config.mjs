#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const checks = [
  {
    file: '.github/workflows/publish-akita.yml',
    includes: [
      "- 'akita-v*'",
      'PACKAGE_DIR: packages/oh-my-akitagpb',
      'PACKAGE_TAG_PREFIX: akita-v',
      'npm run release:check --workspace oh-my-akitagpb',
      'working-directory: ${{ env.PACKAGE_DIR }}',
    ],
  },
  {
    file: '.github/workflows/publish-pact.yml',
    includes: [
      "- 'pact-v*'",
      'PACKAGE_DIR: packages/oh-my-pactgpb',
      'PACKAGE_TAG_PREFIX: pact-v',
      'npm run release:check --workspace oh-my-pactgpb',
      'working-directory: ${{ env.PACKAGE_DIR }}',
    ],
  },
  {
    file: 'README.md',
    includes: [
      '.github/workflows/publish-akita.yml',
      '.github/workflows/publish-pact.yml',
      'akita-vX.Y.Z',
      'pact-vX.Y.Z',
      'publish-akita.yml',
      'publish-pact.yml',
    ],
  },
  {
    file: 'packages/oh-my-akitagpb/README.md',
    includes: [
      '.github/workflows/publish-akita.yml',
      'akita-vX.Y.Z',
      'Workflow filename: `publish-akita.yml`',
      'Expected tag prefix: `akita-v`',
    ],
  },
  {
    file: 'packages/oh-my-pactgpb/README.md',
    includes: [
      '.github/workflows/publish-pact.yml',
      'pact-vX.Y.Z',
      'Workflow filename: `publish-pact.yml`',
      'Expected tag prefix: `pact-v`',
    ],
  },
];

const failures = [];

for (const check of checks) {
  const filePath = path.join(repoRoot, check.file);
  const content = readFileSync(filePath, 'utf8');

  for (const needle of check.includes) {
    if (!content.includes(needle)) {
      failures.push(`${check.file} is missing: ${needle}`);
    }
  }
}

const disallowedChecks = [
  { file: 'README.md', disallow: '.github/workflows/publish.yml' },
  { file: 'packages/oh-my-akitagpb/README.md', disallow: 'Workflow filename: `publish.yml`' },
  { file: 'packages/oh-my-pactgpb/README.md', disallow: 'Workflow filename: `publish.yml`' },
  { file: 'README.md', disallow: 'Tag the release as `vX.Y.Z`.' },
  { file: 'packages/oh-my-akitagpb/README.md', disallow: 'Tag the release as `vX.Y.Z`.' },
  { file: 'packages/oh-my-pactgpb/README.md', disallow: 'Tag the release as `vX.Y.Z`.' },
];

for (const check of disallowedChecks) {
  const filePath = path.join(repoRoot, check.file);
  const content = readFileSync(filePath, 'utf8');

  if (content.includes(check.disallow)) {
    failures.push(`${check.file} still contains disallowed text: ${check.disallow}`);
  }
}

if (failures.length > 0) {
  console.error('Release config verification failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Release config verification passed for Akita and Pact workflows/docs.');
