import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeProofInitArtifacts } from '../../src/proof/init-proof.js';
import {
  hasInstalledWriteContract,
  readPersistedPlanState,
  writeProofWriteArtifacts,
  type PactProviderWriteState,
} from '../../src/proof/write-proof.js';
import { writeProofPlanArtifacts } from '../../src/proof/plan-proof.js';
import { writeProofScanArtifacts } from '../../src/proof/scan-proof.js';
import { createInstalledFixture, type FixtureRepo } from '../helpers/fixture-repo.js';
import { expectRequiredTopLevelFields, installFixture, readJsonFile } from './helpers.js';

const fixtures: FixtureRepo[] = [];

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function prepareWriteFixture(fixture: FixtureRepo, options: { bootstrapInit?: boolean } = {}): void {
  installFixture(fixture);
  if (options.bootstrapInit) {
    writeProofInitArtifacts(fixture.rootDir);
  }
  writeProofScanArtifacts(fixture.rootDir);
  writeProofPlanArtifacts(fixture.rootDir);
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('write proof', () => {
  it('requires persisted plan-state on disk instead of writing from memory', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));

    installFixture(fixture);
    expect(hasInstalledWriteContract(fixture.rootDir)).toBe(true);

    writeProofScanArtifacts(fixture.rootDir);

    expect(() => readPersistedPlanState(fixture.rootDir)).toThrow(/Persisted plan-state is missing/);
    expect(() => writeProofWriteArtifacts(fixture.rootDir)).toThrow(/Persisted plan-state is missing/);
  });

  it('extends the existing local provider verification setup in place as a real written coverage increment', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    prepareWriteFixture(fixture);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'payments', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));
    const testFileContent = readFileSync(path.join(contractDir, 'PaymentProviderPactTest.java'), 'utf8');

    expectRequiredTopLevelFields(fixture.rootDir, 'write', persistedState);
    expect(persistedState.writeOutcome).toBe('written');
    expect(persistedState.targetCoverageSlice.category).toBe('extend-existing-provider-verification');
    expect(persistedState.filesModified).toContain('src/test/java/com/example/payments/contract/PaymentProviderPactTest.java');
    expect(persistedState.expectedVerificationCommand).toBe('mvn test -Dtest=PaymentProviderPactTest');
    expect(pactTests).toEqual(['PaymentProviderPactTest.java']);
    expect(testFileContent).toContain('Coverage slice: extend-existing-provider-verification');
  });

  it('adds grounded missing provider states narrowly for a partial coverage repo and keeps remaining uncovered work explicit', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-partial' }));
    prepareWriteFixture(fixture);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const testFileContent = readFileSync(
      path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'invoices', 'contract', 'InvoiceProviderPactTest.java'),
      'utf8',
    );

    expect(persistedState.writeOutcome).toBe('written');
    expect(persistedState.targetCoverageSlice.category).toBe('add-missing-provider-states');
    expect(persistedState.targetCoverageSlice.providerStates).toContain('invoice creatable');
    expect(persistedState.remainingCoverageGaps.uncoveredEndpoints).toContain('DELETE /invoices/{id}');
    expect(testFileContent).toContain('@State("invoice creatable")');
  });

  it('prepares a grounded uncovered endpoint slice without faking implemented coverage', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-uncovered-grounded' }));
    prepareWriteFixture(fixture);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const testFileContent = readFileSync(
      path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'payments', 'contract', 'PaymentProviderPactTest.java'),
      'utf8',
    );

    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.targetCoverageSlice.category).toBe('prepare-uncovered-endpoint-coverage');
    expect(persistedState.targetCoverageSlice.endpoints).toContain('POST /payments');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('No grounded Pact interaction exists yet');
    expect(testFileContent).toContain('Coverage slice: prepare-uncovered-endpoint-coverage');
  });

  it('keeps bootstrap-only repos conservative and explicit instead of claiming fake coverage', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-codefirst' }));
    prepareWriteFixture(fixture, { bootstrapInit: true });

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const initTestPath = path.join(
      fixture.rootDir,
      'src',
      'test',
      'java',
      'com',
      'example',
      'orders',
      'contract',
      'OrdersProviderPactInitTest.java',
    );
    const testFileContent = readFileSync(initTestPath, 'utf8');

    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.targetCoverageSlice.category).toBe('partial-preparation');
    expect(persistedState.filesModified).toContain('src/test/java/com/example/orders/contract/OrdersProviderPactInitTest.java');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('artifact source');
    expect(existsSync(initTestPath)).toBe(true);
    expect(testFileContent).toContain('pact artifact retrieval is still unresolved');
  });

  it('extends stale verification in place and keeps unresolved provider-state work explicit', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-stale' }));
    prepareWriteFixture(fixture);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'orders', 'contract');
    const contractFiles = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));
    const testFileContent = readFileSync(path.join(contractDir, 'OrderProviderPactTest.java'), 'utf8');

    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.targetCoverageSlice.category).toBe('prepare-uncovered-endpoint-coverage');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('Provider state names');
    expect(contractFiles).toEqual(['OrderProviderPactTest.java']);
    expect(testFileContent).toContain('persisted pact inputs did not expose concrete provider state names');
  });

  it('writes only partial broker-oriented remediation and does not claim runnable verification', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-broker' }));
    prepareWriteFixture(fixture);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const testFileContent = readFileSync(
      path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'shipping', 'contract', 'ShippingProviderPactTest.java'),
      'utf8',
    );

    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.targetCoverageSlice.category).toBe('partial-preparation');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('artifact source');
    expect(testFileContent).toContain('pact artifact retrieval is still unresolved');
  });

  it('persists an honest no-op when Pact verification is irrelevant', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    prepareWriteFixture(fixture);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);

    expect(persistedState.writeOutcome).toBe('no-op');
    expect(persistedState.targetCoverageSlice.category).toBe('irrelevant');
    expect(persistedState.filesPlanned).toEqual([]);
    expect(persistedState.filesWritten).toEqual([]);
    expect(persistedState.filesModified).toEqual([]);
    expect(existsSync(path.join(fixture.rootDir, 'src', 'test', 'java'))).toBe(false);
  });

  it('persists a blocked outcome when provider binding is ambiguous', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-ambiguous' }));
    prepareWriteFixture(fixture);

    const billingTestPath = path.join(
      fixture.rootDir,
      'src',
      'test',
      'java',
      'com',
      'example',
      'commerce',
      'contract',
      'BillingProviderPactTest.java',
    );
    const ledgerTestPath = path.join(
      fixture.rootDir,
      'src',
      'test',
      'java',
      'com',
      'example',
      'commerce',
      'contract',
      'LedgerProviderPactTest.java',
    );
    const beforeBilling = readFileSync(billingTestPath, 'utf8');
    const beforeLedger = readFileSync(ledgerTestPath, 'utf8');

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);

    expect(persistedState.writeOutcome).toBe('blocked');
    expect(persistedState.targetCoverageSlice.category).toBe('blocked');
    expect(persistedState.filesPlanned).toEqual([]);
    expect(persistedState.filesWritten).toEqual([]);
    expect(persistedState.filesModified).toEqual([]);
    expect(readFileSync(billingTestPath, 'utf8')).toBe(beforeBilling);
    expect(readFileSync(ledgerTestPath, 'utf8')).toBe(beforeLedger);
  });
});
