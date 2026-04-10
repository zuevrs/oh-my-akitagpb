import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hasInstalledValidateContract,
  writeProofValidateArtifacts,
  type PactProviderValidateState,
} from '../../src/proof/validate-proof.js';
import { writeProofPlanArtifacts } from '../../src/proof/plan-proof.js';
import { writeProofScanArtifacts } from '../../src/proof/scan-proof.js';
import { writeProofWriteArtifacts } from '../../src/proof/write-proof.js';
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

type ValidateStateContract = {
  requiredMachineState: Array<{
    requiredTopLevelFields: string[];
  }>;
};

const fixtures: FixtureRepo[] = [];

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function readInstalledContract(projectRoot: string): ValidateStateContract {
  return readJsonFile<ValidateStateContract>(path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'validate', 'state-contract.json'));
}

function installAndPrepareFixture(fixture: FixtureRepo): void {
  const installResult = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
  expect(installResult).toMatchObject({
    subcommand: 'install',
    status: 'ok',
    reason: 'install-complete',
  });
  writeProofScanArtifacts(fixture.rootDir);
  writeProofPlanArtifacts(fixture.rootDir);
  writeProofWriteArtifacts(fixture.rootDir);
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('validate proof', () => {
  it('confirms a ready local pact case after write with structural proof and runnable readiness', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    installAndPrepareFixture(fixture);

    expect(hasInstalledValidateContract(fixture.rootDir)).toBe(true);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const contract = readInstalledContract(fixture.rootDir);
    const requiredFields = contract.requiredMachineState[0]?.requiredTopLevelFields ?? [];
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');

    for (const field of requiredFields) {
      expect(persistedState).toHaveProperty(field);
    }

    expect(persistedState.inputVerdicts.scan).toBe('relevant');
    expect(persistedState.inputVerdicts.plan).toBe('ready-to-scaffold');
    expect(persistedState.inputVerdicts.write).toBe('written');
    expect(persistedState.validationOutcome).toBe('ready');
    expect(persistedState.stateConsistency.verdict).toBe('consistent');
    expect(persistedState.repoRealityChecks.expectedArtifactsPresent).toContain(
      'src/test/java/com/example/payments/contract/PaymentProviderPactTest.java',
    );
    expect(persistedState.compileCheck.verdict).toBe('passed');
    expect(persistedState.compileCheck.proofLevel).toBe('structural');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('ready');
    expect(persistedState.runnableVerificationCheck.command).toBe('mvn test -Dtest=PaymentProviderPactTest');
    expect(summary).toContain('Outcome: ready');
    expect(summary).toContain('Runnable verification');
  });

  it('confirms existing verification was extended in place instead of duplicated', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    installAndPrepareFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'payments', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));

    expect(pactTests).toEqual(['PaymentProviderPactTest.java']);
    expect(persistedState.repoRealityChecks.expectedArtifactsPresent).toContain(
      'src/test/java/com/example/payments/contract/PaymentProviderPactTest.java',
    );
    expect(persistedState.validationOutcome).toBe('ready');
    expect(persistedState.remainingBlockers).toEqual([]);
  });

  it('treats a resolved provider-state write slice as ready-to-run even when later coverage remains', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-partial' }));
    installAndPrepareFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.plan).toBe('needs-provider-state-work');
    expect(persistedState.inputVerdicts.write).toBe('written');
    expect(persistedState.stateConsistency.verdict).toBe('consistent');
    expect(persistedState.validationOutcome).toBe('ready');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('ready');
    expect(persistedState.remainingBlockers.join(' ')).not.toContain('Provider state names');
  });

  it('reports partial when provider-state work is still unresolved after extending stale verification', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-stale' }));
    installAndPrepareFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'orders', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));

    expect(pactTests).toEqual(['OrderProviderPactTest.java']);
    expect(persistedState.inputVerdicts.plan).toBe('needs-provider-state-work');
    expect(persistedState.inputVerdicts.write).toBe('partial');
    expect(persistedState.validationOutcome).toBe('partial');
    expect(persistedState.repoRealityChecks.expectedArtifactsPresent).toContain(
      'src/test/java/com/example/orders/contract/OrderProviderPactTest.java',
    );
    expect(persistedState.runnableVerificationCheck.verdict).toBe('unproven');
    expect(persistedState.remainingBlockers.join(' ')).toContain('Provider state names');
  });

  it('keeps broker-hint-only repos out of ready and marks runnable verification unproven', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-broker' }));
    installAndPrepareFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.plan).toBe('needs-artifact-source-clarification');
    expect(persistedState.validationOutcome).toBe('partial');
    expect(persistedState.compileCheck.verdict).toBe('passed');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('unproven');
    expect(persistedState.remainingBlockers.join(' ')).toContain('artifact source');
  });

  it('preserves an honest irrelevant outcome for repos without Pact relevance', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    installAndPrepareFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.scan).toBe('irrelevant');
    expect(persistedState.inputVerdicts.plan).toBe('irrelevant');
    expect(persistedState.inputVerdicts.write).toBe('no-op');
    expect(persistedState.validationOutcome).toBe('irrelevant');
    expect(persistedState.compileCheck.verdict).toBe('not-applicable');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('not-applicable');
    expect(persistedState.repoRealityChecks.expectedArtifactsPresent).toEqual([]);
  });

  it('preserves a blocked outcome when provider binding stayed ambiguous', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-ambiguous' }));
    installAndPrepareFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.plan).toBe('blocked');
    expect(persistedState.inputVerdicts.write).toBe('blocked');
    expect(persistedState.stateConsistency.verdict).toBe('consistent');
    expect(persistedState.validationOutcome).toBe('blocked');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('blocked');
    expect(persistedState.remainingBlockers.join(' ')).toContain('ambiguous');
  });

  it('reports inconsistency when recorded write output drifts from repo reality', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    installAndPrepareFixture(fixture);

    const targetPath = path.join(
      fixture.rootDir,
      'src',
      'test',
      'java',
      'com',
      'example',
      'payments',
      'contract',
      'PaymentProviderPactTest.java',
    );
    const driftedContent = readFileSync(targetPath, 'utf8').replace(
      '    context.setTarget(new HttpTestTarget("localhost", 8080));\n',
      '',
    );
    writeFileSync(targetPath, driftedContent, 'utf8');

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');

    expect(persistedState.validationOutcome).toBe('inconsistent');
    expect(persistedState.repoRealityChecks.scaffoldMarkersMissing.join(' ')).toContain('HttpTestTarget');
    expect(persistedState.compileCheck.verdict).toBe('failed');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('blocked');
    expect(summary).toContain('Outcome: inconsistent');
  });
});
