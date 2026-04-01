import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type ScanStateContract = {
  sharedStateBasePath: string;
  requiredMachineState: Array<{
    id: string;
    path: string;
  }>;
};

type PlanStateContract = {
  schemaVersion: 1;
  contractId: string;
  sharedStateBasePath: string;
  installedTemplateBasePath: string;
  scanPrerequisites: {
    contractPath: string;
    sharedStateBasePath: string;
    requiredStatePaths: string[];
    plannerMustReadFromDisk: boolean;
    description: string;
  };
  requiredMachineState: Array<{
    id: string;
    path: string;
    format: string;
    required: boolean;
    appendOnly?: boolean;
    creationGate?: string;
    description: string;
  }>;
  shortlistPolicy: {
    targetMinItems: number;
    maxItems: number;
    shortlistStoredIn: string;
    backlogStoredIn: string;
    doNotPadShortlist: boolean;
    allowShortageNeedsReview: boolean;
    shortageRecordedIn: string;
    description: string;
  };
  reviewActions: Array<{
    id: string;
    command: string;
    kind: string;
    writesApprovedPlan: boolean;
    description: string;
  }>;
  approvalState: {
    path: string;
    initialStatus: string;
    reviewStatus: string;
    allowedStatuses: string[];
    approvedPlanPath: string;
    approvedPlanDefaultExists: boolean;
    approvedPlanRequiresExplicitAction: boolean;
    transitions: Array<{
      from: string;
      action: string;
      to: string;
      writesApprovedPlan: boolean;
    }>;
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

type SharedDataHandlingPolicy = {
  schemaVersion: 1;
  redactionRequired: boolean;
  markdownIsSummaryOnly: boolean;
  forbiddenSharedData: string[];
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scanContractPath = path.join(repoRoot, 'assets', 'oma', 'templates', 'scan', 'state-contract.json');
const contractPath = path.join(repoRoot, 'assets', 'oma', 'templates', 'plan', 'state-contract.json');
const summaryTemplatePath = path.join(repoRoot, 'assets', 'oma', 'templates', 'plan', 'plan-summary.md');
const commandPath = path.join(repoRoot, 'assets', 'commands', 'akita-plan.md');
const workflowPath = path.join(repoRoot, 'assets', 'opencode', 'skills', 'akita-plan-workflow', 'SKILL.md');
const dataHandlingPolicyPath = path.join(repoRoot, 'assets', 'oma', 'runtime', 'shared', 'data-handling-policy.json');

const expectedMachineOutputs = [
  ['active-target', '.oma/state/shared/plan/active-target.json'],
  ['current-plan', '.oma/state/shared/plan/current-plan.json'],
  ['flow-scorecards', '.oma/state/shared/plan/flow-scorecards.json'],
  ['scenario-capability-matrix', '.oma/state/shared/plan/scenario-capability-matrix.json'],
  ['decision-log', '.oma/state/shared/plan/decision-log.json'],
  ['approval-state', '.oma/state/shared/plan/approval-state.json'],
  ['unresolved', '.oma/state/shared/plan/unresolved.json'],
  ['approved-plan', '.oma/state/shared/plan/approved-plan.json'],
] as const;

const expectedReviewCommands = [
  'approve all',
  'approve <ids>',
  'reject <ids>',
  'adjust <id>: <instruction>',
  'change target',
  'regenerate shortlist',
] as const;

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

describe('plan approval contract', () => {
  it('declares the exact persisted plan outputs and binds them to the plan namespace', () => {
    const contract = readJsonFile<PlanStateContract>(contractPath);
    const machineStateEntries = contract.requiredMachineState.map((entry) => [entry.id, entry.path] as const);
    const machineStatePaths = contract.requiredMachineState.map((entry) => entry.path);

    expect(existsSync(contractPath)).toBe(true);
    expect(contract).toMatchObject({
      schemaVersion: 1,
      contractId: 'akita-plan-state',
      sharedStateBasePath: '.oma/state/shared/plan',
      installedTemplateBasePath: '.oma/templates/plan',
    });
    expect(machineStateEntries).toEqual(expectedMachineOutputs);
    expect(new Set(machineStatePaths).size).toBe(machineStatePaths.length);

    for (const entry of contract.requiredMachineState) {
      expect(entry.format, entry.id).toBe('json');
      expect(entry.path.startsWith(`${contract.sharedStateBasePath}/`), entry.id).toBe(true);
      expect(entry.path.endsWith('.json'), entry.id).toBe(true);
      expect(path.posix.normalize(entry.path), entry.id).toBe(entry.path);
      expect(entry.path.includes('..'), entry.id).toBe(false);
    }

    const decisionLog = contract.requiredMachineState.find((entry) => entry.id === 'decision-log');
    const approvedPlan = contract.requiredMachineState.find((entry) => entry.id === 'approved-plan');

    expect(decisionLog?.appendOnly).toBe(true);
    expect(approvedPlan?.required).toBe(false);
    expect(approvedPlan?.creationGate).toBe('explicit-approve');
  });

  it('requires persisted scan outputs as prerequisites instead of allowing planning from chat memory', () => {
    const contract = readJsonFile<PlanStateContract>(contractPath);
    const scanContract = readJsonFile<ScanStateContract>(scanContractPath);

    expect(contract.scanPrerequisites).toEqual({
      contractPath: '.oma/templates/scan/state-contract.json',
      sharedStateBasePath: scanContract.sharedStateBasePath,
      requiredStatePaths: scanContract.requiredMachineState.map((entry) => entry.path),
      plannerMustReadFromDisk: true,
      description:
        'akita-plan must consume the persisted scan outputs above and stop when they are missing instead of reconstructing repo facts from chat memory.',
    });
  });

  it('encodes the 3-7 target range without padding and records honest shortage handling', () => {
    const contract = readJsonFile<PlanStateContract>(contractPath);
    const reviewCommands = contract.reviewActions.map((action) => action.command);

    expect(contract.shortlistPolicy).toMatchObject({
      targetMinItems: 3,
      maxItems: 7,
      shortlistStoredIn: 'current-plan',
      backlogStoredIn: 'current-plan',
      doNotPadShortlist: true,
      allowShortageNeedsReview: true,
      shortageRecordedIn: 'unresolved',
    });
    expect(reviewCommands).toEqual(expectedReviewCommands);
    expect(contract.reviewActions.filter((action) => action.writesApprovedPlan).map((action) => action.command)).toEqual([
      'approve all',
      'approve <ids>',
    ]);
    expect(contract.stopConditions.map((entry) => entry.id)).toEqual([
      'missing-scan-state',
      'missing-capability-bundle-file',
      'insufficient-viable-flows',
      'ambiguous-target-binding',
    ]);
  });

  it('gates approved-plan creation behind explicit approve transitions only and allows needs-review shortage state', () => {
    const contract = readJsonFile<PlanStateContract>(contractPath);
    const transitionsThatWriteApprovedPlan = contract.approvalState.transitions.filter((transition) => transition.writesApprovedPlan);
    const transitionActions = contract.approvalState.transitions.map((transition) => transition.action);

    expect(contract.approvalState).toMatchObject({
      path: '.oma/state/shared/plan/approval-state.json',
      initialStatus: 'draft',
      reviewStatus: 'in_review',
      approvedPlanPath: '.oma/state/shared/plan/approved-plan.json',
      approvedPlanDefaultExists: false,
      approvedPlanRequiresExplicitAction: true,
    });
    expect(contract.approvalState.allowedStatuses).toEqual(['draft', 'in_review', 'approved', 'rejected', 'superseded', 'needs-review']);
    expect(transitionsThatWriteApprovedPlan).toEqual([
      { from: 'in_review', action: 'approve all', to: 'approved', writesApprovedPlan: true },
      { from: 'in_review', action: 'approve <ids>', to: 'approved', writesApprovedPlan: true },
    ]);

    for (const command of expectedReviewCommands) {
      expect(transitionActions).toContain(command);
    }
    expect(transitionActions).toContain('shortage detected');
    expect(transitionActions).not.toContain('approve');
  });

  it('keeps markdown summary output secondary and inherits shared redaction policy', () => {
    const contract = readJsonFile<PlanStateContract>(contractPath);
    const sharedPolicy = readJsonFile<SharedDataHandlingPolicy>(dataHandlingPolicyPath);
    const machineStateIds = contract.requiredMachineState.map((entry) => entry.id);

    expect(existsSync(summaryTemplatePath)).toBe(true);
    expect(contract.summaryState).toEqual({
      path: '.oma/state/shared/plan/plan-summary.md',
      templatePath: '.oma/templates/plan/plan-summary.md',
      format: 'markdown',
      required: false,
      canonical: false,
      mustBeDerivedFrom: machineStateIds,
      description: 'Human-readable review packet only. Canonical machine state stays in the JSON files above.',
    });

    expect(contract.redaction.policyPath).toBe('.oma/runtime/shared/data-handling-policy.json');
    expect(contract.redaction.redactionRequired).toBe(sharedPolicy.redactionRequired);
    expect(contract.redaction.markdownIsSummaryOnly).toBe(sharedPolicy.markdownIsSummaryOnly);
    expect(contract.redaction.allowedSharedData).toEqual([
      'target bindings',
      'flow rankings',
      'capability evidence',
      'review decisions',
      'observation notes',
      'shortage reasons',
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

  it('keeps the user-facing plan command and workflow aligned with prerequisites, review actions, shortage handling, and official skill frontmatter', () => {
    const contract = readJsonFile<PlanStateContract>(contractPath);
    const command = readFileSync(commandPath, 'utf8');
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(existsSync(commandPath)).toBe(true);
    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow.startsWith('---\n')).toBe(true);
    expect(workflow).toContain('name: akita-plan-workflow');
    expect(workflow).toContain('description:');

    for (const content of [command, workflow]) {
      expect(content).toContain('.oma/templates/plan/state-contract.json');
      expect(content).toContain('.oma/capability-manifest.json');
      expect(content).toContain('.oma/runtime/shared/data-handling-policy.json');
      expect(content).toContain(contract.approvalState.path);
      expect(content).toContain(contract.approvalState.approvedPlanPath);
      expect(content).toContain('.oma/state/shared/plan/unresolved.json');
      expect(content).toContain(contract.summaryState.path);
      expect(content).toMatch(/needs-review/i);
      expect(content).toMatch(/do \*\*not\*\* pad the shortlist|do not pad the shortlist/i);

      for (const requiredPath of contract.scanPrerequisites.requiredStatePaths) {
        expect(content).toContain(requiredPath);
      }

      for (const entry of contract.requiredMachineState) {
        expect(content, entry.id).toContain(entry.path);
      }

      for (const reviewAction of contract.reviewActions) {
        expect(content, reviewAction.command).toContain(reviewAction.command);
      }
    }

    expect(command).toContain('/akita-scan');
    expect(command).toMatch(/do not create `\.oma\/state\/shared\/plan\/approved-plan\.json` until the user explicitly chooses `approve all` or `approve <ids>`/i);
    expect(workflow).toMatch(/Do not create `\.oma\/state\/shared\/plan\/approved-plan\.json` unless the user explicitly chooses `approve all` or `approve <ids>`/i);
  });
});
