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

type WriteStateContract = {
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

function readInstalledContract(projectRoot: string): WriteStateContract {
  return readJsonFile<WriteStateContract>(path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'write', 'state-contract.json'));
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('write proof', () => {
  it('requires persisted plan-state on disk instead of writing from memory', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    const installResult = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    expect(installResult).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(hasInstalledWriteContract(fixture.rootDir)).toBe(true);

    writeProofScanArtifacts(fixture.rootDir);

    expect(() => readPersistedPlanState(fixture.rootDir)).toThrow(/Persisted plan-state is missing/);
    expect(() => writeProofWriteArtifacts(fixture.rootDir)).toThrow(/Persisted plan-state is missing/);
  });

  it('extends the existing local provider verification setup in place as a real written coverage increment', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const contract = readInstalledContract(fixture.rootDir);
    const requiredFields = contract.requiredMachineState[0]?.requiredTopLevelFields ?? [];
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'payments', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));
    const testFilePath = path.join(contractDir, 'PaymentProviderPactTest.java');
    const testFileContent = readFileSync(testFilePath, 'utf8');

    for (const field of requiredFields) {
      expect(persistedState).toHaveProperty(field);
    }

    expect(persistedState.providerSelection.name).toBe('payments-provider');
    expect(persistedState.inputPlanVerdict).toBe('ready-to-scaffold');
    expect(persistedState.writeOutcome).toBe('written');
    expect(persistedState.targetCoverageSlice.category).toBe('extend-existing-provider-verification');
    expect(persistedState.targetCoverageSlice.verificationTarget).toBe('src/test/java/com/example/payments/contract/PaymentProviderPactTest.java');
    expect(persistedState.targetCoverageSlice.endpoints).toContain('GET /payments/{id}');
    expect(persistedState.targetCoverageSlice.interactions.join(' ')).toContain('GET /payments/123');
    expect(persistedState.filesWritten).toEqual([]);
    expect(persistedState.filesModified).toContain('src/test/java/com/example/payments/contract/PaymentProviderPactTest.java');
    expect(persistedState.expectedVerificationCommand).toBe('mvn test -Dtest=PaymentProviderPactTest');
    expect(pactTests).toEqual(['PaymentProviderPactTest.java']);
    expect(testFileContent).toContain('HttpTestTarget');
    expect(testFileContent).toContain('void beforeEach(PactVerificationContext context)');
    expect(testFileContent).toContain('Coverage slice: extend-existing-provider-verification');
    expect(summary).toContain('Category: extend-existing-provider-verification');
    expect(summary).toContain('Write outcome: written');
  });

  it('adds grounded missing provider states narrowly for a partial coverage repo and keeps remaining uncovered work explicit', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-partial' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'invoices', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));
    const testFileContent = readFileSync(path.join(contractDir, 'InvoiceProviderPactTest.java'), 'utf8');
    const summary = readFileSync(artifacts.summaryPath, 'utf8');

    expect(persistedState.providerSelection.name).toBe('invoices-provider');
    expect(persistedState.inputPlanVerdict).toBe('needs-provider-state-work');
    expect(persistedState.writeOutcome).toBe('written');
    expect(persistedState.targetCoverageSlice.category).toBe('add-missing-provider-states');
    expect(persistedState.targetCoverageSlice.endpoints).toContain('POST /invoices');
    expect(persistedState.targetCoverageSlice.interactions.join(' ')).toContain('POST /invoices');
    expect(persistedState.targetCoverageSlice.providerStates).toContain('invoice creatable');
    expect(persistedState.filesModified).toContain('src/test/java/com/example/invoices/contract/InvoiceProviderPactTest.java');
    expect(persistedState.remainingCoverageGaps.uncoveredEndpoints).toContain('DELETE /invoices/{id}');
    expect(pactTests).toEqual(['InvoiceProviderPactTest.java']);
    expect(testFileContent).toContain('@State("invoice creatable")');
    expect(testFileContent).toContain('Coverage slice: add-missing-provider-states');
    expect(summary).toContain('Category: add-missing-provider-states');
    expect(summary).toContain('Missing provider states: (none)');
    expect(summary).toContain('Uncovered endpoints: DELETE /invoices/{id}');
  });

  it('prepares a grounded uncovered endpoint slice without faking implemented coverage', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-uncovered-grounded' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'payments', 'contract');
    const pactTests = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));
    const testFileContent = readFileSync(path.join(contractDir, 'PaymentProviderPactTest.java'), 'utf8');

    expect(persistedState.inputPlanVerdict).toBe('ready-to-scaffold');
    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.targetCoverageSlice.category).toBe('prepare-uncovered-endpoint-coverage');
    expect(persistedState.targetCoverageSlice.endpoints).toContain('POST /payments');
    expect(persistedState.remainingCoverageGaps.uncoveredEndpoints).toContain('POST /payments');
    expect(persistedState.manualFollowUps.join(' ')).toContain('POST /payments');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('No grounded Pact interaction exists yet');
    expect(pactTests).toEqual(['PaymentProviderPactTest.java']);
    expect(testFileContent).toContain('Coverage slice: prepare-uncovered-endpoint-coverage');
    expect(testFileContent).toContain('before claiming coverage for POST /payments');
  });

  it('keeps bootstrap-only repos conservative and explicit instead of claiming fake coverage', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-codefirst' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofInitArtifacts(fixture.rootDir);
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

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

    expect(persistedState.providerSelection.name).toBe('orders-provider');
    expect(persistedState.inputPlanVerdict).toBe('needs-artifact-source-clarification');
    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.targetCoverageSlice.category).toBe('partial-preparation');
    expect(persistedState.targetCoverageSlice.endpoints).toContain('GET /orders/{id}');
    expect(persistedState.filesModified).toContain('src/test/java/com/example/orders/contract/OrdersProviderPactInitTest.java');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('artifact source');
    expect(existsSync(initTestPath)).toBe(true);
    expect(testFileContent).toContain('Coverage slice: partial-preparation');
    expect(testFileContent).toContain('pact artifact retrieval is still unresolved');
  });

  it('extends stale verification in place and keeps unresolved provider-state work explicit', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-stale' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const contractDir = path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'orders', 'contract');
    const contractFiles = readdirSync(contractDir).filter((entry) => entry.endsWith('PactTest.java'));
    const testFileContent = readFileSync(path.join(contractDir, 'OrderProviderPactTest.java'), 'utf8');

    expect(persistedState.providerSelection.name).toBe('orders-provider');
    expect(persistedState.inputPlanVerdict).toBe('needs-provider-state-work');
    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.filesModified).toContain('src/test/java/com/example/orders/contract/OrderProviderPactTest.java');
    expect(persistedState.targetCoverageSlice.category).toBe('prepare-uncovered-endpoint-coverage');
    expect(persistedState.manualFollowUps.join(' ')).toContain('provider state names');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('Provider state names');
    expect(contractFiles).toEqual(['OrderProviderPactTest.java']);
    expect(testFileContent).toContain('HttpTestTarget');
    expect(testFileContent).toContain('Coverage slice: prepare-uncovered-endpoint-coverage');
    expect(testFileContent).toContain('persisted pact inputs did not expose concrete provider state names');
  });

  it('writes only partial broker-oriented remediation and does not claim runnable verification', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-broker' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');
    const testFileContent = readFileSync(
      path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'shipping', 'contract', 'ShippingProviderPactTest.java'),
      'utf8',
    );

    expect(persistedState.providerSelection.name).toBe('shipping-provider');
    expect(persistedState.inputPlanVerdict).toBe('needs-artifact-source-clarification');
    expect(persistedState.writeOutcome).toBe('partial');
    expect(persistedState.targetCoverageSlice.category).toBe('partial-preparation');
    expect(persistedState.filesModified).toContain('src/test/java/com/example/shipping/contract/ShippingProviderPactTest.java');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('artifact source');
    expect(testFileContent).toContain('HttpTestTarget');
    expect(testFileContent).toContain('pact artifact retrieval is still unresolved');
    expect(summary).toContain('Write outcome: partial');
    expect(summary).toContain('Verification readiness claim: Only partial preparation or remediation was written; do not claim full contract coverage yet.');
  });

  it('persists an honest no-op when Pact verification is irrelevant', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);

    expect(persistedState.providerSelection.name).toBe('fixture-java-service');
    expect(persistedState.inputPlanVerdict).toBe('irrelevant');
    expect(persistedState.writeOutcome).toBe('no-op');
    expect(persistedState.targetCoverageSlice.category).toBe('irrelevant');
    expect(persistedState.filesPlanned).toEqual([]);
    expect(persistedState.filesWritten).toEqual([]);
    expect(persistedState.filesModified).toEqual([]);
    expect(persistedState.writesSkipped[0]?.reason).toContain('irrelevant');
    expect(existsSync(path.join(fixture.rootDir, 'src', 'test', 'java'))).toBe(false);
  });

  it('persists a blocked outcome when provider binding is ambiguous', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-ambiguous' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

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

    expect(persistedState.providerSelection.name).toBeNull();
    expect(persistedState.inputPlanVerdict).toBe('blocked');
    expect(persistedState.writeOutcome).toBe('blocked');
    expect(persistedState.targetCoverageSlice.category).toBe('blocked');
    expect(persistedState.filesPlanned).toEqual([]);
    expect(persistedState.filesWritten).toEqual([]);
    expect(persistedState.filesModified).toEqual([]);
    expect(persistedState.writesSkipped[0]?.reason).toContain('blocked');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('ambiguous');
    expect(readFileSync(billingTestPath, 'utf8')).toBe(beforeBilling);
    expect(readFileSync(ledgerTestPath, 'utf8')).toBe(beforeLedger);
  });
});
