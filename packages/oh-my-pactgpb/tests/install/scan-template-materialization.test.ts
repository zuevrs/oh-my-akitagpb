import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createAssetCatalog, getAssetEntry } from '../../src/runtime/asset-catalog.js';
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
};

type InstallState = {
  schemaVersion: 1;
  ownedFiles: Array<{ relativePath: string }>;
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
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

describe('init, scan, plan, write, and validate template materialization', () => {
  it('keeps the shipped init, scan, plan, write, and validate assets registered in the package asset catalog', () => {
    const catalog = createAssetCatalog(repoRoot);
    const expectedAssetEntries = {
      'commands/pact-init': path.join(repoRoot, 'assets', 'commands', 'pact-init.md'),
      'commands/pact-scan': path.join(repoRoot, 'assets', 'commands', 'pact-scan.md'),
      'commands/pact-plan': path.join(repoRoot, 'assets', 'commands', 'pact-plan.md'),
      'commands/pact-write': path.join(repoRoot, 'assets', 'commands', 'pact-write.md'),
      'commands/pact-validate': path.join(repoRoot, 'assets', 'commands', 'pact-validate.md'),
      'opencode/skills/pact-init-workflow': path.join(repoRoot, 'assets', 'opencode', 'skills', 'pact-init-workflow', 'SKILL.md'),
      'opencode/skills/pact-scan-workflow': path.join(repoRoot, 'assets', 'opencode', 'skills', 'pact-scan-workflow', 'SKILL.md'),
      'opencode/skills/pact-plan-workflow': path.join(repoRoot, 'assets', 'opencode', 'skills', 'pact-plan-workflow', 'SKILL.md'),
      'opencode/skills/pact-write-workflow': path.join(repoRoot, 'assets', 'opencode', 'skills', 'pact-write-workflow', 'SKILL.md'),
      'opencode/skills/pact-validate-workflow': path.join(repoRoot, 'assets', 'opencode', 'skills', 'pact-validate-workflow', 'SKILL.md'),
      'oma/templates/init/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'init', 'state-contract.json'),
      'oma/templates/init/init-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'init', 'init-summary.md'),
      'oma/templates/init/provider-harness': path.join(repoRoot, 'assets', 'oma', 'templates', 'init', 'provider-harness.java.tpl'),
      'oma/templates/init/neutral-provider-state-support': path.join(repoRoot, 'assets', 'oma', 'templates', 'init', 'neutral-provider-state-support.java.tpl'),
      'oma/templates/scan/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'scan', 'state-contract.json'),
      'oma/templates/scan/scan-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'scan', 'scan-summary.md'),
      'oma/templates/plan/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'plan', 'state-contract.json'),
      'oma/templates/plan/plan-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'plan', 'plan-summary.md'),
      'oma/templates/write/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'write', 'state-contract.json'),
      'oma/templates/write/write-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'write', 'write-summary.md'),
      'oma/templates/validate/state-contract': path.join(repoRoot, 'assets', 'oma', 'templates', 'validate', 'state-contract.json'),
      'oma/templates/validate/validate-summary': path.join(repoRoot, 'assets', 'oma', 'templates', 'validate', 'validate-summary.md'),
    } as const;

    for (const [assetKey, expectedPath] of Object.entries(expectedAssetEntries)) {
      const assetPath = getAssetEntry(catalog, assetKey);
      expect(assetPath).toBe(expectedPath);
      expect(existsSync(assetPath)).toBe(true);
    }
  });

  it('materializes the init, scan, plan, write, and validate contract templates on fresh install without claiming unrelated template files', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const userTemplatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'user-notes', 'README.md');
    mkdirSync(path.dirname(userTemplatePath), { recursive: true });
    writeFileSync(userTemplatePath, 'user-owned template notes\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);
    const installStatePath = path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'install-state.json');
    const installState = readJsonFile<InstallState>(installStatePath);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });

    for (const relativePath of [
      '.oma/packs/oh-my-pactgpb/templates/init/state-contract.json',
      '.oma/packs/oh-my-pactgpb/templates/init/init-summary.md',
      '.oma/packs/oh-my-pactgpb/templates/init/provider-harness.java.tpl',
      '.oma/packs/oh-my-pactgpb/templates/init/neutral-provider-state-support.java.tpl',
      '.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json',
      '.oma/packs/oh-my-pactgpb/templates/scan/scan-summary.md',
      '.oma/packs/oh-my-pactgpb/templates/plan/state-contract.json',
      '.oma/packs/oh-my-pactgpb/templates/plan/plan-summary.md',
      '.oma/packs/oh-my-pactgpb/templates/write/state-contract.json',
      '.oma/packs/oh-my-pactgpb/templates/write/write-summary.md',
      '.oma/packs/oh-my-pactgpb/templates/validate/state-contract.json',
      '.oma/packs/oh-my-pactgpb/templates/validate/validate-summary.md',
    ]) {
      expect(existsSync(path.join(fixture.rootDir, relativePath)), relativePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === relativePath), relativePath).toBe(true);
    }

    const installedInitContract = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'init', 'state-contract.json'), 'utf8');
    const installedInitSummary = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'init', 'init-summary.md'), 'utf8');
    const installedInitProviderHarness = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'init', 'provider-harness.java.tpl'), 'utf8');
    const installedInitNeutralStateSupport = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'init', 'neutral-provider-state-support.java.tpl'), 'utf8');
    const installedScanContract = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json'), 'utf8');
    const installedScanSummary = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'scan-summary.md'), 'utf8');
    const installedPlanContract = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'plan', 'state-contract.json'), 'utf8');
    const installedPlanSummary = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'plan', 'plan-summary.md'), 'utf8');
    const installedWriteContract = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'write', 'state-contract.json'), 'utf8');
    const installedWriteSummary = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'write', 'write-summary.md'), 'utf8');
    const installedValidateContract = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'validate', 'state-contract.json'), 'utf8');
    const installedValidateSummary = readFileSync(path.join(fixture.rootDir, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'validate', 'validate-summary.md'), 'utf8');

    expect(installedInitContract).toContain('existingPactEvidence');
    expect(installedInitContract).toContain('bootstrapPlan');
    expect(installedInitContract).toContain('proofLevel');
    expect(installedInitContract).toContain('verificationGrounding');
    expect(installedInitSummary).toContain('### Outcome');
    expect(installedInitSummary).toContain('### What is not proven');
    expect(installedInitSummary).toContain('### Bootstrap decision');
    expect(installedInitProviderHarness).toContain('deterministic provider-side baseline only');
    expect(installedInitProviderHarness).toContain('Add @PactFolder or @PactBroker only after repo evidence grounds the artifact source.');
    expect(installedInitNeutralStateSupport).toContain('Optional bootstrap shell only.');
    expect(installedScanContract).toContain('provider');
    expect(installedScanContract).toContain('artifactSource');
    expect(installedScanSummary).toContain('## Summary');
    expect(installedScanSummary).toContain('### Provider under contract');
    expect(installedScanSummary).toContain('### Main blockers');
    expect(installedPlanContract).toContain('providerSelection');
    expect(installedPlanContract).toContain('verificationReadiness');
    expect(installedPlanSummary).toContain('### Provider selection');
    expect(installedPlanSummary).toContain('### Verification readiness');
    expect(installedPlanSummary).toContain('### Blockers');
    expect(installedWriteContract).toContain('inputPlanVerdict');
    expect(installedWriteContract).toContain('writeOutcome');
    expect(installedWriteSummary).toContain('### Files planned and changed');
    expect(installedWriteSummary).toContain('### Verification next step');
    expect(installedValidateContract).toContain('validationOutcome');
    expect(installedValidateContract).toContain('runnableVerificationCheck');
    expect(installedValidateSummary).toContain('### Input verdict chain');
    expect(installedValidateSummary).toContain('### Runnable verification');
    expect(installedValidateSummary).toContain('### Remaining blockers');

    expect(readFileSync(userTemplatePath, 'utf8')).toBe('user-owned template notes\n');
    expect(installState.ownedFiles.some((file) => file.relativePath === '.oma/packs/oh-my-pactgpb/templates/user-notes/README.md')).toBe(false);
  });
});
