import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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
  details?: Record<string, string>;
};

const fixtures: FixtureRepo[] = [];
const siblingPackageRoot = path.resolve(import.meta.dirname, '..', '..', '..', 'oh-my-akitagpb');
let siblingTarballPath: string | undefined;

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function runCommand(command: string, args: string[], cwd: string, rejectOnNonZero: boolean = true) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  const execution = {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };

  if (rejectOnNonZero && execution.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${execution.stderr || execution.stdout}`);
  }

  return execution;
}

function packSiblingPackage(): string {
  if (siblingTarballPath && existsSync(siblingTarballPath)) {
    return siblingTarballPath;
  }

  const packDestination = mkdtempSync(path.join(tmpdir(), 'oh-my-akitagpb-pack-'));
  const execution = runCommand('npm', ['pack', '--json', '--pack-destination', packDestination], siblingPackageRoot);
  const parsed = JSON.parse(execution.stdout) as Array<{ filename?: string }>;
  const filename = parsed[0]?.filename;
  if (!filename) {
    throw new Error('npm pack did not return a sibling tarball filename.');
  }

  siblingTarballPath = path.join(packDestination, filename);
  return siblingTarballPath;
}

function installSiblingPackage(fixtureRoot: string) {
  return runCommand('npm', ['install', '--no-fund', '--no-audit', '-D', packSiblingPackage()], fixtureRoot);
}

function invokeSiblingCli(fixtureRoot: string, args: readonly string[]) {
  return runCommand('npx', ['oh-my-akitagpb', ...args], fixtureRoot, false);
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('co-install safety', () => {
  it('supports install order pact then akita without pack-owned path collisions', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const pactInstall = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    installSiblingPackage(fixture.rootDir);
    const akitaInstall = parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['install']));
    const pactDoctor = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['doctor']));
    const akitaDoctor = parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['doctor']));
    const agentsContent = readFileSync(path.join(fixture.rootDir, 'AGENTS.md'), 'utf8');
    const opencodeConfig = JSON.parse(readFileSync(path.join(fixture.rootDir, 'opencode.json'), 'utf8')) as {
      instructions?: string[];
    };

    expect(pactInstall).toMatchObject({ status: 'ok', reason: 'install-complete' });
    expect(akitaInstall).toMatchObject({ status: 'ok', reason: 'install-complete' });
    expect(pactDoctor).toMatchObject({ status: 'ok', reason: 'doctor-compatible' });
    expect(akitaDoctor).toMatchObject({ status: 'ok', reason: 'doctor-compatible' });

    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'install-state.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'install-state.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'templates', 'write', 'state-contract.json'))).toBe(true);

    expect(agentsContent).toContain('<!-- oh-my-pactgpb:begin -->');
    expect(agentsContent).toContain('<!-- oh-my-akitagpb:begin -->');
    expect(opencodeConfig.instructions ?? []).toEqual(
      expect.arrayContaining([
        '.oma/packs/oh-my-pactgpb/instructions/rules/manifest-first.md',
        '.oma/packs/oh-my-akitagpb/instructions/rules/manifest-first.md',
      ]),
    );
  });

  it('keeps akita-owned runtime files untouched when pact update refreshes only pact-owned state', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    installSiblingPackage(fixture.rootDir);
    parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['install']));

    const pactVersionPath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'runtime', 'shared', 'version.json');
    const akitaManifestPath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'capability-manifest.json');
    const akitaVersionPath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'runtime', 'shared', 'version.json');
    const akitaTemplatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'templates', 'write', 'state-contract.json');
    const akitaManifestBefore = readFileSync(akitaManifestPath, 'utf8');
    const akitaVersionBefore = readFileSync(akitaVersionPath, 'utf8');
    const akitaTemplateBefore = readFileSync(akitaTemplatePath, 'utf8');

    writeFileSync(pactVersionPath, '{"stale":true}\n', 'utf8');

    const pactUpdate = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['update']));
    const akitaDoctor = parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['doctor']));

    expect(pactUpdate).toMatchObject({
      subcommand: 'update',
      status: 'ok',
      reason: 'update-complete',
    });
    expect(pactUpdate.details?.changedPaths ?? '').toContain('.oma/packs/oh-my-pactgpb/runtime/shared/version.json');
    expect(readFileSync(akitaManifestPath, 'utf8')).toBe(akitaManifestBefore);
    expect(readFileSync(akitaVersionPath, 'utf8')).toBe(akitaVersionBefore);
    expect(readFileSync(akitaTemplatePath, 'utf8')).toBe(akitaTemplateBefore);
    expect(akitaDoctor).toMatchObject({ status: 'ok', reason: 'doctor-compatible' });
  });
});
