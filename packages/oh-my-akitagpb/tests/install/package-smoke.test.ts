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

type PromoteStateContract = {
  promotionPolicy: {
    allowedSourceRoots: string[];
    explicitDestinationRequired: boolean;
    destinationMustBeRepoRelative: boolean;
    forbiddenDestinationRoots: string[];
    allowOverwriteExistingFiles: boolean;
    copyInsteadOfMove: boolean;
    keepGeneratedSourceAfterPromote: boolean;
    requiredPromotedArtifactFields: string[];
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

  it('proves the published tarball can install and diagnose a plain Java fixture repo with write/validate surfaces', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));

    const installExecution = invokeInstalledCli(fixture.rootDir, ['install']);
    const installResult = parseJsonOutput<CliResult>(installExecution);
    const doctorExecution = invokeInstalledCli(fixture.rootDir, ['doctor']);
    const doctorResult = parseJsonOutput<CliResult>(doctorExecution);
    const manifestPath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'capability-manifest.json');
    const installStatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'install-state.json');
    const opencodeConfigPath = path.join(fixture.rootDir, 'opencode.json');
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    const installState = readJsonFile<InstallState>(installStatePath);
    const opencodeConfig = readJsonFile<Record<string, unknown>>(opencodeConfigPath);
    const requiredInstalledPaths = [
      '.opencode/commands/akita-scan.md',
      '.opencode/commands/akita-plan.md',
      '.opencode/commands/akita-write.md',
      '.opencode/commands/akita-validate.md',
      '.opencode/commands/akita-promote.md',
      '.opencode/skills/akita-scan-workflow/SKILL.md',
      '.opencode/skills/akita-plan-workflow/SKILL.md',
      '.opencode/skills/akita-write-workflow/SKILL.md',
      '.opencode/skills/akita-validate-workflow/SKILL.md',
      '.opencode/skills/akita-promote-workflow/SKILL.md',
      '.oma/packs/oh-my-akitagpb/templates/feature/default.feature.md',
      '.oma/packs/oh-my-akitagpb/templates/feature/with-background.feature.md',
      '.oma/packs/oh-my-akitagpb/templates/feature/with-omissions-note.feature.md',
      '.oma/packs/oh-my-akitagpb/templates/payload/json-body.md',
      '.oma/packs/oh-my-akitagpb/templates/payload/property-file.md',
      '.oma/packs/oh-my-akitagpb/templates/payload/minimal-fixture.md',
      '.oma/packs/oh-my-akitagpb/templates/scan/scan-summary.md',
      '.oma/packs/oh-my-akitagpb/templates/scan/state-contract.json',
      '.oma/packs/oh-my-akitagpb/templates/plan/plan-summary.md',
      '.oma/packs/oh-my-akitagpb/templates/plan/state-contract.json',
      '.oma/packs/oh-my-akitagpb/templates/write/write-summary.md',
      '.oma/packs/oh-my-akitagpb/templates/write/state-contract.json',
      '.oma/packs/oh-my-akitagpb/templates/validate/validate-summary.md',
      '.oma/packs/oh-my-akitagpb/templates/validate/state-contract.json',
      '.oma/packs/oh-my-akitagpb/templates/promote/promote-summary.md',
      '.oma/packs/oh-my-akitagpb/templates/promote/state-contract.json',
      '.oma/packs/oh-my-akitagpb/instructions/rules/default-language-russian.md',
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
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'install-state.json'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'runtime', 'local', 'project-mode.json'))).toBe(true);
    expect(existsSync(doctorResult.details?.reportPath ?? '')).toBe(true);
    expect(opencodeConfig.ohMyAkitaGpb).toBeUndefined();
    expect(opencodeConfig.instructions).toEqual(
      expect.arrayContaining([
        '.oma/packs/oh-my-akitagpb/instructions/rules/default-language-russian.md',
      ]),
    );

    for (const relativePath of requiredInstalledPaths) {
      expect(existsSync(path.join(fixture.rootDir, relativePath)), relativePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === relativePath), relativePath).toBe(true);
    }

    for (const runtimePath of listBundleRuntimePaths(manifest)) {
      expect(existsSync(path.join(fixture.rootDir, runtimePath)), runtimePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === runtimePath), runtimePath).toBe(true);
    }

    expect(manifest.activeCommandIds).toEqual(
      expect.arrayContaining(['akita-promote']),
    );
    expect(manifest.activeWorkflowSkills).toEqual(
      expect.arrayContaining(['akita-promote-workflow']),
    );

    const installedScanCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-scan.md'), 'utf8');
    const installedPlanCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-plan.md'), 'utf8');
    const installedWriteCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-write.md'), 'utf8');
    const installedValidateCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-validate.md'), 'utf8');
    const installedPromoteCommand = readFileSync(path.join(fixture.rootDir, '.opencode', 'commands', 'akita-promote.md'), 'utf8');
    const installedScanWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-scan-workflow', 'SKILL.md'), 'utf8');
    const installedPlanWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-plan-workflow', 'SKILL.md'), 'utf8');
    const installedWriteWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-write-workflow', 'SKILL.md'), 'utf8');
    const installedValidateWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-validate-workflow', 'SKILL.md'), 'utf8');
    const installedPromoteWorkflow = readFileSync(path.join(fixture.rootDir, '.opencode', 'skills', 'akita-promote-workflow', 'SKILL.md'), 'utf8');
    const installedWriteContract = readJsonFile<WriteStateContract>(
      path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'templates', 'write', 'state-contract.json'),
    );
    const installedPromoteContract = readJsonFile<PromoteStateContract>(
      path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-akitagpb', 'templates', 'promote', 'state-contract.json'),
    );

    expect(installedScanCommand).toContain('agent: build');
    expect(installedScanCommand).toContain('system under test');
    expect(installedScanCommand).toContain('OpenAPI and AsyncAPI');
    expect(installedScanWorkflow).toContain('machine-readable evidence map');
    expect(installedScanWorkflow).toContain('Do not treat missing OpenAPI or missing AsyncAPI as a special failure mode');
    expect(installedPlanCommand).toContain('persisted scan evidence');
    expect(installedPlanCommand).toContain('do not turn plan into a catalog of pre-approved scenario patterns');
    expect(installedPlanWorkflow).toContain('OpenAPI or AsyncAPI evidence may strengthen a candidate');
    expect(installedPlanWorkflow).toContain('Do not create `.oma/packs/oh-my-akitagpb/state/shared/plan/approved-plan.json` unless the user explicitly chooses');
    expect(installedWriteCommand).toContain('.oma/packs/oh-my-akitagpb/templates/write/state-contract.json');
    expect(installedWriteCommand).toContain('.oma/packs/oh-my-akitagpb/generated/');
    expect(installedWriteWorkflow).toContain('.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json');
    expect(installedWriteWorkflow).toContain('capability bundle references');
    expect(installedWriteContract.generatedArtifactPolicy).toMatchObject({
      safeOutputBasePath: '.oma/packs/oh-my-akitagpb/generated',
      allowedOutputRoots: [
        '.oma/packs/oh-my-akitagpb/generated/features',
        '.oma/packs/oh-my-akitagpb/generated/payloads',
        '.oma/packs/oh-my-akitagpb/generated/fixtures',
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

    expect(installedValidateCommand).toContain('.oma/packs/oh-my-akitagpb/templates/validate/state-contract.json');
    expect(installedValidateCommand).toContain('.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json');
    expect(installedValidateCommand).toContain('/akita-promote');
    expect(installedValidateWorkflow).toContain('.oma/packs/oh-my-akitagpb/state/local/validate/validation-report.json');
    expect(installedValidateWorkflow).toContain('lineage-drift');
    expect(installedValidateWorkflow).toContain('/akita-promote');

    expect(installedPromoteCommand).toContain('.oma/packs/oh-my-akitagpb/templates/promote/state-contract.json');
    expect(installedPromoteCommand).toContain('.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json');
    expect(installedPromoteCommand).toContain('promote <artifact-id> to <repo-relative-path>');
    expect(installedPromoteWorkflow).toContain('.oma/packs/oh-my-akitagpb/state/local/promote/promote-report.json');
    expect(installedPromoteWorkflow).toContain('copy instead of move');
    expect(installedPromoteContract.promotionPolicy).toMatchObject({
      allowedSourceRoots: [
        '.oma/packs/oh-my-akitagpb/generated/features',
        '.oma/packs/oh-my-akitagpb/generated/payloads',
        '.oma/packs/oh-my-akitagpb/generated/fixtures',
      ],
      explicitDestinationRequired: true,
      destinationMustBeRepoRelative: true,
      forbiddenDestinationRoots: ['.oma/', '.opencode/'],
      allowOverwriteExistingFiles: false,
      copyInsteadOfMove: true,
      keepGeneratedSourceAfterPromote: true,
      requiredPromotedArtifactFields: [
        'artifactId',
        'artifactKind',
        'sourcePath',
        'destinationPath',
        'sourceSha256',
      ],
    });

    expect(doctorResult.details?.reportPath).toContain('.oma/packs/oh-my-akitagpb/state/local/doctor/doctor-report.json');
  });
});
