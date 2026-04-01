import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

const bundles = [
  {
    bundleId: 'akita-capability-akita-gpb-core-module-c795936046e',
    moduleId: 'akita-gpb-core-module',
    pin: 'c795936046e',
    expectedStepSourceSuffix: 'CommonSteps.java',
    expectedUnsupportedIds: [
      'core.helper-only-methods-not-promised',
      'core.hook-behavior-not-step-addressable',
      'core.generic-file-assertions-not-promised',
      'core.cross-module-integrations-not-claimed',
    ],
  },
  {
    bundleId: 'akita-capability-akita-gpb-api-module-223b2561bbc',
    moduleId: 'akita-gpb-api-module',
    pin: '223b2561bbc',
    expectedStepSourceSuffix: 'ApiSteps.java',
    expectedUnsupportedIds: [
      'api.full-sse-stream-consumption-not-promised',
      'api.domain-endpoint-contracts-not-claimed',
      'api.helper-and-hook-internals-not-standalone-capabilities',
      'api.readme-template-and-publishing-guidance-not-runtime-truth',
      'api.generic-soap-envelope-normalization-needs-review',
    ],
  },
] as const;

type CapabilityContract = {
  schemaVersion: 1;
  bundleId: string;
  module: {
    id: string;
    pin: string;
  };
  supportPolicy: {
    onlyAnnotatedStepMethods: boolean;
    helperOnlyBehaviorIsUnsupported: boolean;
    readmeClaimsDoNotExpandRuntimeTruth: boolean;
  };
  supportedCapabilities: Array<{
    id: string;
    status: 'supported' | 'partial';
    sourcePath: string;
  }>;
};

type UnsupportedCases = {
  schemaVersion: 1;
  bundleId: string;
  cases: Array<{
    id: string;
    status: 'unsupported' | 'needs-review';
    summary: string;
    reason: string;
  }>;
};

type Provenance = {
  schemaVersion: 1;
  bundleId: string;
  moduleId: string;
  pin: string;
  authoringPolicy: {
    runtimeExtraction: boolean;
    onlyAnnotatedStepMethodsPromoted: boolean;
    unclearBehaviorMarkedUnsupported: boolean;
  };
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function getBundlePaths(bundleId: string) {
  const bundleDir = path.join(repoRoot, 'assets', 'opencode', 'skills', bundleId);

  return {
    bundleDir,
    referencesDir: path.join(bundleDir, 'references'),
  };
}

describe('capability bundle assets', () => {
  it('ships each exact-pin bundle with the required files', () => {
    for (const bundle of bundles) {
      const { bundleDir } = getBundlePaths(bundle.bundleId);

      expect(existsSync(bundleDir), bundle.bundleId).toBe(true);

      for (const relativePath of [
        'SKILL.md',
        'references/capability-contract.json',
        'references/unsupported-cases.json',
        'references/examples.json',
        'references/provenance.json',
      ]) {
        expect(existsSync(path.join(bundleDir, relativePath)), `${bundle.bundleId}:${relativePath}`).toBe(true);
      }
    }
  });

  it('keeps each contract pinned to the reviewed module id and pin without exposing sourceZip in the runtime bundle assets', () => {
    for (const bundle of bundles) {
      const { referencesDir } = getBundlePaths(bundle.bundleId);
      const contract = readJsonFile<CapabilityContract>(path.join(referencesDir, 'capability-contract.json'));

      expect(contract).toMatchObject({
        schemaVersion: 1,
        bundleId: bundle.bundleId,
        module: {
          id: bundle.moduleId,
          pin: bundle.pin,
        },
        supportPolicy: {
          onlyAnnotatedStepMethods: true,
          helperOnlyBehaviorIsUnsupported: true,
          readmeClaimsDoNotExpandRuntimeTruth: true,
        },
      });

      expect(JSON.stringify(contract)).not.toContain('sourceZip');
      expect(contract.supportedCapabilities.length).toBeGreaterThan(0);
      expect(contract.supportedCapabilities.some((capability) => capability.status === 'partial')).toBe(true);
      expect(
        contract.supportedCapabilities.every((capability) => capability.sourcePath.endsWith(bundle.expectedStepSourceSuffix)),
      ).toBe(true);
    }
  });

  it('makes conservative unsupported boundaries explicit for each bundle', () => {
    for (const bundle of bundles) {
      const { referencesDir } = getBundlePaths(bundle.bundleId);
      const unsupportedCases = readJsonFile<UnsupportedCases>(path.join(referencesDir, 'unsupported-cases.json'));

      expect(unsupportedCases).toMatchObject({
        schemaVersion: 1,
        bundleId: bundle.bundleId,
      });
      expect(unsupportedCases.cases.length).toBeGreaterThan(0);

      for (const expectedId of bundle.expectedUnsupportedIds) {
        expect(unsupportedCases.cases.some((entry) => entry.id === expectedId), `${bundle.bundleId}:${expectedId}`).toBe(
          true,
        );
      }
    }
  });

  it('keeps provenance redacted, runtime extraction disabled, and sourceZip out of the shipped runtime-facing files', () => {
    for (const bundle of bundles) {
      const { bundleDir, referencesDir } = getBundlePaths(bundle.bundleId);
      const provenancePath = path.join(referencesDir, 'provenance.json');
      const skillPath = path.join(bundleDir, 'SKILL.md');
      const examplesPath = path.join(referencesDir, 'examples.json');
      const provenance = readJsonFile<Provenance>(provenancePath);

      expect(provenance).toMatchObject({
        schemaVersion: 1,
        bundleId: bundle.bundleId,
        moduleId: bundle.moduleId,
        pin: bundle.pin,
        authoringPolicy: {
          runtimeExtraction: false,
          onlyAnnotatedStepMethodsPromoted: true,
          unclearBehaviorMarkedUnsupported: true,
        },
      });
      expect(JSON.stringify(provenance)).not.toContain('sourceZip');

      const combinedText = [skillPath, examplesPath, provenancePath]
        .map((filePath) => readFileSync(filePath, 'utf8'))
        .join('\n');

      expect(combinedText).not.toMatch(/@gazprombank\.ru/i);
      expect(combinedText).not.toMatch(/backstage\./i);
      expect(combinedText).not.toMatch(/bitbucket\./i);
      expect(combinedText).not.toMatch(/teamcity\./i);
      expect(combinedText).not.toMatch(/confluence\./i);
    }
  });
});
