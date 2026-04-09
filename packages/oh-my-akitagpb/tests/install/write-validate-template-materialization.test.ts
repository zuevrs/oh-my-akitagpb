import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createAssetCatalog, getAssetEntry } from '../../src/runtime/asset-catalog.js';
import {
  createInstalledFixture,
  type FixtureRepo,
  invokeInstalledCli,
  parseJsonOutput,
} from '../helpers/fixture-repo.js';

type CliResult = {
  subcommand: 'install' | 'update' | 'doctor' | 'unknown';
  status: 'ok' | 'blocked' | 'error';
  reason: string;
};

type InstallState = {
  schemaVersion: 1;
  ownedFiles: Array<{ relativePath: string }>;
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const fixtures: FixtureRepo[] = [];

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('write and validate template materialization', () => {
  it('keeps the shipped write and validate template assets registered in the package asset catalog', () => {
    const catalog = createAssetCatalog(repoRoot);
    const expectedAssetEntries = {
      'oma/templates/write/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'write', 'state-contract.json'),
      'oma/templates/write/write-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'write', 'write-summary.md'),
      'oma/templates/validate/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'validate', 'state-contract.json'),
      'oma/templates/validate/validate-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'validate', 'validate-summary.md'),
    } as const;

    for (const [assetKey, expectedPath] of Object.entries(expectedAssetEntries)) {
      const assetPath = getAssetEntry(catalog, assetKey);
      expect(assetPath).toBe(expectedPath);
      expect(existsSync(assetPath)).toBe(true);
    }
  });

  it('materializes the write and validate contract templates on fresh install without claiming unrelated template files', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const userTemplatePath = path.join(fixture.rootDir, '.oma', 'templates', 'user-notes', 'README.md');
    mkdirSync(path.dirname(userTemplatePath), { recursive: true });
    writeFileSync(userTemplatePath, 'user-owned template notes\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');
    const installState = readJsonFile<InstallState>(installStatePath);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });

    for (const relativePath of [
      '.oma/templates/write/state-contract.json',
      '.oma/templates/write/write-summary.md',
      '.oma/templates/validate/state-contract.json',
      '.oma/templates/validate/validate-summary.md',
    ]) {
      expect(existsSync(path.join(fixture.rootDir, relativePath)), relativePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === relativePath), relativePath).toBe(true);
    }

    expect(readFileSync(userTemplatePath, 'utf8')).toBe('user-owned template notes\n');
    expect(installState.ownedFiles.some((file) => file.relativePath === '.oma/templates/user-notes/README.md')).toBe(false);
  });
});
