import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type ValidateStateContract = {
  schemaVersion: 1;
  contractId: string;
  writePrerequisites: {
    contractPath: string;
    requiredStatePaths: string[];
  };
  requiredMachineState: Array<{
    id: string;
    path: string;
  }>;
  validationReport: {
    path: string;
    requiredFields: string[];
    allowedVerdicts: string[];
    rejectionReasons: string[];
    requiresPerArtifactFindings: boolean;
    requiresClearReason: boolean;
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
const contractPath = path.join(repoRoot, 'assets', 'oma', 'templates', 'validate', 'state-contract.json');
const manifestPath = path.join(repoRoot, 'assets', 'oma', 'capability-manifest.json');
const commandPath = path.join(repoRoot, 'assets', 'commands', 'akita-validate.md');
const workflowPath = path.join(repoRoot, 'assets', 'opencode', 'skills', 'akita-validate-workflow', 'SKILL.md');
const explicitUnsupportedRulePath = path.join(repoRoot, 'assets', 'oma', 'instructions', 'rules', 'explicit-unsupported.md');
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

describe('validate command contract', () => {
  it('keeps the shipped validate command and workflow aligned to the installed validate contract prerequisites and outputs', () => {
    const contract = readJsonFile<ValidateStateContract>(contractPath);
    const command = readFileSync(commandPath, 'utf8');
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(existsSync(commandPath)).toBe(true);
    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow.startsWith('---\n')).toBe(true);
    expect(workflow).toContain('name: akita-validate-workflow');
    expect(workflow).toContain('description:');

    for (const content of [command, workflow]) {
      expect(content).toContain('.oma/templates/validate/state-contract.json');
      expect(content).toContain(contract.writePrerequisites.contractPath);
      expect(content).toContain('.oma/capability-manifest.json');
      expect(content).toContain(dataHandlingPolicyPath.replace(path.join(repoRoot, 'assets') + path.sep, '.').replace(/\\/g, '/'));
      expect(content).toContain('.oma/instructions/rules/explicit-unsupported.md');
      expect(content).toMatch(/resolve every manifest-listed `activeCapabilityBundles\[\*\]\.skillPath`.*references\.\*/i);
      expect(content).toMatch(/stop/i);
      expect(content).toMatch(/blocked/i);

      for (const requiredPath of contract.writePrerequisites.requiredStatePaths) {
        expect(content, requiredPath).toContain(requiredPath);
      }

      for (const statePath of contract.requiredMachineState.map((entry) => entry.path)) {
        expect(content, statePath).toContain(statePath);
      }

      expect(content).toContain(contract.summaryState.path);
      expect(content).toContain(contract.validationReport.path);

      for (const field of contract.validationReport.requiredFields) {
        expect(content, field).toContain(field);
      }
    }
  });

  it('pins manifest-first bundle truth and explicit rejection semantics instead of silently passing partial validation', () => {
    const contract = readJsonFile<ValidateStateContract>(contractPath);
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    const command = readFileSync(commandPath, 'utf8');
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(existsSync(explicitUnsupportedRulePath)).toBe(true);
    expect(existsSync(dataHandlingPolicyPath)).toBe(true);

    expect(contract.validationReport.allowedVerdicts).toEqual(['pass', 'fail', 'blocked']);
    expect(contract.validationReport.requiresPerArtifactFindings).toBe(true);
    expect(contract.validationReport.requiresClearReason).toBe(true);
    expect(contract.validationReport.rejectionReasons).toEqual([
      'unsupported-step',
      'unsupported-assertion',
      'bundle-unknown-construct',
      'lineage-drift',
      'missing-input-state',
      'missing-capability-bundle-file',
    ]);
    expect(contract.stopConditions.map((entry) => entry.id)).toEqual([
      'missing-generated-artifacts',
      'missing-provenance-bundle',
      'missing-capability-bundle-file',
      'unsupported-step-or-assertion',
      'bundle-unknown-construct',
      'lineage-drift',
    ]);

    for (const bundle of manifest.activeCapabilityBundles) {
      expect(existsSync(resolveRuntimePathToAssetPath(bundle.skillPath)), bundle.skillPath).toBe(true);
      for (const runtimePath of Object.values(bundle.references)) {
        expect(existsSync(resolveRuntimePathToAssetPath(runtimePath)), runtimePath).toBe(true);
      }
    }

    expect(command).toMatch(/validate only the reviewed artifact set recorded in `\.oma\/state\/shared\/write\/generated-artifacts\.json`/i);
    expect(command).toMatch(/against `\.oma\/state\/shared\/write\/provenance-bundle\.json` and manifest-listed bundle truth/i);
    expect(command).toMatch(/`unsupported-step`, `unsupported-assertion`, `bundle-unknown-construct`, and `lineage-drift` explicitly/i);
    expect(command).toMatch(/`missing-input-state` or `missing-capability-bundle-file`/i);
    expect(command).toMatch(/instead of silently passing partial coverage/i);

    expect(workflow).toMatch(/do not validate artifacts outside that bundle or invent missing coverage/i);
    expect(workflow).toMatch(/reject unsupported steps, unsupported assertions, and bundle-unknown constructs explicitly/i);
    expect(workflow).toMatch(/`verdict` `pass`, `fail`, or `blocked`; `reviewedArtifacts`; and `findings`/i);
    expect(workflow).toMatch(/record `missing-input-state`/i);
    expect(workflow).toMatch(/record `missing-capability-bundle-file`/i);
    expect(workflow).toMatch(/fail with a `lineage-drift` finding/i);
    expect(workflow).toMatch(/instead of silently passing partial coverage/i);
  });
});
