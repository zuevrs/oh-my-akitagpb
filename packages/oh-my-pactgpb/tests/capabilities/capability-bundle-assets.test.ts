import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

const bundles = [
  {
    bundleId: 'akita-capability-akita-gpb-core-module-c795936046e',
    moduleId: 'akita-gpb-core-module',
    pin: 'c795936046e',
    expectedStepSourceSuffixes: ['CommonSteps.java'],
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
    expectedStepSourceSuffixes: ['ApiSteps.java'],
    expectedUnsupportedIds: [
      'api.full-sse-stream-consumption-not-promised',
      'api.domain-endpoint-contracts-not-claimed',
      'api.helper-and-hook-internals-not-standalone-capabilities',
      'api.readme-template-and-publishing-guidance-not-runtime-truth',
      'api.generic-soap-envelope-normalization-needs-review',
    ],
  },
  {
    bundleId: 'akita-capability-ccl-database-module-bb0d27eda3e',
    moduleId: 'ccl-database-module',
    pin: 'bb0d27eda3e',
    expectedStepSourceSuffixes: ['CCLDataBaseSteps.java'],
    expectedUnsupportedIds: [
      'database.helper-and-config-internals-not-standalone-capabilities',
      'database.readme-claims-do-not-expand-runtime-truth',
      'database-vendor-neutral-admin-and-schema-semantics-not-promised',
      'database-arbitrary-query-orchestration-not-promised',
      'database-generic-wait-semantics-not-promised',
      'database-generic-collection-export-not-promised',
    ],
  },
  {
    bundleId: 'akita-capability-ccl-files-module-05e1cf4d5e7',
    moduleId: 'ccl-files-module',
    pin: '05e1cf4d5e7',
    expectedStepSourceSuffixes: [
      'FileSteps.java',
      'DocxSteps.java',
      'ExcelSteps.java',
      'HtmlSteps.java',
      'ImageSteps.java',
      'JsonSteps.java',
      'PDFSteps.java',
      'XMLSteps.java',
    ],
    expectedUnsupportedIds: [
      'files.helper-and-parser-internals-not-standalone-capabilities',
      'files.readme-claims-do-not-expand-runtime-truth',
      'files.universal-file-format-support-not-promised',
      'files.arbitrary-filesystem-orchestration-not-promised',
      'files.browser-download-automation-not-generic',
      'files.docx-word-processing-beyond-reviewed-steps-not-promised',
      'files.excel-spreadsheet-editing-platform-not-promised',
      'files.html-dom-browser-semantics-not-promised',
      'files.image-visual-testing-platform-not-promised',
      'files.json-generic-document-or-api-platform-not-promised',
      'files.pdf-document-semantics-beyond-reviewed-text-and-table-families-not-promised',
      'files.xml-generic-transformation-and-schema-semantics-not-promised',
    ],
  },
  {
    bundleId: 'akita-capability-akita-gpb-kafka-mq-module-ff56f175d8c',
    moduleId: 'akita-gpb-kafka-mq-module',
    pin: 'ff56f175d8c',
    expectedStepSourceSuffixes: ['Steps.java'],
    expectedUnsupportedIds: [
      'kafkamq.helper-and-hook-internals-not-standalone-capabilities',
      'kafkamq.readme-claims-do-not-expand-runtime-truth',
      'kafkamq.generic-broker-administration-not-promised',
      'kafkamq-delivery-guarantees-and-ordering-not-promised',
      'kafkamq-arbitrary-streaming-semantics-not-promised',
      'kafkamq.kafka-generic-transport-parity-not-promised',
      'kafkamq.ibm-mq-selector-queue-surface-only',
      'kafkamq.artemis-topic-requires-reviewed-subscription-flow',
      'kafkamq.artemis-browse-is-nondestructive-only',
      'kafkamq.message-format-inference-beyond-reviewed-steps-not-promised',
    ],
  },
  {
    bundleId: 'akita-capability-ccl-additional-steps-module-95eda279aa4',
    moduleId: 'ccl-additional-steps-module',
    pin: '95eda279aa4',
    expectedStepSourceSuffixes: ['CommonSteps.java', 'ArraySteps.java', 'CircleSteps.java'],
    expectedUnsupportedIds: [
      'additional.helper-and-dependency-internals-not-standalone-capabilities',
      'additional.readme-claims-do-not-expand-runtime-truth',
      'additional.generic-scripting-and-expression-language-not-promised',
      'additional.generic-orchestration-framework-not-promised',
      'additional.arbitrary-polling-retry-eventual-consistency-engine-not-promised',
      'additional.universal-data-transformation-semantics-not-promised',
      'additional.generic-multipart-request-construction-platform-not-promised',
      'additional.cross-module-api-capabilities-not-re-exported',
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
        contract.supportedCapabilities.every((capability) =>
          bundle.expectedStepSourceSuffixes.some((suffix) => capability.sourcePath.endsWith(suffix)),
        ),
      ).toBe(true);
      for (const expectedSuffix of bundle.expectedStepSourceSuffixes) {
        expect(
          contract.supportedCapabilities.some((capability) => capability.sourcePath.endsWith(expectedSuffix)),
          `${bundle.bundleId}:${expectedSuffix}`,
        ).toBe(true);
      }
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
