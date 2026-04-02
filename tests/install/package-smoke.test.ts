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
  activeCommandIds: string[];
  activeWorkflowSkills: string[];
  activeCapabilityBundles: Array<{
    skillPath: string;
    references: Record<string, string>;
  }>;
};

type WriteStateContract = {
  generatedArtifactPolicy: {
    safeOutputBasePath: string;
    allowedOutputRoots: string[];
    approvedPlanProvidesArtifactIntentOnly: boolean;
    writerChoosesSafeOutputPath: boolean;
    requiredGeneratedArtifactFields: string[];
  };
};

type AcceptStateContract = {
  acceptancePolicy: {
    allowedSourceRoots: string[];
    explicitDestinationRequired: boolean;
    destinationMustBeRepoRelative: boolean;
    forbiddenDestinationRoots: string[];
    allowOverwriteExistingFiles: boolean;
    copyInsteadOfMove: boolean;
    keepGeneratedSourceAfterAccept: boolean;
    requiredAcceptedArtifactFields: string[];
  };
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

  it('proves the published tarball can install and diagnose a plain Java fixture repo with write/accept surfaces', () => {
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
      '.opencode/commands/akita-accept.md',
      '.opencode/skills/akita-scan-workflow/SKILL.md',
      '.opencode/skills/akita-plan-workflow/SKILL.md',
      '.opencode/skills/akita-write-workflow/SKILL.md',
      '.opencode/skills/akita-accept-workflow/SKILL.md',
      '.oma/templates/feature/default.feature.md',
      '.oma/templates/feature/with-background.feature.md',
      '.oma/templates/feature/with-omissions-note.feature.md',
      '.oma/templates/payload/json-body.md',
      '.oma/templates/payload/property-file.md',
      '.oma/templates/payload/minimal-fixture.md',
      '.oma/templates/scan/scan-summary.md',
      '.oma/templates/scan/state-contract.json',
      '.oma/templates/plan/plan-summary.md',
      '.oma/templates/plan/state-contract.json',
      '.oma/templates/write/write-summary.md',
      '.oma/templates/write/state-contract.json',
      '.oma/templates/accept/accept-summary.md',
      '.oma/templates/accept/state-contract.json',
      '.oma/instructions/rules/default-language-russian.md',
    ];
    const legacyAliasPaths = [
      '.opencode/commands/akita-validate.md',
      '.opencode/commands/akita-promote.md',
      '.opencode/skills/akita-validate-workflow/SKILL.md',
      '.opencode/skills/akita-promote-workflow/SKILL.md',
      '.oma/templates/validate/validate-summary.md',
      '.oma/templates/validate/state-contract.json',
      '.oma/templates/promote/promote-summary.md',
      '.oma/templates/promote/state-contract.json',
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
    expect(opencodeConfig.instructions).toEqual(
      expect.arrayContaining([
        '.oma/instructions/rules/default-language-russian.md',
      ]),
    );

    for (const relativePath of requiredInstalledPaths) {
      expect(existsSync(path.join(fixture.rootDir, relativePath)), relativePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === relativePath), relativePath).toBe(true);
    }

    for (const relativePath of legacyAliasPaths) {
      expect(existsSync(path.join(fixture.rootDir, relativePath)), relativePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === relativePath), relativePath).toBe(true);
    }

    for (const runtimePath of listBundleRuntimePaths(manifest)) {
      expect(existsSync(path.join(fixture.rootDir, runtimePath)), runtimePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === runtimePath), runtimePath).toBe(true);
    }

    expect(manifest.activeCommandIds).toEqual(
      expect.arrayContaining(['akita-accept']),
    );
    expect(manifest.activeWorkflowSkills).toEqual(
      expect.arrayContaining(['akita-accept-workflow']),
    );

    const installedScanCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-scan.md'), 'utf8');
    const installedWriteCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-write.md'), 'utf8');
    const installedAcceptCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-accept.md'), 'utf8');
    const installedAcceptWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-accept-workflow', 'SKILL.md'), 'utf8');
    const installedValidateCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-validate.md'), 'utf8');
    const installedPromoteCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-promote.md'), 'utf8');
    const installedWriteWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-write-workflow', 'SKILL.md'), 'utf8');
    const installedValidateWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-validate-workflow', 'SKILL.md'), 'utf8');
    const installedPromoteWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-promote-workflow', 'SKILL.md'), 'utf8');
    const installedWriteContract = readJsonFile<WriteStateContract>(
      path.join(fixture.rootDir, '.oma', 'templates', 'write', 'state-contract.json'),
    );
    const installedAcceptContract = readJsonFile<AcceptStateContract>(
      path.join(fixture.rootDir, '.oma', 'templates', 'accept', 'state-contract.json'),
    );

    expect(installedScanCommand).toContain('agent: build');
    expect(installedWriteCommand).toContain('.oma/templates/write/state-contract.json');
    expect(installedWriteCommand).toContain('.oma/generated/');
    expect(installedWriteCommand).toContain('/akita-accept');
    expect(installedWriteWorkflow).toContain('.oma/state/shared/write/write-report.json');
    expect(installedWriteWorkflow).toContain('capability bundle references');
    expect(installedWriteWorkflow).toContain('/akita-accept');
    expect(installedWriteContract.generatedArtifactPolicy).toMatchObject({
      safeOutputBasePath: '.oma/generated',
      allowedOutputRoots: [
        '.oma/generated/features',
        '.oma/generated/payloads',
        '.oma/generated/fixtures',
      ],
      approvedPlanProvidesArtifactIntentOnly: true,
      writerChoosesSafeOutputPath: true,
      requiredGeneratedArtifactFields: [
        'artifactId',
        'artifactKind',
        'approvedPlanRef',
        'emittedPath',
      ],
    });

    expect(installedAcceptCommand).toContain('.oma/templates/accept/state-contract.json');
    expect(installedAcceptCommand).toContain('.oma/state/shared/write/write-report.json');
    expect(installedAcceptCommand).toContain('accept <artifact-id> as <repo-relative-path>');
    expect(installedAcceptWorkflow).toContain('.oma/state/local/accept/accept-report.json');
    expect(installedAcceptWorkflow).toContain('lineage drift');
    expect(installedAcceptContract.acceptancePolicy).toMatchObject({
      allowedSourceRoots: [
        '.oma/generated/features',
        '.oma/generated/payloads',
        '.oma/generated/fixtures',
      ],
      explicitDestinationRequired: true,
      destinationMustBeRepoRelative: true,
      forbiddenDestinationRoots: ['.oma/', '.opencode/'],
      allowOverwriteExistingFiles: false,
      copyInsteadOfMove: true,
      keepGeneratedSourceAfterAccept: true,
      requiredAcceptedArtifactFields: [
        'artifactId',
        'artifactKind',
        'sourcePath',
        'destinationPath',
        'sourceSha256',
        'validationVerdict',
      ],
    });

    expect(installedValidateCommand).toContain('/akita-accept');
    expect(installedValidateWorkflow).toContain('/akita-accept');
    expect(installedPromoteCommand).toContain('/akita-accept');
    expect(installedPromoteWorkflow).toContain('/akita-accept');

    expect(doctorResult.details?.reportPath).toContain('.oma/state/local/doctor/doctor-report.json');
  });
});
