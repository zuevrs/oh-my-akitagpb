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
      packageName: 'oh-my-pactgpb',
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
});

describe('runtime surface guards', () => {
  it('raises an explicit error when a catalog entry is missing', () => {
    expect(() => getAssetEntry(createAssetCatalog(), 'commands/pact-missing')).toThrowError(PackageSurfaceError);
  });

  it('fails fast on incomplete package metadata', () => {
    const packageRoot = mkdtempSync(path.join(tmpdir(), 'oh-my-pactgpb-bad-package-'));
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'broken-package',
        version: '0.0.0',
      }),
      'utf8',
    );

    expect(() => readPackageSurface(packageRoot)).toThrowError(PackageSurfaceError);
  });

  it('fails fast when compiled build output is missing', () => {
    const packageRoot = mkdtempSync(path.join(tmpdir(), 'oh-my-pactgpb-missing-build-'));
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'broken-package',
        version: '0.0.0',
        bin: {
          'oh-my-pactgpb': './dist/cli.js',
        },
      }),
      'utf8',
    );

    expect(() => assertBuildSurface(readPackageSurface(packageRoot))).toThrowError(PackageSurfaceError);
  });

  it('wraps fixture bootstrap failures with the fixture path context', () => {
    const parentFile = path.join(mkdtempSync(path.join(tmpdir(), 'oh-my-pactgpb-parent-')), 'not-a-directory');
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
