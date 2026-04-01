import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertBuildSurface,
  createAssetCatalog,
  getAssetEntry,
  PackageSurfaceError,
  readPackageSurface,
  SUPPORTED_SUBCOMMANDS,
} from '../../src/runtime/asset-catalog.js';
import {
  createFixtureRepo,
  createInstalledFixture,
  FixtureRepoError,
  type FixtureRepo,
  invokeInstalledCli,
  parseJsonOutput,
} from '../helpers/fixture-repo.js';

type CliResult = {
  subcommand: 'install' | 'update' | 'doctor' | 'unknown';
  status: 'ok' | 'blocked' | 'error';
  reason: string;
  cwd: string | null;
  packageName?: string;
  packageVersion?: string;
  availableSubcommands: readonly string[];
};

const fixtures: FixtureRepo[] = [];

function normalizeExistingPath(targetPath: string): string {
  return realpathSync(targetPath);
}

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('published CLI entrypoint', () => {
  it('invokes the installed bin from a disposable Java-service repo and performs a fresh install', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
      packageName: 'oh-my-akitagpb',
    });
    expect(result.packageVersion).toBeTruthy();
    expect(result.availableSubcommands).toEqual(SUPPORTED_SUBCOMMANDS);
    expect(normalizeExistingPath(result.cwd ?? '')).toBe(normalizeExistingPath(fixture.rootDir));
  });

  it('rejects an unknown subcommand with usage output instead of falling through', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const execution = invokeInstalledCli(fixture.rootDir, ['ship-it']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(1);
    expect(result).toMatchObject({
      subcommand: 'unknown',
      status: 'error',
      reason: 'unknown-subcommand',
    });
    expect(result.availableSubcommands).toEqual(SUPPORTED_SUBCOMMANDS);
    expect(normalizeExistingPath(result.cwd ?? '')).toBe(normalizeExistingPath(fixture.rootDir));
  });

  it('fails honestly when the requested working directory does not exist', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const missingPath = path.join(fixture.rootDir, 'missing-worktree');

    const execution = invokeInstalledCli(fixture.rootDir, ['doctor', '--cwd', missingPath]);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(1);
    expect(result).toMatchObject({
      subcommand: 'doctor',
      status: 'error',
      reason: 'working-directory-missing',
      cwd: missingPath,
    });
  });

  it('blocks update in empty and package-only fixture repos until install has created a trusted ledger', () => {
    for (const template of ['empty', 'package-only'] as const) {
      const fixture = trackFixture(createInstalledFixture({ template }));

      const execution = invokeInstalledCli(fixture.rootDir, ['update']);
      const result = parseJsonOutput<CliResult>(execution);

      expect(execution.exitCode).toBe(2);
      expect(result).toMatchObject({
        subcommand: 'update',
        status: 'blocked',
        reason: 'update-not-initialized',
      });
      expect(normalizeExistingPath(result.cwd ?? '')).toBe(normalizeExistingPath(fixture.rootDir));
    }
  });

  it('blocks a second install in the same fixture instead of silently refreshing managed surfaces', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const first = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    const second = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    expect(first).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(second).toMatchObject({
      subcommand: 'install',
      status: 'blocked',
      reason: 'install-already-initialized',
    });
    expect(second.packageVersion).toBe(first.packageVersion);
  });
});

describe('runtime surface guards', () => {
  it('raises an explicit error when a catalog entry is missing', () => {
    try {
      getAssetEntry(createAssetCatalog(), 'commands/akita-missing');
      throw new Error('expected getAssetEntry to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PackageSurfaceError);
      expect((error as PackageSurfaceError).code).toBe('asset-catalog-missing-entry');
    }
  });

  it('fails fast on incomplete package metadata', () => {
    const packageRoot = mkdtempSync(path.join(tmpdir(), 'oh-my-akitagpb-bad-package-'));
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'broken-package',
        version: '0.0.0',
      }),
      'utf8',
    );

    try {
      readPackageSurface(packageRoot);
      throw new Error('expected readPackageSurface to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PackageSurfaceError);
      expect((error as PackageSurfaceError).code).toBe('package-bin-missing');
    }
  });

  it('fails fast when compiled build output is missing', () => {
    const packageRoot = mkdtempSync(path.join(tmpdir(), 'oh-my-akitagpb-missing-build-'));
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'broken-package',
        version: '0.0.0',
        bin: {
          'oh-my-akitagpb': './dist/cli.js',
        },
      }),
      'utf8',
    );

    try {
      assertBuildSurface(readPackageSurface(packageRoot));
      throw new Error('expected assertBuildSurface to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PackageSurfaceError);
      expect((error as PackageSurfaceError).code).toBe('build-output-missing');
    }
  });

  it('wraps fixture bootstrap failures with the fixture path context', () => {
    const parentFile = path.join(mkdtempSync(path.join(tmpdir(), 'oh-my-akitagpb-parent-')), 'not-a-directory');
    writeFileSync(parentFile, 'x', 'utf8');

    try {
      createFixtureRepo({ parentDir: path.join(parentFile, 'child-') });
      throw new Error('expected createFixtureRepo to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FixtureRepoError);
      expect((error as FixtureRepoError).code).toBe('fixture-setup-failed');
    }
  });
});
