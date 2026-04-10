import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeProofInitArtifacts } from '../../src/proof/init-proof.js';
import {
  hasInstalledScanContract,
  scanPactProviderRepo,
  writeProofScanArtifacts,
  type PactProviderScanState,
} from '../../src/proof/scan-proof.js';
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

type ScanStateContract = {
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

function readInstalledContract(projectRoot: string): ScanStateContract {
  return readJsonFile<ScanStateContract>(path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json'));
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('scan proof', () => {
  it('persists a coverage model for a partially covered Pact provider repo', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-partial' }));
    const installResult = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    expect(installResult).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(hasInstalledScanContract(fixture.rootDir)).toBe(true);

    const artifacts = writeProofScanArtifacts(fixture.rootDir);
    const contract = readInstalledContract(fixture.rootDir);
    const requiredFields = contract.requiredMachineState[0]?.requiredTopLevelFields ?? [];
    const persistedState = readJsonFile<PactProviderScanState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');

    for (const field of requiredFields) {
      expect(persistedState).toHaveProperty(field);
    }

    expect(persistedState.provider.name).toBe('invoices-provider');
    expect(persistedState.artifactSource.verdict).toBe('local');
    expect(persistedState.verificationEvidence.providerVerificationTests).toContain(
      'src/test/java/com/example/invoices/contract/InvoiceProviderPactTest.java',
    );
    expect(persistedState.coverageModel.coverageSummary.coveredEndpoints).toContain('GET /invoices/{id}');
    expect(persistedState.coverageModel.coverageSummary.endpointsWithGaps).toContain('POST /invoices');
    expect(persistedState.coverageModel.coverageSummary.uncoveredEndpoints).toContain('DELETE /invoices/{id}');
    expect(persistedState.coverageModel.coverageSummary.coveredInteractions.join(' ')).toContain('GET /invoices/123');
    expect(persistedState.coverageModel.coverageSummary.interactionStateGaps.join(' ')).toContain('POST /invoices');
    expect(persistedState.coverageModel.stateInventory.missing).toContain('invoice creatable');
    expect(summary).toContain('Covered endpoints: GET /invoices/{id}');
    expect(summary).toContain('Endpoints with gaps: POST /invoices');
    expect(summary).toContain('Uncovered endpoints: DELETE /invoices/{id}');
    expect(summary).toContain('Missing provider states: invoice creatable');
  });

  it('treats init bootstrap as setup-only and does not invent covered interactions', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-codefirst' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofInitArtifacts(fixture.rootDir);

    const artifacts = writeProofScanArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderScanState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');

    expect(persistedState.provider.name).toBe('orders-provider');
    expect(persistedState.relevance.verdict).toBe('relevant');
    expect(persistedState.artifactSource.verdict).toBe('unclear');
    expect(persistedState.verificationEvidence.providerVerificationTests).toContain(
      'src/test/java/com/example/orders/contract/OrdersProviderPactInitTest.java',
    );
    expect(persistedState.coverageModel.coverageSummary.setupOnlyTargets.join(' ')).toContain('OrdersProviderPactInitTest.java');
    expect(persistedState.coverageModel.coverageSummary.coveredEndpoints).toEqual([]);
    expect(persistedState.coverageModel.coverageSummary.uncoveredEndpoints).toContain('GET /orders/{id}');
    expect(persistedState.coverageModel.stateInventory.referenced).toEqual([]);
    expect(persistedState.gaps.join(' ')).toContain('Bootstrap provider verification exists');
    expect(summary).toContain('Setup-only verification targets');
    expect(summary).toContain('Uncovered endpoints: GET /orders/{id}');
  });

  it('preserves provider ambiguity instead of claiming fake coverage', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-ambiguous' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const artifacts = writeProofScanArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderScanState>(artifacts.statePath);

    expect(persistedState.provider.name).toBeNull();
    expect(persistedState.relevance.verdict).toBe('needs-review');
    expect(persistedState.coverageModel.ambiguityMarkers.join(' ')).toContain('ambiguous');
    expect(persistedState.gaps.join(' ')).toContain('ambiguous');
  });

  it('marks a plain Java/Spring repo without Pact evidence as irrelevant instead of inventing coverage', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const state = scanPactProviderRepo(fixture.rootDir);

    expect(state.relevance.verdict).toBe('irrelevant');
    expect(state.provider.name).toBe('fixture-java-service');
    expect(state.coverageModel.coverageSummary.coveredEndpoints).toEqual([]);
    expect(state.coverageModel.coverageSummary.uncoveredEndpoints).toEqual([]);
    expect(state.verificationEvidence.pactDependencies).toEqual([]);
    expect(state.verificationEvidence.providerVerificationTests).toEqual([]);
    expect(state.artifactSource.verdict).toBe('unclear');
  });
});
