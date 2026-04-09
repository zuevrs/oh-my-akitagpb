import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hasInstalledInitContract,
  writeProofInitArtifacts,
  type PactProviderInitState,
} from '../../src/proof/init-proof.js';
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

type InitStateContract = {
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

function readInstalledContract(projectRoot: string): InitStateContract {
  return readJsonFile<InitStateContract>(path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'init', 'state-contract.json'));
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

describe('init proof', () => {
  it('bootstraps a zero-Pact Spring repo with OpenAPI and records init-completed honestly', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-openapi' }));
    const installResult = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    expect(installResult).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });
    expect(hasInstalledInitContract(fixture.rootDir)).toBe(true);

    const artifacts = writeProofInitArtifacts(fixture.rootDir);
    const contract = readInstalledContract(fixture.rootDir);
    const requiredFields = contract.requiredMachineState[0]?.requiredTopLevelFields ?? [];
    const persistedState = readJsonFile<PactProviderInitState>(artifacts.statePath);
    const summary = readFileSync(artifacts.summaryPath, 'utf8');
    const pactTestPath = path.join(
      fixture.rootDir,
      'src',
      'test',
      'java',
      'com',
      'example',
      'catalog',
      'contract',
      'CatalogProviderPactInitTest.java',
    );
    const pactTestContent = readFileSync(pactTestPath, 'utf8');
    const pomContent = readFileSync(path.join(fixture.rootDir, 'pom.xml'), 'utf8');

    for (const field of requiredFields) {
      expect(persistedState).toHaveProperty(field);
    }

    expect(persistedState.verdict).toBe('init-completed');
    expect(persistedState.providerCandidate.name).toBe('catalog-provider');
    expect(persistedState.httpSurface.openApiEvidence.join(' ')).toContain('catalog-provider.yaml');
    expect(persistedState.existingPactEvidence.detected).toBe(false);
    expect(persistedState.writesPerformed.filesWritten).toContain('src/test/java/com/example/catalog/contract/CatalogProviderPactInitTest.java');
    expect(persistedState.writesPerformed.filesModified).toContain('pom.xml');
    expect(persistedState.expectedFollowUpCommand).toBe('/pact-scan');
    expect(persistedState.remainingBlockers.join(' ')).toContain('Pact artifacts are still not grounded');
    expect(summary).toContain('Init verdict: init-completed');
    expect(summary).toContain('Recommended next step: Continue on the normal verification track');
    expect(pactTestContent).toContain('@Provider("catalog-provider")');
    expect(pactTestContent).toContain('@PactFolder("src/test/resources/pacts")');
    expect(pactTestContent).toContain('this harness prepares provider-side verification only');
    expect(pomContent).toContain('<artifactId>junit5spring</artifactId>');
    expect(pomContent).toContain('<artifactId>spring-boot-starter-test</artifactId>');
  });

  it('supports code-first Spring repos without requiring OpenAPI', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-codefirst' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const artifacts = writeProofInitArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderInitState>(artifacts.statePath);
    const pactTestPath = path.join(
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

    expect(persistedState.verdict).toBe('init-completed');
    expect(persistedState.providerCandidate.name).toBe('orders-provider');
    expect(persistedState.httpSurface.controllers).toContain('src/main/java/com/example/orders/api/OrderController.java');
    expect(persistedState.httpSurface.dtoEvidence).toContain('src/main/java/com/example/orders/dto/OrderResponse.java');
    expect(persistedState.httpSurface.openApiEvidence).toEqual([]);
    expect(persistedState.writesPerformed.filesWritten).toContain('src/test/java/com/example/orders/contract/OrdersProviderPactInitTest.java');
    expect(existsSync(pactTestPath)).toBe(true);
  });

  it('stops with init-not-justified for internal-only HTTP surfaces and writes no scaffold', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-internal' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const artifacts = writeProofInitArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderInitState>(artifacts.statePath);

    expect(persistedState.verdict).toBe('init-not-justified');
    expect(persistedState.initJustification.verdict).toBe('not-justified');
    expect(persistedState.httpSurface.requestMappings.join(' ')).toContain('/admin/cache/flush');
    expect(persistedState.writesPerformed.filesWritten).toEqual([]);
    expect(persistedState.writesPerformed.filesModified).toEqual([]);
    expect(persistedState.writesPerformed.writesSkipped[0]?.reason).toContain('skipped intentionally');
    expect(persistedState.remainingBlockers.join(' ')).toContain('internal/admin-only');
    expect(existsSync(path.join(fixture.rootDir, 'src', 'test', 'java', 'com', 'example', 'internal', 'contract'))).toBe(false);
  });

  it('redirects to the normal verification track when existing Pact evidence is already present', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-pact-provider-local' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const artifacts = writeProofInitArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderInitState>(artifacts.statePath);
    const existingPactTestPath = path.join(
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

    expect(persistedState.verdict).toBe('existing-pact-evidence-detected');
    expect(persistedState.existingPactEvidence.detected).toBe(true);
    expect(persistedState.existingPactEvidence.providerVerificationTests).toContain(
      'src/test/java/com/example/payments/contract/PaymentProviderPactTest.java',
    );
    expect(persistedState.expectedFollowUpCommand).toBe('/pact-scan');
    expect(persistedState.writesPerformed.filesWritten).toEqual([]);
    expect(persistedState.writesPerformed.filesModified).toEqual([]);
    expect(readFileSync(existingPactTestPath, 'utf8')).toContain('@Provider("payments-provider")');
  });

  it('persists ambiguity explicitly for zero-Pact multi-provider repos', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-ambiguous' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const artifacts = writeProofInitArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderInitState>(artifacts.statePath);

    expect(persistedState.verdict).toBe('insufficient-boundary-evidence');
    expect(persistedState.providerCandidate.name).toBeNull();
    expect(persistedState.providerCandidate.controllerGroups).toEqual(['billing', 'ledger']);
    expect(persistedState.providerCandidate.ambiguities.join(' ')).toContain('billing');
    expect(persistedState.providerCandidate.ambiguities.join(' ')).toContain('ledger');
    expect(persistedState.writesPerformed.filesWritten).toEqual([]);
    expect(persistedState.writesPerformed.filesModified).toEqual([]);
  });

  it('keeps bootstrap write scope narrow when init completes', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'spring-provider-init-openapi' }));
    parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));

    const artifacts = writeProofInitArtifacts(fixture.rootDir);
    const persistedState = readJsonFile<PactProviderInitState>(artifacts.statePath);

    expect(persistedState.verdict).toBe('init-completed');
    expect(persistedState.bootstrapPlan.plannedWrites).toEqual([
      'pom.xml',
      'src/test/java/com/example/catalog/contract/CatalogProviderPactInitTest.java',
    ]);
    expect(persistedState.writesPerformed.filesWritten).toEqual([
      'src/test/java/com/example/catalog/contract/CatalogProviderPactInitTest.java',
    ]);
    expect(persistedState.writesPerformed.filesModified).toEqual(['pom.xml']);
    expect(persistedState.notes.join(' ')).toContain('does not prove that verification is already runnable or passing');
  });
});
