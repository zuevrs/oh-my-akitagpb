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
const siblingPackageRoot = path.resolve(import.meta.dirname, '..', '..', '..', 'oh-my-pactgpb');
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

  const packDestination = mkdtempSync(path.join(tmpdir(), 'oh-my-pactgpb-pack-'));
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
  return runCommand('npx', ['oh-my-pactgpb', ...args], fixtureRoot, false);
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('co-install safety', () => {
  it('supports install order akita then pact without pack-owned path collisions', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const akitaInstall = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    installSiblingPackage(fixture.rootDir);
    const pactInstall = parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['install']));
    const akitaDoctor = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['doctor']));
    const pactDoctor = parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['doctor']));
    const agentsContent = readFileSync(path.join(fixture.rootDir, 'AGENTS.md'), 'utf8');
    const opencodeConfig = JSON.parse(readFileSync(path.join(fixture.rootDir, 'opencode.json'), 'utf8')) as {
      instructions?: string[];
    };

    expect(akitaInstall).toMatchObject({ status: 'ok', reason: 'install-complete' });
    expect(pactInstall).toMatchObject({ status: 'ok', reason: 'install-complete' });
    expect(akitaDoctor).toMatchObject({ status: 'ok', reason: 'doctor-compatible' });
    expect(pactDoctor).toMatchObject({ status: 'ok', reason: 'doctor-compatible' });

    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'install-state.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'install-state.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'templates', 'write', 'state-contract.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json'))).toBe(true);

    expect(agentsContent).toContain('<!-- oh-my-akitagpb:begin -->');
    expect(agentsContent).toContain('<!-- oh-my-pactgpb:begin -->');
    expect(opencodeConfig.instructions ?? []).toEqual(
      expect.arrayContaining([
        '.oma/packs/oh-my-akitagpb/instructions/rules/manifest-first.md',
        '.oma/packs/oh-my-pactgpb/instructions/rules/manifest-first.md',
      ]),
    );
  });

  it('keeps pact-owned runtime files untouched when akita update refreshes only akita-owned state', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    installSiblingPackage(fixture.rootDir);
    parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['install']));

    const akitaVersionPath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'runtime', 'shared', 'version.json');
    const pactManifestPath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'capability-manifest.json');
    const pactVersionPath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'runtime', 'shared', 'version.json');
    const pactTemplatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json');
    const pactManifestBefore = readFileSync(pactManifestPath, 'utf8');
    const pactVersionBefore = readFileSync(pactVersionPath, 'utf8');
    const pactTemplateBefore = readFileSync(pactTemplatePath, 'utf8');

    writeFileSync(akitaVersionPath, '{"stale":true}\n', 'utf8');

    const akitaUpdate = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['update']));
    const pactDoctor = parseJsonOutput<CliResult>(invokeSiblingCli(fixture.rootDir, ['doctor']));

    expect(akitaUpdate).toMatchObject({
      subcommand: 'update',
      status: 'ok',
      reason: 'update-complete',
    });
    expect(akitaUpdate.details?.changedPaths ?? '').toContain('.oma/packs/oh-my-akitagpb/runtime/shared/version.json');
    expect(readFileSync(pactManifestPath, 'utf8')).toBe(pactManifestBefore);
    expect(readFileSync(pactVersionPath, 'utf8')).toBe(pactVersionBefore);
    expect(readFileSync(pactTemplatePath, 'utf8')).toBe(pactTemplateBefore);
    expect(pactDoctor).toMatchObject({ status: 'ok', reason: 'doctor-compatible' });
  });
});
