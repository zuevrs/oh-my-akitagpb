import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
  cwd: string | null;
  packageName?: string;
  packageVersion?: string;
  nextStep?: string;
  details?: Record<string, string>;
};

type InstallState = {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  projectMode: 'fresh' | 'resume';
  ownedFiles: Array<{ relativePath: string }>;
  managedSurfaces: Array<{ relativePath: string }>;
};

type ProjectModeRecord = {
  schemaVersion: 1;
  mode: 'fresh' | 'resume';
  reasons: string[];
};

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

describe('fresh install', () => {
  it('materializes the bootstrap surface, managed wiring, and install-state in a clean Java-service repo', () => {
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
    expect(realpathSync(result.cwd ?? '')).toBe(realpathSync(fixture.rootDir));
    expect(result.details?.projectMode).toBe('fresh');

    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');
    const projectModePath = path.join(fixture.rootDir, '.oma', 'runtime', 'local', 'project-mode.json');
    const opencodeConfigPath = path.join(fixture.rootDir, 'opencode.json');
    const agentsPath = path.join(fixture.rootDir, 'AGENTS.md');

    expect(realpathSync(result.details?.installStatePath ?? '')).toBe(realpathSync(installStatePath));
    expect(existsSync(installStatePath)).toBe(true);
    expect(existsSync(projectModePath)).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'capability-manifest.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'runtime', 'shared', 'version.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'runtime', 'shared', 'data-handling-policy.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'instructions', 'rules', 'default-language-russian.md'))).toBe(true);

    for (const commandId of ['akita-scan', 'akita-plan', 'akita-write', 'akita-validate', 'akita-promote']) {
      expect(existsSync(path.join(fixture.rootDir, '.opencode', 'commands', `${commandId}.md`))).toBe(true);
    }

    for (const workflowId of [
      'akita-scan-workflow',
      'akita-plan-workflow',
      'akita-write-workflow',
      'akita-validate-workflow',
      'akita-promote-workflow',
    ]) {
      expect(existsSync(path.join(fixture.rootDir, '.opencode', 'skills', workflowId, 'SKILL.md'))).toBe(true);
    }

    const installState = readJsonFile<InstallState>(installStatePath);
    expect(installState.projectMode).toBe('fresh');
    expect(installState.ownedFiles.some((file) => file.relativePath === '.opencode/commands/akita-scan.md')).toBe(true);
    expect(installState.ownedFiles.some((file) => file.relativePath === '.oma/runtime/local/project-mode.json')).toBe(true);
    expect(installState.managedSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'AGENTS.md' }),
        expect.objectContaining({ relativePath: 'opencode.json' }),
      ]),
    );

    const projectMode = readJsonFile<ProjectModeRecord>(projectModePath);
    expect(projectMode.mode).toBe('fresh');
    expect(projectMode.reasons).toEqual([]);

    const agentsContent = readFileSync(agentsPath, 'utf8');
    const installedScanCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-scan.md'), 'utf8');
    expect(agentsContent).toContain('<!-- oh-my-akitagpb:begin -->');
    expect(agentsContent).toContain('/akita-scan');
    expect(agentsContent).toContain('/akita-promote');
    expect(installedScanCommand).toContain('agent: build');
    expect(installedScanCommand).toContain('system under test');
    expect(installedScanCommand).toContain('OpenAPI and AsyncAPI');

    const opencodeConfig = readJsonFile<Record<string, unknown>>(opencodeConfigPath);
    expect(opencodeConfig.instructions).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        '.oma/instructions/rules/manifest-first.md',
        '.oma/instructions/rules/default-language-russian.md',
        '.oma/instructions/rules/respect-pack-ownership.md',
      ]),
    );
    expect(opencodeConfig.ohMyAkitaGpb).toBeUndefined();
  });

  it('preserves unrelated .opencode content and treats an empty AGENTS.md as safe bootstrap input', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const customCommandPath = path.join(fixture.rootDir, '.opencode', 'commands', 'custom.md');
    mkdirSync(path.dirname(customCommandPath), { recursive: true });
    writeFileSync(customCommandPath, 'user-owned command\n', 'utf8');
    writeFileSync(path.join(fixture.rootDir, 'AGENTS.md'), '   \n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(0);
    expect(result.reason).toBe('install-complete');
    expect(readFileSync(customCommandPath, 'utf8')).toBe('user-owned command\n');
    expect(readFileSync(path.join(fixture.rootDir, 'AGENTS.md'), 'utf8')).toContain('<!-- oh-my-akitagpb:begin -->');
  });

  it('blocks when AGENTS.md already contains user-owned instructions without pack markers', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    writeFileSync(path.join(fixture.rootDir, 'AGENTS.md'), '# existing human instructions\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'blocked',
      reason: 'install-user-owned-agents',
    });
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'install-state.json'))).toBe(false);
  });

  it('blocks on malformed opencode.json instead of guessing how to merge it', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    writeFileSync(path.join(fixture.rootDir, 'opencode.json'), '{\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'blocked',
      reason: 'install-malformed-opencode',
    });
    expect(result.nextStep).toContain('doctor');
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'install-state.json'))).toBe(false);
  });
});
