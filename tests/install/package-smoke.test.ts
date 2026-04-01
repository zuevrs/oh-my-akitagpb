import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFixtureRepo,
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
  ownedFiles: Array<{ relativePath: string }>;
};

type CapabilityManifest = {
  activeCapabilityBundles: Array<{
    skillPath: string;
    references: Record<string, string>;
  }>;
};

const fixtures: FixtureRepo[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('package smoke fixture', () => {
  it('copies the plain Java fixture template from disk', () => {
    const fixture = trackFixture(createFixtureRepo({ template: 'java-service' }));
    const fixturePom = readFileSync(path.join(fixture.rootDir, 'pom.xml'), 'utf8');
    const sourcePom = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'empty-java-service', 'pom.xml'), 'utf8');

    expect(fixturePom).toBe(sourcePom);
    expect(fixturePom).toContain('<artifactId>fixture-java-service</artifactId>');
  });

  it('proves the published tarball can install and diagnose a plain Java fixture repo with write/validate surfaces', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const installExecution = invokeInstalledCli(fixture.rootDir, ['install']);
    const installResult = parseJsonOutput<CliResult>(installExecution);
    const doctorExecution = invokeInstalledCli(fixture.rootDir, ['doctor']);
    const doctorResult = parseJsonOutput<CliResult>(doctorExecution);
    const manifestPath = path.join(fixture.rootDir, '.oma', 'capability-manifest.json');
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');
    const opencodeConfigPath = path.join(fixture.rootDir, 'opencode.json');
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    const installState = readJsonFile<InstallState>(installStatePath);
    const opencodeConfig = readJsonFile<Record<string, unknown>>(opencodeConfigPath);
    const requiredInstalledPaths = [
      '.opencode/commands/akita-scan.md',
      '.opencode/commands/akita-plan.md',
      '.opencode/commands/akita-write.md',
      '.opencode/commands/akita-validate.md',
      '.opencode/skills/akita-scan-workflow/SKILL.md',
      '.opencode/skills/akita-plan-workflow/SKILL.md',
      '.opencode/skills/akita-write-workflow/SKILL.md',
      '.opencode/skills/akita-validate-workflow/SKILL.md',
      '.oma/templates/feature/default.feature.md',
      '.oma/templates/feature/with-background.feature.md',
      '.oma/templates/feature/with-omissions-note.feature.md',
      '.oma/templates/payload/json-body.md',
      '.oma/templates/payload/property-file.md',
      '.oma/templates/payload/minimal-fixture.md',
      '.oma/templates/scan/state-contract.json',
      '.oma/templates/plan/state-contract.json',
      '.oma/templates/write/state-contract.json',
      '.oma/templates/validate/state-contract.json',
    ];

    expect(installExecution.exitCode).toBe(0);
    expect(installResult).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(doctorExecution.exitCode).toBe(0);
    expect(doctorResult).toMatchObject({
      subcommand: 'doctor',
      status: 'ok',
      reason: 'doctor-compatible',
    });

    expect(existsSync(path.join(fixture.rootDir, 'pom.xml'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'install-state.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'runtime', 'local', 'project-mode.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'state', 'local', 'doctor', 'doctor-report.json'))).toBe(true);
    expect(opencodeConfig.ohMyAkitaGpb).toBeUndefined();

    for (const relativePath of requiredInstalledPaths) {
      expect(existsSync(path.join(fixture.rootDir, relativePath)), relativePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === relativePath), relativePath).toBe(true);
    }

    for (const runtimePath of listBundleRuntimePaths(manifest)) {
      expect(existsSync(path.join(fixture.rootDir, runtimePath)), runtimePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === runtimePath), runtimePath).toBe(true);
    }

    const installedWriteCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-write.md'), 'utf8');
    const installedValidateCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-validate.md'), 'utf8');
    const installedWriteWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-write-workflow', 'SKILL.md'), 'utf8');
    const installedValidateWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-validate-workflow', 'SKILL.md'), 'utf8');

    expect(installedWriteCommand).toContain('.oma/templates/write/state-contract.json');
    expect(installedWriteCommand).toContain('.oma/state/shared/plan/approved-plan.json');
    expect(installedWriteWorkflow).toContain('.oma/state/shared/write/generated-artifacts.json');
    expect(installedWriteWorkflow).toContain('generation-report.json');

    expect(installedValidateCommand).toContain('.oma/templates/validate/state-contract.json');
    expect(installedValidateCommand).toContain('.oma/state/shared/write/generated-artifacts.json');
    expect(installedValidateWorkflow).toContain('.oma/state/local/validate/validation-report.json');
    expect(installedValidateWorkflow).toContain('lineage-drift');

    expect(doctorResult.details?.reportPath).toContain('.oma/state/local/doctor/doctor-report.json');
  });
});
