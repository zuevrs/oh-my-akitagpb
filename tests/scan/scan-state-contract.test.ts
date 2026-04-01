import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type ScanStateContract = {
  schemaVersion: 1;
  contractId: string;
  sharedStateBasePath: string;
  installedTemplateBasePath: string;
  requiredMachineState: Array<{
    id: string;
    path: string;
    format: string;
    required: boolean;
    description: string;
  }>;
  summaryState: {
    path: string;
    templatePath: string;
    format: string;
    required: boolean;
    canonical: boolean;
    mustBeDerivedFrom: string[];
    description: string;
  };
  redaction: {
    policyPath: string;
    redactionRequired: boolean;
    markdownIsSummaryOnly: boolean;
    forbiddenSharedData: string[];
    allowedSharedData: string[];
  };
};

type SharedDataHandlingPolicy = {
  schemaVersion: 1;
  sharedStateBasePath: string;
  localStateBasePath: string;
  redactionRequired: boolean;
  markdownIsSummaryOnly: boolean;
  forbiddenSharedData: string[];
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const contractPath = path.join(repoRoot, 'assets', 'oma', 'templates', 'scan', 'state-contract.json');
const summaryTemplatePath = path.join(repoRoot, 'assets', 'oma', 'templates', 'scan', 'scan-summary.md');
const commandPath = path.join(repoRoot, 'assets', 'commands', 'akita-scan.md');
const workflowPath = path.join(repoRoot, 'assets', 'opencode', 'skills', 'akita-scan-workflow', 'SKILL.md');
const dataHandlingPolicyPath = path.join(repoRoot, 'assets', 'oma', 'runtime', 'shared', 'data-handling-policy.json');

const expectedMachineOutputs = [
  ['contracts', '.oma/state/shared/scan/contracts.json'],
  ['target-candidates', '.oma/state/shared/scan/target-candidates.json'],
  ['prior-art', '.oma/state/shared/scan/prior-art.json'],
  ['service-runtime-profile', '.oma/state/shared/scan/service-runtime-profile.json'],
  ['flow-candidates', '.oma/state/shared/scan/flow-candidates.json'],
  ['assertion-opportunities', '.oma/state/shared/scan/assertion-opportunities.json'],
] as const;

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

describe('scan state contract', () => {
  it('declares the exact canonical shared scan outputs and keeps them inside the pack-owned scan namespace', () => {
    const contract = readJsonFile<ScanStateContract>(contractPath);
    const machineStateEntries = contract.requiredMachineState.map((entry) => [entry.id, entry.path] as const);
    const machineStatePaths = contract.requiredMachineState.map((entry) => entry.path);

    expect(existsSync(contractPath)).toBe(true);
    expect(contract).toMatchObject({
      schemaVersion: 1,
      contractId: 'akita-scan-state',
      sharedStateBasePath: '.oma/state/shared/scan',
      installedTemplateBasePath: '.oma/templates/scan',
    });
    expect(machineStateEntries).toEqual(expectedMachineOutputs);
    expect(new Set(machineStatePaths).size).toBe(machineStatePaths.length);

    for (const entry of contract.requiredMachineState) {
      expect(entry.required, entry.id).toBe(true);
      expect(entry.format, entry.id).toBe('json');
      expect(entry.path.startsWith(`${contract.sharedStateBasePath}/`), entry.id).toBe(true);
      expect(entry.path.endsWith('.json'), entry.id).toBe(true);
      expect(path.posix.normalize(entry.path), entry.id).toBe(entry.path);
      expect(entry.path.includes('..'), entry.id).toBe(false);
    }
  });

  it('keeps markdown summary output secondary to the canonical JSON state', () => {
    const contract = readJsonFile<ScanStateContract>(contractPath);
    const machineStateIds = contract.requiredMachineState.map((entry) => entry.id);

    expect(existsSync(summaryTemplatePath)).toBe(true);
    expect(contract.summaryState).toEqual({
      path: '.oma/state/shared/scan/scan-summary.md',
      templatePath: '.oma/templates/scan/scan-summary.md',
      format: 'markdown',
      required: false,
      canonical: false,
      mustBeDerivedFrom: machineStateIds,
      description: 'Human-readable summary only. Canonical machine state stays in the JSON files above.',
    });
  });

  it('inherits shared redaction policy and explicitly forbids machine-local leakage in shared scan state', () => {
    const contract = readJsonFile<ScanStateContract>(contractPath);
    const sharedPolicy = readJsonFile<SharedDataHandlingPolicy>(dataHandlingPolicyPath);

    expect(contract.redaction.policyPath).toBe('.oma/runtime/shared/data-handling-policy.json');
    expect(contract.redaction.redactionRequired).toBe(sharedPolicy.redactionRequired);
    expect(contract.redaction.markdownIsSummaryOnly).toBe(sharedPolicy.markdownIsSummaryOnly);
    expect(contract.redaction.allowedSharedData).toEqual([
      'repo structure',
      'route hints',
      'prior-art paths',
      'capability evidence',
    ]);
    expect(contract.redaction.forbiddenSharedData).toEqual([
      'secrets',
      'tokens',
      'credentials',
      'raw auth headers',
      'machine-local values',
    ]);

    for (const forbiddenEntry of sharedPolicy.forbiddenSharedData) {
      expect(contract.redaction.forbiddenSharedData).toContain(forbiddenEntry);
    }
  });

  it('keeps the user-facing scan command and workflow aligned with the installed contract and stop conditions', () => {
    const contract = readJsonFile<ScanStateContract>(contractPath);
    const command = readFileSync(commandPath, 'utf8');
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(existsSync(commandPath)).toBe(true);
    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow.startsWith('---\n')).toBe(true);
    expect(workflow).toContain('name: akita-scan-workflow');
    expect(workflow).toContain('description:');

    for (const content of [command, workflow]) {
      expect(content).toContain('.oma/templates/scan/state-contract.json');
      expect(content).toContain('.oma/capability-manifest.json');
      expect(content).toContain('.oma/runtime/shared/data-handling-policy.json');
      expect(content).toContain(contract.summaryState.path);
      expect(content).toContain('code-first fallback');
      expect(content).toContain('needs-review');

      for (const entry of contract.requiredMachineState) {
        expect(content, entry.id).toContain(entry.path);
      }
    }

    expect(command).toContain('.oma/instructions/rules/');
    expect(workflow).toContain('.oma/instructions/rules/*.md');
  });
});
