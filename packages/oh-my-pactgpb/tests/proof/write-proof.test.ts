import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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

  it('extends the existing local provider verification setup and persists a written outcome', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);
    writeProofPlanArtifacts(fixture.rootDir);

    const artifacts = writeProofWriteArtifacts(fixture.rootDir);
    const contract = readInstalledContract(fixture.rootDir);
    const requiredFields = contract.requiredMachineState[0]?.requiredTopLevelFields ?? [];
    const persistedState = readJsonFile<PactProviderWriteState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');
    const testFilePath = path.join(
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
    const testFileContent = readFileSync(testFilePath, 'utf8');

    for (const field of requiredFields) {
      expect(persistedState).toHaveProperty(field);
    }

    expect(persistedState.providerSelection.name).toBe('payments-provider');
    expect(persistedState.inputPlanVerdict).toBe('ready-to-scaffold');
    expect(persistedState.writeOutcome).toBe('written');
    expect(persistedState.filesWritten).toEqual([]);
    expect(persistedState.filesModified).toContain('src/test/java/com/example/payments/contract/PaymentProviderPactTest.java');
    expect(persistedState.expectedVerificationCommand).toBe('mvn test -Dtest=PaymentProviderPactTest');
    expect(testFileContent).toContain('HttpTestTarget');
    expect(testFileContent).toContain('void beforeEach(PactVerificationContext context)');
    expect(summary).toContain('Write outcome: written');
    expect(summary).toContain('Expected verification command: mvn test -Dtest=PaymentProviderPactTest');
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
    expect(persistedState.manualFollowUps.join(' ')).toContain('provider state names');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('Provider state names');
    expect(contractFiles).toEqual(['OrderProviderPactTest.java']);
    expect(testFileContent).toContain('HttpTestTarget');
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
    expect(persistedState.filesModified).toContain('src/test/java/com/example/shipping/contract/ShippingProviderPactTest.java');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('artifact source');
    expect(testFileContent).toContain('HttpTestTarget');
    expect(testFileContent).toContain('pact artifact retrieval is still unresolved');
    expect(summary).toContain('Write outcome: partial');
    expect(summary).toContain('Verification readiness claim: Only partial scaffold/remediation was written; verification is not ready to be claimed complete.');
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
    expect(persistedState.filesPlanned).toEqual([]);
    expect(persistedState.filesWritten).toEqual([]);
    expect(persistedState.filesModified).toEqual([]);
    expect(persistedState.writesSkipped[0]?.reason).toContain('blocked');
    expect(persistedState.unresolvedBlockers.join(' ')).toContain('ambiguous');
    expect(readFileSync(billingTestPath, 'utf8')).toBe(beforeBilling);
    expect(readFileSync(ledgerTestPath, 'utf8')).toBe(beforeLedger);
  });
});
