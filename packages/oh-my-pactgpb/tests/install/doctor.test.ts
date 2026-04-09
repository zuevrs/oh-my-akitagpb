import { existsSync, readFileSync, rmSync } from 'node:fs';
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

type DoctorReport = {
  status: 'compatible' | 'migrate-required' | 'blocked';
  reason: string;
  nextStep: string;
  compatibility: {
    detectedProjectMode: 'fresh' | 'resume';
    installedPackageVersion: string | null;
  };
  runtime: {
    installStateStatus: 'missing' | 'valid' | 'invalid';
    projectModeRecordStatus: 'missing' | 'valid' | 'invalid';
  };
  ownership: {
    conflicts: string[];
  };
  drift: {
    packageVersionMismatch: boolean;
    ownedModified: string[];
    ownedMissing: string[];
    managedModified: string[];
  };
  findings: Array<{ code: string; severity: 'info' | 'warning' | 'error' }>;
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

describe('doctor diagnostics', () => {
  it('writes a migrate-required report for a fresh repo that has not been bootstrapped yet', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const execution = invokeInstalledCli(fixture.rootDir, ['doctor']);
    const result = parseJsonOutput<CliResult>(execution);
    const report = readJsonFile<DoctorReport>(result.details?.reportPath ?? '');

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'doctor',
      status: 'ok',
      reason: 'doctor-migrate-required',
    });
    expect(report.status).toBe('migrate-required');
    expect(report.reason).toBe('install-required');
    expect(report.nextStep).toContain('install');
    expect(report.compatibility.detectedProjectMode).toBe('fresh');
    expect(report.runtime.installStateStatus).toBe('missing');
    expect(report.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'install-required', severity: 'info' })]),
    );
  });

  it('writes a compatible report for a healthy installed repo with no ownership drift', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    const execution = invokeInstalledCli(fixture.rootDir, ['doctor']);
    const result = parseJsonOutput<CliResult>(execution);
    const report = readJsonFile<DoctorReport>(result.details?.reportPath ?? '');

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'doctor',
      status: 'ok',
      reason: 'doctor-compatible',
    });
    expect(report.status).toBe('compatible');
    expect(report.runtime.installStateStatus).toBe('valid');
    expect(report.runtime.projectModeRecordStatus).toBe('valid');
    expect(report.ownership.conflicts).toEqual([]);
    expect(report.drift).toEqual({
      packageVersionMismatch: false,
      ownedModified: [],
      ownedMissing: [],
      managedModified: [],
    });
  });

  it('writes a blocked report when managed surfaces exist but the install-state ledger is missing', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const installStatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'install-state.json');

    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    rmSync(installStatePath);

    const execution = invokeInstalledCli(fixture.rootDir, ['doctor']);
    const result = parseJsonOutput<CliResult>(execution);
    const report = readJsonFile<DoctorReport>(result.details?.reportPath ?? '');

    expect(execution.exitCode).toBe(2);
    expect(result).toMatchObject({
      subcommand: 'doctor',
      status: 'blocked',
      reason: 'doctor-blocked',
    });
    expect(report.status).toBe('blocked');
    expect(report.reason).toBe('install-state-missing');
    expect(report.runtime.installStateStatus).toBe('missing');
    expect(report.ownership.conflicts).toEqual([]);
    expect(report.nextStep).toContain('install-state');
    expect(report.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'install-state-missing', severity: 'error' })]),
    );
    expect(existsSync(result.details?.reportPath ?? '')).toBe(true);
  });
});
