import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeProofInitArtifacts } from '../../src/proof/init-proof.js';
import {
  derivePlanFromScanState,
  hasInstalledPlanContract,
  readPersistedScanState,
  writeProofPlanArtifacts,
  type PactProviderPlanState,
} from '../../src/proof/plan-proof.js';
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

type PlanStateContract = {
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

function readInstalledContract(projectRoot: string): PlanStateContract {
  return readJsonFile<PlanStateContract>(path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'plan', 'state-contract.json'));
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('plan proof', () => {
  it('requires persisted scan-state on disk instead of planning from memory', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-partial' }));
    const installResult = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    expect(installResult).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(hasInstalledPlanContract(fixture.rootDir)).toBe(true);
    expect(() => readPersistedScanState(fixture.rootDir)).toThrow(/Persisted scan-state is missing/);
    expect(() => writeProofPlanArtifacts(fixture.rootDir)).toThrow(/Persisted scan-state is missing/);
  });

  it('derives concrete missing coverage work from a partial coverage model', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-partial' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);

    const artifacts = writeProofPlanArtifacts(fixture.rootDir);
    const contract = readInstalledContract(fixture.rootDir);
    const requiredFields = contract.requiredMachineState[0]?.requiredTopLevelFields ?? [];
    const persistedState = readJsonFile<PactProviderPlanState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');

    for (const field of requiredFields) {
      expect(persistedState).toHaveProperty(field);
    }

    expect(persistedState.providerSelection.name).toBe('invoices-provider');
    expect(persistedState.artifactSourceStrategy.verdict).toBe('local');
    expect(persistedState.verificationReadiness.verdict).toBe('needs-provider-state-work');
    expect(persistedState.verificationReadiness.existingSetup).toBe('extend-existing-provider-verification');
    expect(persistedState.coverageSummary.coveredEndpoints).toContain('GET /invoices/{id}');
    expect(persistedState.coverageSummary.endpointsWithGaps).toContain('POST /invoices');
    expect(persistedState.coverageSummary.uncoveredEndpoints).toContain('DELETE /invoices/{id}');
    expect(persistedState.providerStateWork.missingStates).toContain('invoice creatable');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Extend the existing provider verification setup');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Add missing provider states');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Extend coverage for partially represented endpoints');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Add coverage for uncovered provider endpoints');
    expect(persistedState.plannedTasks.map((task) => task.title)).not.toContain('Scaffold a provider verification test');
    expect(summary).toContain('Planning verdict: needs-provider-state-work');
    expect(summary).toContain('Covered endpoints: GET /invoices/{id}');
    expect(summary).toContain('Uncovered endpoints: DELETE /invoices/{id}');
    expect(summary).toContain('Missing states: invoice creatable');
  });

  it('keeps bootstrap-only repos in clarification mode instead of pretending they already cover interactions', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-codefirst' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofInitArtifacts(fixture.rootDir);
    writeProofScanArtifacts(fixture.rootDir);

    const artifacts = writeProofPlanArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderPlanState>(artifacts.statePath);

    expect(persistedState.providerSelection.name).toBe('orders-provider');
    expect(persistedState.artifactSourceStrategy.verdict).toBe('unclear');
    expect(persistedState.verificationReadiness.verdict).toBe('needs-artifact-source-clarification');
    expect(persistedState.coverageSummary.setupOnlyTargets.join(' ')).toContain('OrdersProviderPactInitTest.java');
    expect(persistedState.coverageSummary.uncoveredEndpoints).toContain('GET /orders/{id}');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Clarify pact artifact source');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Extend the existing provider verification setup');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Add coverage for uncovered provider endpoints');
  });

  it('keeps broker-only artifact hints in clarification mode instead of claiming runnable verification', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-broker' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);

    const artifacts = writeProofPlanArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderPlanState>(artifacts.statePath);

    expect(persistedState.providerSelection.name).toBe('shipping-provider');
    expect(persistedState.artifactSourceStrategy.verdict).toBe('broker');
    expect(persistedState.verificationReadiness.verdict).toBe('needs-artifact-source-clarification');
    expect(persistedState.plannedTasks.map((task) => task.title)).toContain('Clarify broker-backed pact retrieval');
    expect(persistedState.blockedBy.join(' ')).toContain('broker access');
  });

  it('persists provider ambiguity as a blocker instead of silently guessing', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-ambiguous' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
    writeProofScanArtifacts(fixture.rootDir);

    const artifacts = writeProofPlanArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderPlanState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');

    expect(persistedState.providerSelection.name).toBeNull();
    expect(persistedState.verificationReadiness.verdict).toBe('blocked');
    expect(persistedState.providerSelection.ambiguities.join(' ')).toContain('ambiguous');
    expect(persistedState.blockedBy.join(' ')).toContain('ambiguous');
    expect(persistedState.plannedTasks).toHaveLength(1);
    expect(persistedState.plannedTasks[0]?.title).toBe('Resolve provider binding ambiguity');
    expect(summary).toContain('blocked or unclear');
  });

  it('marks Pact as irrelevant when the persisted scan-state says the repo has no Pact evidence', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const scanArtifacts = writeProofScanArtifacts(fixture.rootDir);
    const plan = derivePlanFromScanState(scanArtifacts.state);

    expect(plan.verificationReadiness.verdict).toBe('irrelevant');
    expect(plan.providerSelection.name).toBe('fixture-java-service');
    expect(plan.plannedTasks).toEqual([]);
    expect(plan.blockedBy).toEqual([]);
  });
});
