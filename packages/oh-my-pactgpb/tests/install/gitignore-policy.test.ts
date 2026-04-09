import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

type InstallState = {
  managedSurfaces: Array<{ relativePath: string }>;
};

const fixtures: FixtureRepo[] = [];

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function runGit(cwd: string, args: string[], rejectOnNonZero: boolean = true) {
  const result = spawnSync('git', args, {
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
    throw new Error(`git ${args.join(' ')} failed: ${execution.stderr || execution.stdout}`);
  }

  return execution;
}

function initGitRepo(rootDir: string): void {
  runGit(rootDir, ['init', '-q']);
}

function ensureFile(rootDir: string, relativePath: string, content: string): void {
  const absolutePath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function isIgnored(rootDir: string, relativePath: string): boolean {
  const execution = runGit(rootDir, ['check-ignore', '-q', relativePath], false);
  return execution.exitCode === 0;
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('gitignore policy materialization', () => {
  it('materializes a managed .gitignore block that preserves user rules, unignores durable pack surfaces, and ignores local/generated state', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const gitignorePath = path.join(fixture.rootDir, '.gitignore');
    const installStatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'install-state.json');

    writeFileSync(gitignorePath, '.oma/\n.opencode/\n*.md\n*.json\ncustom-user-ignore/\n', 'utf8');
    initGitRepo(fixture.rootDir);

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);
    const installState = readJsonFile<InstallState>(installStatePath);
    const gitignoreContent = readFileSync(gitignorePath, 'utf8');

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(existsSync(gitignorePath)).toBe(true);
    expect(installState.managedSurfaces.some((surface) => surface.relativePath === '.gitignore')).toBe(true);
    expect(gitignoreContent).toContain('.oma/\n.opencode/\n*.md\n*.json\ncustom-user-ignore/\n');
    expect(gitignoreContent).toContain('# oh-my-pactgpb:begin');
    expect(gitignoreContent).toContain('# oh-my-pactgpb:end');
    expect(gitignoreContent).toContain('.oma/packs/oh-my-pactgpb/install-state.json');
    expect(gitignoreContent).toContain('.oma/packs/oh-my-pactgpb/generated/');
    expect(gitignoreContent).toContain('!.oma/packs/oh-my-pactgpb/state/shared/**');

    ensureFile(fixture.rootDir, '.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json', '{"scan":true}\n');
    ensureFile(fixture.rootDir, '.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json', '{"plan":true}\n');
    ensureFile(fixture.rootDir, '.oma/packs/oh-my-pactgpb/state/shared/write/write-state.json', '{"write":true}\n');
    ensureFile(fixture.rootDir, '.oma/packs/oh-my-pactgpb/state/local/doctor/debug.json', '{"doctor":true}\n');
    ensureFile(fixture.rootDir, '.oma/packs/oh-my-pactgpb/generated/features/example.feature', 'Feature: staged\n');

    for (const relativePath of [
      'AGENTS.md',
      'opencode.json',
      '.opencode/commands/pact-scan.md',
      '.opencode/commands/pact-plan.md',
      '.opencode/commands/pact-write.md',
      '.opencode/skills/pact-scan-workflow/SKILL.md',
      '.opencode/skills/pact-plan-workflow/SKILL.md',
      '.opencode/skills/pact-write-workflow/SKILL.md',
      '.oma/packs/oh-my-pactgpb/capability-manifest.json',
      '.oma/packs/oh-my-pactgpb/runtime/shared/version.json',
      '.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json',
      '.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json',
      '.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json',
      '.oma/packs/oh-my-pactgpb/state/shared/write/write-state.json',
    ]) {
      expect(isIgnored(fixture.rootDir, relativePath), relativePath).toBe(false);
    }

    for (const relativePath of [
      '.oma/packs/oh-my-pactgpb/install-state.json',
      '.oma/packs/oh-my-pactgpb/runtime/local/project-mode.json',
      '.oma/packs/oh-my-pactgpb/state/local/doctor/debug.json',
      '.oma/packs/oh-my-pactgpb/generated/features/example.feature',
    ]) {
      expect(isIgnored(fixture.rootDir, relativePath), relativePath).toBe(true);
    }
  });

  it('update restores the managed .gitignore block without deleting user-owned ignore rules', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const gitignorePath = path.join(fixture.rootDir, '.gitignore');

    initGitRepo(fixture.rootDir);
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    writeFileSync(gitignorePath, '.oma/\ncustom-user-ignore/\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['update']);
    const result = parseJsonOutput<CliResult>(execution);
    const gitignoreContent = readFileSync(gitignorePath, 'utf8');

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'update',
      status: 'ok',
      reason: 'update-complete',
    });
    expect(result.details?.changedPaths ?? '').toContain('.gitignore');
    expect(gitignoreContent).toContain('.oma/\ncustom-user-ignore/\n');
    expect(gitignoreContent).toContain('# oh-my-pactgpb:begin');
    expect(gitignoreContent).toContain('.oma/packs/oh-my-pactgpb/generated/');
    expect(isIgnored(fixture.rootDir, 'AGENTS.md')).toBe(false);
    expect(isIgnored(fixture.rootDir, '.oma/packs/oh-my-pactgpb/install-state.json')).toBe(true);
  });

  it('blocks update on malformed managed .gitignore markers instead of rewriting the file destructively', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const gitignorePath = path.join(fixture.rootDir, '.gitignore');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeFileSync(gitignorePath, '# oh-my-pactgpb:begin\n.oma/packs/oh-my-pactgpb/generated/\n', 'utf8');

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
    expect(result.details?.refusedPaths ?? '').toContain('.gitignore');
    expect(readFileSync(gitignorePath, 'utf8')).toBe('# oh-my-pactgpb:begin\n.oma/packs/oh-my-pactgpb/generated/\n');
  });
});
