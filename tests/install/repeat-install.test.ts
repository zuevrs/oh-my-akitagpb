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

const fixtures: FixtureRepo[] = [];

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('repeat install', () => {
  it('blocks a second install and leaves drifted pack-owned files untouched until update is explicit', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const versionPath = path.join(fixture.rootDir, '.oma', 'runtime', 'shared', 'version.json');

    const first = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeFileSync(versionPath, '{"stale":true}\n', 'utf8');

    const secondExecution = invokeInstalledCli(fixture.rootDir, ['install']);
    const second = parseJsonOutput<CliResult>(secondExecution);

    expect(first).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(secondExecution.exitCode).toBe(2);
    expect(second).toMatchObject({
      subcommand: 'install',
      status: 'blocked',
      reason: 'install-already-initialized',
      details: expect.objectContaining({
        classification: 'resume',
      }),
    });
    expect(second.nextStep).toContain('update');
    expect(readFileSync(versionPath, 'utf8')).toBe('{"stale":true}\n');
  });

  it('refuses repeat install when managed surfaces exist but the install-state ledger is missing', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    rmSync(installStatePath);

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'blocked',
      reason: 'install-state-missing',
      details: expect.objectContaining({
        classification: 'conflict',
      }),
    });
    expect(existsSync(installStatePath)).toBe(false);
  });
});
