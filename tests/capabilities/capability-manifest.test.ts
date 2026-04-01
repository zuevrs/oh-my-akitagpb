import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const manifestPath = path.join(repoRoot, 'assets', 'oma', 'capability-manifest.json');

const expectedBundleIds = [
  'akita-capability-akita-gpb-core-module-c795936046e',
  'akita-capability-akita-gpb-api-module-223b2561bbc',
] as const;

type CapabilityManifest = {
  schemaVersion: 1;
  activeCommandIds: string[];
  activeWorkflowSkills: string[];
  activeCapabilityBundles: Array<{
    bundleId: string;
    module: {
      id: string;
      pin: string;
    };
    skillPath: string;
    references: {
      capabilityContract: string;
      unsupportedCases: string;
      examples: string;
      provenance: string;
    };
  }>;
};

type CapabilityContract = {
  schemaVersion: 1;
  bundleId: string;
  module: {
    id: string;
    pin: string;
  };
};

type Provenance = {
  schemaVersion: 1;
  bundleId: string;
  moduleId: string;
  pin: string;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function assertLocalRuntimePath(runtimePath: string) {
  expect(runtimePath.startsWith('.opencode/skills/')).toBe(true);
  expect(runtimePath.startsWith('assets/')).toBe(false);
  expect(runtimePath.includes('..')).toBe(false);
  expect(path.posix.normalize(runtimePath)).toBe(runtimePath);
}

function resolveRuntimePathToAssetPath(runtimePath: string): string {
  assertLocalRuntimePath(runtimePath);
  return path.join(repoRoot, 'assets', runtimePath.slice(1));
}

describe('capability manifest', () => {
  it('activates the exact pinned commands, workflow skills, and capability bundles', () => {
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      activeCommandIds: ['akita-scan', 'akita-plan', 'akita-write', 'akita-validate'],
      activeWorkflowSkills: [
        'akita-scan-workflow',
        'akita-plan-workflow',
        'akita-write-workflow',
        'akita-validate-workflow',
      ],
    });
    expect(manifest.activeCapabilityBundles.map((bundle) => bundle.bundleId)).toEqual(expectedBundleIds);
  });

  it('uses only local runtime paths and every manifest entry resolves to a shipped bundle asset', () => {
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);

    const bundleIds = manifest.activeCapabilityBundles.map((bundle) => bundle.bundleId);
    expect(new Set(bundleIds).size).toBe(bundleIds.length);

    for (const bundle of manifest.activeCapabilityBundles) {
      const referencedPaths = [
        bundle.skillPath,
        bundle.references.capabilityContract,
        bundle.references.unsupportedCases,
        bundle.references.examples,
        bundle.references.provenance,
      ];

      for (const runtimePath of referencedPaths) {
        const assetPath = resolveRuntimePathToAssetPath(runtimePath);
        expect(existsSync(assetPath), `${bundle.bundleId}:${runtimePath}`).toBe(true);
      }
    }
  });

  it('keeps manifest metadata aligned with the reviewed bundle contracts and provenance files without exposing sourceZip in the installed runtime surface', () => {
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);

    expect(JSON.stringify(manifest)).not.toContain('sourceZip');

    for (const bundle of manifest.activeCapabilityBundles) {
      const contractPath = resolveRuntimePathToAssetPath(bundle.references.capabilityContract);
      const provenancePath = resolveRuntimePathToAssetPath(bundle.references.provenance);
      const contract = readJsonFile<CapabilityContract>(contractPath);
      const provenance = readJsonFile<Provenance>(provenancePath);

      expect(contract).toMatchObject({
        schemaVersion: 1,
        bundleId: bundle.bundleId,
        module: bundle.module,
      });
      expect(provenance).toMatchObject({
        schemaVersion: 1,
        bundleId: bundle.bundleId,
        moduleId: bundle.module.id,
        pin: bundle.module.pin,
      });
      expect(JSON.stringify(contract)).not.toContain('sourceZip');
      expect(JSON.stringify(provenance)).not.toContain('sourceZip');
      expect(bundle.skillPath).toBe(`.opencode/skills/${bundle.bundleId}/SKILL.md`);
      expect(bundle.references).toEqual({
        capabilityContract: `.opencode/skills/${bundle.bundleId}/references/capability-contract.json`,
        unsupportedCases: `.opencode/skills/${bundle.bundleId}/references/unsupported-cases.json`,
        examples: `.opencode/skills/${bundle.bundleId}/references/examples.json`,
        provenance: `.opencode/skills/${bundle.bundleId}/references/provenance.json`,
      });
    }
  });
});
