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

describe('scan template materialization', () => {
  it('keeps the shipped scan assets registered in the package asset catalog', () => {
    const catalog = createAssetCatalog(repoRoot);
    const expectedAssetEntries = {
      'commands/pact-scan': path.join(repoRoot, 'assets', 'commands', 'pact-scan.md'),
      'opencode/skills/pact-scan-workflow': path.join(repoRoot, 'assets', 'opencode', 'skills', 'pact-scan-workflow', 'SKILL.md'),
      'oma/templates/scan/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'scan', 'state-contract.json'),
      'oma/templates/scan/scan-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'scan', 'scan-summary.md'),
    } as const;

    for (const [assetKey, expectedPath] of Object.entries(expectedAssetEntries)) {
      const assetPath = getAssetEntry(catalog, assetKey);
      expect(assetPath).toBe(expectedPath);
      expect(existsSync(assetPath)).toBe(true);
    }
  });

  it('materializes the scan contract templates on fresh install without claiming unrelated template files', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const userTemplatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'user-notes', 'README.md');
    mkdirSync(path.dirname(userTemplatePath), { recursive: true });
    writeFileSync(userTemplatePath, 'user-owned template notes\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);
    const installStatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'install-state.json');
    const installState = readJsonFile<InstallState>(installStatePath);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });

    for (const relativePath of [
      '.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json',
      '.oma/packs/oh-my-pactgpb/templates/scan/scan-summary.md',
    ]) {
      expect(existsSync(path.join(fixture.rootDir, relativePath)), relativePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === relativePath), relativePath).toBe(true);
    }

    const installedScanContract = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json'), 'utf8');
    const installedScanSummary = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'scan-summary.md'), 'utf8');

    expect(installedScanContract).toContain('provider');
    expect(installedScanContract).toContain('artifactSource');
    expect(installedScanSummary).toContain('## Summary');
    expect(installedScanSummary).toContain('### Provider under contract');
    expect(installedScanSummary).toContain('### Main blockers');

    expect(readFileSync(userTemplatePath, 'utf8')).toBe('user-owned template notes\n');
    expect(installState.ownedFiles.some((file) => file.relativePath === '.oma/packs/oh-my-pactgpb/templates/user-notes/README.md')).toBe(false);
  });
});
