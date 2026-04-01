import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type SharedDataHandlingPolicy = {
  schemaVersion: 1;
  redactionRequired: boolean;
  markdownIsSummaryOnly: boolean;
  forbiddenSharedData: string[];
};

type WriteStateContract = {
  schemaVersion: 1;
  contractId: string;
  sharedStateBasePath: string;
  installedTemplateBasePath: string;
  planPrerequisites: {
    contractPath: string;
    sharedStateBasePath: string;
    requiredStatePaths: string[];
    writerMustReadFromDisk: boolean;
    description: string;
  };
  requiredMachineState: Array<{
    id: string;
    path: string;
    format: string;
    required: boolean;
    description: string;
  }>;
  ownership: {
    rulePath: string;
    packManagedStatePaths: string[];
    canonicalNewOrPackManagedWritesOnly: boolean;
    allowOverwriteOfPackManagedPathsOnly: boolean;
    forbidOwnershipUncertainWrites: boolean;
    description: string;
  };
  provenanceRequirements: {
    path: string;
    requiresApprovedPlanReference: boolean;
    requiresCapabilityBundleReferences: boolean;
    requiresGeneratedArtifactReferences: boolean;
    description: string;
  };
  generationReport: {
    path: string;
    allowedVerdicts: string[];
    recordsGeneratedArtifacts: boolean;
    recordsOmissions: boolean;
    recordsOwnershipBlocks: boolean;
    recordsStopConditions: boolean;
    description: string;
  };
  stopConditions: Array<{
    id: string;
    classification: string;
    reportIn: string;
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

type ValidateStateContract = {
  schemaVersion: 1;
  contractId: string;
  localStateBasePath: string;
  installedTemplateBasePath: string;
  writePrerequisites: {
    contractPath: string;
    sharedStateBasePath: string;
    requiredStatePaths: string[];
    validatorMustReadFromDisk: boolean;
    description: string;
  };
  requiredMachineState: Array<{
    id: string;
    path: string;
    format: string;
    required: boolean;
    description: string;
  }>;
  validationReport: {
    path: string;
    requiredFields: string[];
    allowedVerdicts: string[];
    rejectionReasons: string[];
    requiresPerArtifactFindings: boolean;
    requiresClearReason: boolean;
    description: string;
  };
  stopConditions: Array<{
    id: string;
    classification: string;
    reportIn: string;
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
    forbiddenLocalData: string[];
    allowedLocalData: string[];
  };
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const sharedPolicyPath = path.join(repoRoot, 'assets', 'oma', 'runtime', 'shared', 'data-handling-policy.json');
const writeContractPath = path.join(repoRoot, 'assets', 'oma', 'templates', 'write', 'state-contract.json');
const writeSummaryTemplatePath = path.join(repoRoot, 'assets', 'oma', 'templates', 'write', 'write-summary.md');
const validateContractPath = path.join(repoRoot, 'assets', 'oma', 'templates', 'validate', 'state-contract.json');
const validateSummaryTemplatePath = path.join(repoRoot, 'assets', 'oma', 'templates', 'validate', 'validate-summary.md');

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

describe('write and validate state contracts', () => {
  it('declares the exact canonical write outputs, prerequisites, and ownership rules', () => {
    const contract = readJsonFile<WriteStateContract>(writeContractPath);
    const machineStateEntries = contract.requiredMachineState.map((entry) => [entry.id, entry.path] as const);
    const machineStatePaths = contract.requiredMachineState.map((entry) => entry.path);

    expect(existsSync(writeContractPath)).toBe(true);
    expect(contract).toMatchObject({
      schemaVersion: 1,
      contractId: 'akita-write-state',
      sharedStateBasePath: '.oma/state/shared/write',
      installedTemplateBasePath: '.oma/templates/write',
    });
    expect(contract.planPrerequisites).toEqual({
      contractPath: '.oma/templates/plan/state-contract.json',
      sharedStateBasePath: '.oma/state/shared/plan',
      requiredStatePaths: [
        '.oma/state/shared/plan/approved-plan.json',
        '.oma/state/shared/plan/scenario-capability-matrix.json',
      ],
      writerMustReadFromDisk: true,
      description:
        'akita-write must consume the persisted approved plan and scenario capability matrix from disk before it decides what the supported subset can materialize.',
    });
    expect(machineStateEntries).toEqual([
      ['generated-artifacts', '.oma/state/shared/write/generated-artifacts.json'],
      ['provenance-bundle', '.oma/state/shared/write/provenance-bundle.json'],
      ['generation-report', '.oma/state/shared/write/generation-report.json'],
    ]);
    expect(new Set(machineStatePaths).size).toBe(machineStatePaths.length);

    for (const entry of contract.requiredMachineState) {
      expect(entry.required, entry.id).toBe(true);
      expect(entry.format, entry.id).toBe('json');
      expect(entry.path.startsWith(`${contract.sharedStateBasePath}/`), entry.id).toBe(true);
      expect(entry.path.endsWith('.json'), entry.id).toBe(true);
      expect(path.posix.normalize(entry.path), entry.id).toBe(entry.path);
      expect(entry.path.includes('..'), entry.id).toBe(false);
    }

    expect(contract.ownership).toEqual({
      rulePath: '.oma/instructions/rules/respect-pack-ownership.md',
      packManagedStatePaths: machineStatePaths,
      canonicalNewOrPackManagedWritesOnly: true,
      allowOverwriteOfPackManagedPathsOnly: true,
      forbidOwnershipUncertainWrites: true,
      description:
        'akita-write may update the pack-managed write state paths above and may create new repo artifacts only at approved-plan canonical targets. It must not overwrite non-pack-managed files or publish outside those canonical destinations.',
    });
    expect(contract.provenanceRequirements).toEqual({
      path: '.oma/state/shared/write/provenance-bundle.json',
      requiresApprovedPlanReference: true,
      requiresCapabilityBundleReferences: true,
      requiresGeneratedArtifactReferences: true,
      description:
        'Provenance must tie the generated artifact set to the approved plan snapshot and the shipped capability bundle truth used during generation.',
    });
    expect(contract.generationReport).toEqual({
      path: '.oma/state/shared/write/generation-report.json',
      allowedVerdicts: ['ok', 'partial', 'blocked'],
      recordsGeneratedArtifacts: true,
      recordsOmissions: true,
      recordsOwnershipBlocks: true,
      recordsStopConditions: true,
      description:
        'The generation report is the durable inspection surface for supported-subset omissions, ownership refusals, and explicit stop conditions.',
    });
    expect(contract.stopConditions.map((entry) => entry.id)).toEqual([
      'missing-approved-plan',
      'missing-scenario-capability-matrix',
      'missing-capability-bundle-file',
      'unsupported-or-partially-supported-output',
      'ownership-uncertain-target',
      'noncanonical-target-path',
    ]);
  });

  it('keeps write summary markdown secondary and write redaction aligned to the shared policy', () => {
    const contract = readJsonFile<WriteStateContract>(writeContractPath);
    const sharedPolicy = readJsonFile<SharedDataHandlingPolicy>(sharedPolicyPath);
    const machineStateIds = contract.requiredMachineState.map((entry) => entry.id);

    expect(existsSync(writeSummaryTemplatePath)).toBe(true);
    expect(contract.summaryState).toEqual({
      path: '.oma/state/shared/write/write-summary.md',
      templatePath: '.oma/templates/write/write-summary.md',
      format: 'markdown',
      required: false,
      canonical: false,
      mustBeDerivedFrom: machineStateIds,
      description: 'Human-readable write summary only. Canonical machine state stays in the JSON files above.',
    });
    expect(contract.redaction.policyPath).toBe('.oma/runtime/shared/data-handling-policy.json');
    expect(contract.redaction.redactionRequired).toBe(sharedPolicy.redactionRequired);
    expect(contract.redaction.markdownIsSummaryOnly).toBe(sharedPolicy.markdownIsSummaryOnly);
    expect(contract.redaction.allowedSharedData).toEqual([
      'repo-relative artifact paths',
      'approved plan flow ids',
      'capability bundle ids and module pins',
      'omission reasons',
    ]);
    expect(contract.redaction.forbiddenSharedData).toEqual([
      'secrets',
      'tokens',
      'credentials',
      'raw auth headers',
      'raw env values',
      'machine-local values',
    ]);

    for (const forbiddenEntry of sharedPolicy.forbiddenSharedData) {
      expect(contract.redaction.forbiddenSharedData).toContain(forbiddenEntry);
    }
  });

  it('declares the exact local validate report and explicit rejection/reporting rules', () => {
    const contract = readJsonFile<ValidateStateContract>(validateContractPath);
    const machineStateEntries = contract.requiredMachineState.map((entry) => [entry.id, entry.path] as const);
    const machineStatePaths = contract.requiredMachineState.map((entry) => entry.path);

    expect(existsSync(validateContractPath)).toBe(true);
    expect(contract).toMatchObject({
      schemaVersion: 1,
      contractId: 'akita-validate-state',
      localStateBasePath: '.oma/state/local/validate',
      installedTemplateBasePath: '.oma/templates/validate',
    });
    expect(contract.writePrerequisites).toEqual({
      contractPath: '.oma/templates/write/state-contract.json',
      sharedStateBasePath: '.oma/state/shared/write',
      requiredStatePaths: [
        '.oma/state/shared/write/generated-artifacts.json',
        '.oma/state/shared/write/provenance-bundle.json',
      ],
      validatorMustReadFromDisk: true,
      description:
        'akita-validate must consume the persisted generated artifact bundle and provenance bundle from disk before it evaluates capability eligibility.',
    });
    expect(machineStateEntries).toEqual([
      ['validation-report', '.oma/state/local/validate/validation-report.json'],
    ]);
    expect(new Set(machineStatePaths).size).toBe(machineStatePaths.length);

    for (const entry of contract.requiredMachineState) {
      expect(entry.required, entry.id).toBe(true);
      expect(entry.format, entry.id).toBe('json');
      expect(entry.path.startsWith(`${contract.localStateBasePath}/`), entry.id).toBe(true);
      expect(entry.path.endsWith('.json'), entry.id).toBe(true);
      expect(path.posix.normalize(entry.path), entry.id).toBe(entry.path);
      expect(entry.path.includes('..'), entry.id).toBe(false);
    }

    expect(contract.validationReport).toEqual({
      path: '.oma/state/local/validate/validation-report.json',
      requiredFields: ['verdict', 'reviewedArtifacts', 'findings'],
      allowedVerdicts: ['pass', 'fail', 'blocked'],
      rejectionReasons: [
        'unsupported-step',
        'unsupported-assertion',
        'bundle-unknown-construct',
        'lineage-drift',
        'missing-input-state',
        'missing-capability-bundle-file',
      ],
      requiresPerArtifactFindings: true,
      requiresClearReason: true,
      description:
        'The validation report is the durable inspection surface for verdicts, reviewed artifacts, and explicit rejection reasons.',
    });
    expect(contract.stopConditions.map((entry) => entry.id)).toEqual([
      'missing-generated-artifacts',
      'missing-provenance-bundle',
      'missing-capability-bundle-file',
      'unsupported-step-or-assertion',
      'bundle-unknown-construct',
      'lineage-drift',
    ]);
  });

  it('keeps validate summary markdown secondary and forbids secret leakage in local validation state', () => {
    const contract = readJsonFile<ValidateStateContract>(validateContractPath);
    const sharedPolicy = readJsonFile<SharedDataHandlingPolicy>(sharedPolicyPath);

    expect(existsSync(validateSummaryTemplatePath)).toBe(true);
    expect(contract.summaryState).toEqual({
      path: '.oma/state/local/validate/validate-summary.md',
      templatePath: '.oma/templates/validate/validate-summary.md',
      format: 'markdown',
      required: false,
      canonical: false,
      mustBeDerivedFrom: ['validation-report'],
      description: 'Human-readable validation summary only. Canonical machine state stays in the JSON report above.',
    });
    expect(contract.redaction.policyPath).toBe('.oma/runtime/shared/data-handling-policy.json');
    expect(contract.redaction.redactionRequired).toBe(sharedPolicy.redactionRequired);
    expect(contract.redaction.markdownIsSummaryOnly).toBe(sharedPolicy.markdownIsSummaryOnly);
    expect(contract.redaction.allowedLocalData).toEqual([
      'repo-relative artifact paths',
      'property keys',
      'bundle ids and module pins',
      'verdicts and rejection reasons',
    ]);
    expect(contract.redaction.forbiddenLocalData).toEqual([
      'secrets',
      'tokens',
      'credentials',
      'raw auth headers',
      'raw env values',
      'machine-local credentials',
    ]);

    for (const forbiddenEntry of sharedPolicy.forbiddenSharedData) {
      expect(contract.redaction.forbiddenLocalData).toContain(forbiddenEntry);
    }
  });
});
