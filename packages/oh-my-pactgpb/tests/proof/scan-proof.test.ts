import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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
  it('produces grounded scan artifacts for a Spring provider with local pact files', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
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

    expect(persistedState.provider.name).toBe('payments-provider');
    expect(persistedState.artifactSource.verdict).toBe('local');
    expect(persistedState.verificationEvidence.pactDependencies).toContain('pom.xml');
    expect(persistedState.verificationEvidence.providerVerificationTests).toContain(
      'src/test/java/com/example/payments/contract/PaymentProviderPactTest.java',
    );
    expect(persistedState.verificationEvidence.localPactFiles).toContain(
      'src/test/resources/pacts/consumer-payments-provider.json',
    );
    expect(persistedState.providerStates.stateAnnotations).toContain('payment exists');
    expect(persistedState.httpSurface.controllerFiles).toContain(
      'src/main/java/com/example/payments/api/PaymentController.java',
    );
    expect(summary).toContain('Provider candidate: payments-provider');
    expect(summary).toContain('Expected artifact source verdict: local');
    expect(summary).toContain('payment exists');
  });

  it('surfaces an honest blocker when Pact artifact source is unclear', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-unclear' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const artifacts = writeProofScanArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderScanState>(artifacts.statePath);

    expect(persistedState.provider.name).toBe('billing-provider');
    expect(persistedState.relevance.verdict).toBe('relevant');
    expect(persistedState.artifactSource.verdict).toBe('unclear');
    expect(persistedState.gaps).toContain(
      'Pact artifact source is unclear: no local pact files or broker-related config were detected.',
    );
    expect(persistedState.providerStates.stateAnnotations).toContain('invoice exists');
  });

  it('marks a plain Java/Spring repo without Pact evidence as irrelevant instead of inventing verification setup', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const state = scanPactProviderRepo(fixture.rootDir);

    expect(state.relevance.verdict).toBe('irrelevant');
    expect(state.provider.name).toBe('fixture-java-service');
    expect(state.verificationEvidence.pactDependencies).toEqual([]);
    expect(state.verificationEvidence.providerVerificationTests).toEqual([]);
    expect(state.artifactSource.verdict).toBe('unclear');
  });
});
