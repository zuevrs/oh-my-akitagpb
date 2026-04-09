import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  nextStep?: string;
  details?: Record<string, string>;
};

type InstallState = {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  projectMode: 'fresh' | 'resume';
  ownedFiles: Array<{ kind: string; relativePath: string }>;
  managedSurfaces: Array<{ relativePath: string }>;
};

type CapabilityManifest = {
  activeCapabilityBundles: Array<{
    bundleId: string;
    skillPath: string;
    references: Record<string, string>;
  }>;
};

const fixtures: FixtureRepo[] = [];
const packageVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function listBundleRuntimePaths(manifest: CapabilityManifest): string[] {
  return manifest.activeCapabilityBundles.flatMap((bundle) => [bundle.skillPath, ...Object.values(bundle.references)]);
}

const languageRuleRuntimePath = '.oma/instructions/rules/default-language-russian.md';
const summaryRuntimePaths = [
  '.oma/templates/scan/scan-summary.md',
  '.oma/templates/plan/plan-summary.md',
  '.oma/templates/write/write-summary.md',
  '.oma/templates/validate/validate-summary.md',
] as const;
const promoteRuntimePaths = [
  '.opencode/commands/akita-promote.md',
  '.opencode/skills/akita-promote-workflow/SKILL.md',
  '.oma/templates/promote/state-contract.json',
  '.oma/templates/promote/promote-summary.md',
] as const;

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('update ownership', () => {
  it('refreshes recorded pack-owned artifacts and preserves unrelated user content', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const versionPath = path.join(fixture.rootDir, '.oma', 'runtime', 'shared', 'version.json');
    const agentsPath = path.join(fixture.rootDir, 'AGENTS.md');
    const opencodePath = path.join(fixture.rootDir, 'opencode.json');
    const customCommandPath = path.join(fixture.rootDir, '.opencode', 'commands', 'custom.md');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    writeFileSync(customCommandPath, 'user-owned command\n', 'utf8');
    writeFileSync(versionPath, '{"stale":true}\n', 'utf8');
    writeFileSync(
      agentsPath,
      readFileSync(agentsPath, 'utf8').replace('/akita-scan', '/akita-broken'),
      'utf8',
    );

    const opencodeConfig = readJsonFile<Record<string, unknown>>(opencodePath);
    const instructions = Array.isArray(opencodeConfig.instructions)
      ? opencodeConfig.instructions.filter((entry): entry is string => typeof entry === 'string')
      : [];
    opencodeConfig.instructions = instructions.filter(
      (entry) =>
        entry !== '.oma/instructions/rules/respect-pack-ownership.md' &&
        entry !== '.oma/instructions/rules/default-language-russian.md',
    );
    opencodeConfig.customSetting = 'keep-me';
    writeFileSync(opencodePath, `${JSON.stringify(opencodeConfig, null, 2)}\n`, 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'ok',
      reason: 'update-complete',
      details: expect.objectContaining({
        classification: 'update-required',
        refusedCount: '0',
      }),
    });
    expect(result.details?.changedPaths ?? '').toContain('.oma/runtime/shared/version.json');
    expect(result.details?.changedPaths ?? '').toContain('AGENTS.md');
    expect(result.details?.changedPaths ?? '').toContain('opencode.json');

    expect(readFileSync(versionPath, 'utf8')).toContain(`"packageVersion": "${packageVersion}"`);
    expect(readFileSync(agentsPath, 'utf8')).toContain('/akita-scan');
    expect(readJsonFile<Record<string, unknown>>(opencodePath)).toEqual(
      expect.objectContaining({
        customSetting: 'keep-me',
      }),
    );
    expect(readJsonFile<Record<string, unknown>>(opencodePath).instructions).toEqual(
      expect.arrayContaining([
        '.oma/instructions/rules/respect-pack-ownership.md',
        '.oma/instructions/rules/default-language-russian.md',
      ]),
    );
    expect(readFileSync(customCommandPath, 'utf8')).toBe('user-owned command\n');
  });

  it('backfills newly shipped language, summary, and promote assets during update when an older install ledger does not record them yet', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const installState = readJsonFile<InstallState>(installStatePath);
    const backfillRuntimePaths = [languageRuleRuntimePath, ...summaryRuntimePaths, ...promoteRuntimePaths];
    installState.ownedFiles = installState.ownedFiles.filter(
      (file) => !backfillRuntimePaths.includes(file.relativePath as (typeof backfillRuntimePaths)[number]),
    );
    writeFileSync(installStatePath, `${JSON.stringify(installState, null, 2)}\n`, 'utf8');

    for (const runtimePath of backfillRuntimePaths) {
      rmSync(path.join(fixture.rootDir, runtimePath));
    }

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);
    const updatedInstallState = readJsonFile<InstallState>(installStatePath);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'ok',
      reason: 'update-complete',
      details: expect.objectContaining({
        refusedCount: '0',
      }),
    });

    for (const runtimePath of backfillRuntimePaths) {
      expect(existsSync(path.join(fixture.rootDir, runtimePath)), runtimePath).toBe(true);
      expect(updatedInstallState.ownedFiles.some((file) => file.relativePath === runtimePath), runtimePath).toBe(true);
      expect(result.details?.changedPaths ?? '').toContain(runtimePath);
    }
  });

  it('adds manifest-listed capability bundle files during update when an older install ledger does not record them yet', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const manifestPath = path.join(fixture.rootDir, '.oma', 'capability-manifest.json');
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    const capabilityRuntimePaths = listBundleRuntimePaths(manifest);
    const installState = readJsonFile<InstallState>(installStatePath);
    installState.ownedFiles = installState.ownedFiles.filter(
      (file) => !capabilityRuntimePaths.includes(file.relativePath),
    );
    writeFileSync(installStatePath, `${JSON.stringify(installState, null, 2)}\n`, 'utf8');

    for (const runtimePath of capabilityRuntimePaths) {
      rmSync(path.join(fixture.rootDir, runtimePath));
    }

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);
    const updatedInstallState = readJsonFile<InstallState>(installStatePath);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'ok',
      reason: 'update-complete',
      details: expect.objectContaining({
        refusedCount: '0',
      }),
    });
    expect(result.details?.changedPaths ?? '').toContain(capabilityRuntimePaths[0] ?? '');

    for (const runtimePath of capabilityRuntimePaths) {
      expect(existsSync(path.join(fixture.rootDir, runtimePath)), runtimePath).toBe(true);
      expect(updatedInstallState.ownedFiles.some((file) => file.relativePath === runtimePath), runtimePath).toBe(true);
    }
  });

  it('blocks when a newly planned capability bundle file already exists with drifted content', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const manifestPath = path.join(fixture.rootDir, '.oma', 'capability-manifest.json');
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    const driftedPath = manifest.activeCapabilityBundles[0]?.skillPath;
    const installState = readJsonFile<InstallState>(installStatePath);
    installState.ownedFiles = installState.ownedFiles.filter((file) => file.relativePath !== driftedPath);
    writeFileSync(installStatePath, `${JSON.stringify(installState, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(fixture.rootDir, driftedPath ?? '.opencode/skills/unknown/SKILL.md'), '# drifted\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'blocked',
      reason: 'update-ownership-conflict',
      details: expect.objectContaining({
        classification: 'conflict',
      }),
    });
    expect(result.details?.refusedPaths ?? '').toContain(driftedPath ?? '');
    expect(readFileSync(path.join(fixture.rootDir, driftedPath ?? '.opencode/skills/unknown/SKILL.md'), 'utf8')).toBe('# drifted\n');
  });

  it('reports a no-op update once the recorded pack-owned artifacts already match the explicit update shape', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['update']));

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'ok',
      reason: 'update-noop',
      details: expect.objectContaining({
        changedCount: '0',
        refusedCount: '0',
      }),
    });
    expect(Number(result.details?.unchangedCount ?? '0')).toBeGreaterThan(0);
  });

  it('blocks on corrupt install-state JSON instead of guessing ownership', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeFileSync(installStatePath, '{\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'blocked',
      reason: 'install-state-invalid',
      details: expect.objectContaining({
        classification: 'blocked',
      }),
    });
  });

  it('blocks on unknown ownership entries in the install-state ledger', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    const installState = readJsonFile<InstallState>(installStatePath);
    installState.ownedFiles[0] = {
      kind: 'mystery',
      relativePath: installState.ownedFiles[0]?.relativePath ?? '.oma/runtime/shared/version.json',
    };
    writeFileSync(installStatePath, `${JSON.stringify(installState, null, 2)}\n`, 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'blocked',
      reason: 'install-state-invalid',
      details: expect.objectContaining({
        classification: 'blocked',
      }),
    });
  });

  it('blocks when a recorded pack-owned file is missing', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const versionPath = path.join(fixture.rootDir, '.oma', 'runtime', 'shared', 'version.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    rmSync(versionPath);

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'blocked',
      reason: 'update-ownership-conflict',
      details: expect.objectContaining({
        classification: 'conflict',
      }),
    });
    expect(result.details?.refusedPaths ?? '').toContain('.oma/runtime/shared/version.json');
    expect(existsSync(versionPath)).toBe(false);
  });

  it('blocks when a managed surface no longer presents a safe managed shape', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const agentsPath = path.join(fixture.rootDir, 'AGENTS.md');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeFileSync(agentsPath, '# human-owned replacement\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'blocked',
      reason: 'update-ownership-conflict',
      details: expect.objectContaining({
        classification: 'conflict',
      }),
    });
    expect(result.details?.refusedPaths ?? '').toContain('AGENTS.md');
    expect(readFileSync(agentsPath, 'utf8')).toBe('# human-owned replacement\n');
  });
});
