import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type WriteStateContract = {
  schemaVersion: 1;
  contractId: string;
  planPrerequisites: {
    requiredStatePaths: string[];
  };
  requiredMachineState: Array<{
    id: string;
    path: string;
  }>;
  ownership: {
    rulePath: string;
    canonicalNewOrPackManagedWritesOnly: boolean;
    allowOverwriteOfPackManagedPathsOnly: boolean;
    forbidOwnershipUncertainWrites: boolean;
  };
  provenanceRequirements: {
    path: string;
    requiresApprovedPlanReference: boolean;
    requiresCapabilityBundleReferences: boolean;
    requiresGeneratedArtifactReferences: boolean;
  };
  generationReport: {
    path: string;
    allowedVerdicts: string[];
    recordsGeneratedArtifacts: boolean;
    recordsOmissions: boolean;
    recordsOwnershipBlocks: boolean;
    recordsStopConditions: boolean;
  };
  stopConditions: Array<{
    id: string;
  }>;
  summaryState: {
    path: string;
  };
};

type CapabilityManifest = {
  activeCapabilityBundles: Array<{
    bundleId: string;
    skillPath: string;
    references: Record<string, string>;
  }>;
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const contractPath = path.join(repoRoot, 'assets', 'oma', 'templates', 'write', 'state-contract.json');
const manifestPath = path.join(repoRoot, 'assets', 'oma', 'capability-manifest.json');
const commandPath = path.join(repoRoot, 'assets', 'commands', 'akita-write.md');
const workflowPath = path.join(repoRoot, 'assets', 'opencode', 'skills', 'akita-write-workflow', 'SKILL.md');
const ownershipRulePath = path.join(repoRoot, 'assets', 'oma', 'instructions', 'rules', 'respect-pack-ownership.md');
const neverInventRulePath = path.join(repoRoot, 'assets', 'oma', 'instructions', 'rules', 'never-invent-steps.md');
const dataHandlingPolicyPath = path.join(repoRoot, 'assets', 'oma', 'runtime', 'shared', 'data-handling-policy.json');

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function resolveRuntimePathToAssetPath(runtimePath: string): string {
  expect(runtimePath.startsWith('.opencode/skills/')).toBe(true);
  expect(runtimePath.includes('..')).toBe(false);
  expect(path.posix.normalize(runtimePath)).toBe(runtimePath);
  return path.join(repoRoot, 'assets', runtimePath.slice(1));
}

describe('write command contract', () => {
  it('keeps the shipped write command and workflow aligned to the installed write contract prerequisites and outputs', () => {
    const contract = readJsonFile<WriteStateContract>(contractPath);
    const command = readFileSync(commandPath, 'utf8');
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(existsSync(commandPath)).toBe(true);
    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow.startsWith('---\n')).toBe(true);
    expect(workflow).toContain('name: akita-write-workflow');
    expect(workflow).toContain('description:');

    for (const content of [command, workflow]) {
      expect(content).toContain('.oma/templates/write/state-contract.json');
      expect(content).toContain('.oma/templates/feature/default.feature.md');
      expect(content).toContain('.oma/templates/payload/property-file.md');
      expect(content).toContain('.oma/capability-manifest.json');
      expect(content).toContain(dataHandlingPolicyPath.replace(path.join(repoRoot, 'assets') + path.sep, '.').replace(/\\/g, '/'));
      expect(content).toContain(contract.ownership.rulePath);
      expect(content).toContain('.oma/instructions/rules/never-invent-steps.md');
      expect(content).toMatch(/resolve every manifest-listed `activeCapabilityBundles\[\*\]\.skillPath`.*references\.\*/i);
      expect(content).toMatch(/stop/i);
      expect(content).toMatch(/needs-review/i);

      for (const requiredPath of contract.planPrerequisites.requiredStatePaths) {
        expect(content, requiredPath).toContain(requiredPath);
      }

      for (const statePath of contract.requiredMachineState.map((entry) => entry.path)) {
        expect(content, statePath).toContain(statePath);
      }

      expect(content).toContain(contract.summaryState.path);
      expect(content).toContain(contract.provenanceRequirements.path);
      expect(content).toContain(contract.generationReport.path);
    }
  });

  it('pins manifest-first bundle truth and ownership refusal semantics instead of letting write invent unsupported behavior', () => {
    const contract = readJsonFile<WriteStateContract>(contractPath);
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    const command = readFileSync(commandPath, 'utf8');
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(existsSync(ownershipRulePath)).toBe(true);
    expect(existsSync(neverInventRulePath)).toBe(true);
    expect(existsSync(dataHandlingPolicyPath)).toBe(true);

    expect(contract.ownership.canonicalNewOrPackManagedWritesOnly).toBe(true);
    expect(contract.ownership.allowOverwriteOfPackManagedPathsOnly).toBe(true);
    expect(contract.ownership.forbidOwnershipUncertainWrites).toBe(true);
    expect(contract.provenanceRequirements.requiresApprovedPlanReference).toBe(true);
    expect(contract.provenanceRequirements.requiresCapabilityBundleReferences).toBe(true);
    expect(contract.provenanceRequirements.requiresGeneratedArtifactReferences).toBe(true);
    expect(contract.generationReport.allowedVerdicts).toEqual(['ok', 'partial', 'blocked']);
    expect(contract.generationReport.recordsGeneratedArtifacts).toBe(true);
    expect(contract.generationReport.recordsOmissions).toBe(true);
    expect(contract.generationReport.recordsOwnershipBlocks).toBe(true);
    expect(contract.generationReport.recordsStopConditions).toBe(true);
    expect(contract.stopConditions.map((entry) => entry.id)).toEqual([
      'missing-approved-plan',
      'missing-scenario-capability-matrix',
      'missing-capability-bundle-file',
      'unsupported-or-partially-supported-output',
      'ownership-uncertain-target',
      'noncanonical-target-path',
    ]);

    for (const bundle of manifest.activeCapabilityBundles) {
      expect(existsSync(resolveRuntimePathToAssetPath(bundle.skillPath)), bundle.skillPath).toBe(true);
      for (const runtimePath of Object.values(bundle.references)) {
        expect(existsSync(resolveRuntimePathToAssetPath(runtimePath)), runtimePath).toBe(true);
      }
    }

    expect(command).toMatch(/materialize only the supported subset/i);
    expect(command).toMatch(/do not overwrite non-pack-managed files/i);
    expect(command).toMatch(/ownership-uncertain or noncanonical targets/i);
    expect(command).toMatch(/keep unsupported outputs out of `\.oma\/state\/shared\/write\/generated-artifacts\.json`/i);
    expect(command).toMatch(/record omissions plus explicit reasons in `\.oma\/state\/shared\/write\/generation-report\.json`/i);
    expect(command).toMatch(/manifest-listed bundle ids\/module pins/i);

    expect(workflow).toMatch(/generated artifact set/i);
    expect(workflow).toMatch(/verdict `ok`, `partial`, or `blocked`/i);
    expect(workflow).toMatch(/supported subset/i);
    expect(workflow).toMatch(/ownership-uncertain or noncanonical/i);
    expect(workflow).toMatch(/instead of overwriting or publishing outside canonical new or pack-managed locations/i);
    expect(workflow).toMatch(/instead of inventing steps or provenance/i);
  });
});
