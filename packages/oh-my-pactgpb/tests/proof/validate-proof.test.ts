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
import { createInstalledFixture, type FixtureRepo } from '../helpers/fixture-repo.js';
import { expectRequiredTopLevelFields, installFixture, readJsonFile } from './helpers.js';

const fixtures: FixtureRepo[] = [];

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function prepareValidateFixture(fixture: FixtureRepo): void {
  installFixture(fixture);
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
    prepareValidateFixture(fixture);

    expect(hasInstalledValidateContract(fixture.rootDir)).toBe(true);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expectRequiredTopLevelFields(fixture.rootDir, 'validate', persistedState);
    expect(persistedState.inputVerdicts.write).toBe('written');
    expect(persistedState.validationOutcome).toBe('ready');
    expect(persistedState.compileCheck.verdict).toBe('passed');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('ready');
  });

  it('confirms existing verification was extended in place instead of duplicated', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    prepareValidateFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'payments', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));

    expect(pactTests).toEqual(['PaymentProviderPactTest.java']);
    expect(persistedState.validationOutcome).toBe('ready');
    expect(persistedState.remainingBlockers).toEqual([]);
  });

  it('treats a resolved provider-state write slice as ready-to-run even when later coverage remains', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-partial' }));
    prepareValidateFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.plan).toBe('needs-provider-state-work');
    expect(persistedState.inputVerdicts.write).toBe('written');
    expect(persistedState.validationOutcome).toBe('ready');
    expect(persistedState.remainingBlockers.join(' ')).not.toContain('Provider state names');
  });

  it('reports partial when provider-state work is still unresolved after extending stale verification', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-stale' }));
    prepareValidateFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'orders', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));

    expect(pactTests).toEqual(['OrderProviderPactTest.java']);
    expect(persistedState.inputVerdicts.write).toBe('partial');
    expect(persistedState.validationOutcome).toBe('partial');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('unproven');
  });

  it('keeps broker-hint-only repos out of ready and marks runnable verification unproven', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-broker' }));
    prepareValidateFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.plan).toBe('needs-artifact-source-clarification');
    expect(persistedState.validationOutcome).toBe('partial');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('unproven');
  });

  it('preserves an honest irrelevant outcome for repos without Pact relevance', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    prepareValidateFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.scan).toBe('irrelevant');
    expect(persistedState.inputVerdicts.write).toBe('no-op');
    expect(persistedState.validationOutcome).toBe('irrelevant');
    expect(persistedState.repoRealityChecks.expectedArtifactsPresent).toEqual([]);
  });

  it('preserves a blocked outcome when provider binding stayed ambiguous', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-ambiguous' }));
    prepareValidateFixture(fixture);

    const artifacts = writeProofValidateArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderValidateState>(artifacts.statePath);

    expect(persistedState.inputVerdicts.plan).toBe('blocked');
    expect(persistedState.inputVerdicts.write).toBe('blocked');
    expect(persistedState.validationOutcome).toBe('blocked');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('blocked');
  });

  it('reports inconsistency when recorded write output drifts from repo reality', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    prepareValidateFixture(fixture);

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

    expect(persistedState.validationOutcome).toBe('inconsistent');
    expect(persistedState.compileCheck.verdict).toBe('failed');
    expect(persistedState.runnableVerificationCheck.verdict).toBe('blocked');
  });
});
