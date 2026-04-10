import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PactProviderPlanState, PactPlanVerdict } from './plan-proof.js';
import type { PactProviderScanState, RelevanceVerdict } from './scan-proof.js';
import type { PactProviderWriteState, PactWriteOutcome } from './write-proof.js';

export type PactValidateOutcome = 'ready' | 'partial' | 'blocked' | 'irrelevant' | 'inconsistent';
export type ValidateInputVerdict<T extends string> = T | 'missing';
export type StateConsistencyVerdict = 'consistent' | 'blocked' | 'inconsistent';
export type CompileCheckVerdict = 'passed' | 'failed' | 'blocked' | 'not-applicable';
export type RunnableVerificationVerdict = 'proven' | 'ready' | 'blocked' | 'unproven' | 'not-applicable';

export interface PactProviderValidateState {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  scanStatePath: string | null;
  planStatePath: string | null;
  writeStatePath: string | null;
  inputVerdicts: {
    scan: ValidateInputVerdict<RelevanceVerdict>;
    plan: ValidateInputVerdict<PactPlanVerdict>;
    write: ValidateInputVerdict<PactWriteOutcome>;
  };
  validationOutcome: PactValidateOutcome;
  stateConsistency: {
    verdict: StateConsistencyVerdict;
    checks: string[];
    issues: string[];
  };
  repoRealityChecks: {
    expectedArtifactsPresent: string[];
    expectedArtifactsMissing: string[];
    scaffoldMarkersVerified: string[];
    scaffoldMarkersMissing: string[];
    intentionallyNotWritten: Array<{
      path: string;
      reason: string;
    }>;
    notes: string[];
  };
  compileCheck: {
    verdict: CompileCheckVerdict;
    proofLevel: 'structural' | 'command' | 'none';
    command: string | null;
    evidence: string[];
  };
  runnableVerificationCheck: {
    verdict: RunnableVerificationVerdict;
    command: string | null;
    evidence: string[];
  };
  remainingBlockers: string[];
  manualFollowUps: string[];
  evidence: string[];
  notes: string[];
}

export interface ProofValidateArtifacts {
  state: PactProviderValidateState;
  statePath: string;
  summaryPath: string;
}

interface LoadedState<T> {
  path: string;
  relativePath: string;
  state: T | null;
  issue: string | null;
}

const INSTALLED_VALIDATE_CONTRACT_RELATIVE_PATH = path.join(
  '.oma',
  'packs',
  'oh-my-pactgpb',
  'templates',
  'validate',
  'state-contract.json',
);
const PERSISTED_SCAN_STATE_RELATIVE_PATH = path.join(
  '.oma',
  'packs',
  'oh-my-pactgpb',
  'state',
  'shared',
  'scan',
  'scan-state.json',
);
const PERSISTED_PLAN_STATE_RELATIVE_PATH = path.join(
  '.oma',
  'packs',
  'oh-my-pactgpb',
  'state',
  'shared',
  'plan',
  'plan-state.json',
);
const PERSISTED_WRITE_STATE_RELATIVE_PATH = path.join(
  '.oma',
  'packs',
  'oh-my-pactgpb',
  'state',
  'shared',
  'write',
  'write-state.json',
);

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function loadOptionalState<T>(projectRoot: string, relativePath: string, label: string): LoadedState<T> {
  const absolutePath = path.join(projectRoot, relativePath);
  const posixRelativePath = toPosixPath(relativePath);

  if (!existsSync(absolutePath)) {
    return {
      path: absolutePath,
      relativePath: posixRelativePath,
      state: null,
      issue: `Required persisted ${label} is missing: ${posixRelativePath}`,
    };
  }

  try {
    return {
      path: absolutePath,
      relativePath: posixRelativePath,
      state: readJsonFile<T>(absolutePath),
      issue: null,
    };
  } catch (error) {
    return {
      path: absolutePath,
      relativePath: posixRelativePath,
      state: null,
      issue: `Required persisted ${label} is invalid JSON: ${posixRelativePath} (${error instanceof Error ? error.message : 'unknown parse failure'})`,
    };
  }
}

function determineInputVerdicts(
  scanState: PactProviderScanState | null,
  planState: PactProviderPlanState | null,
  writeState: PactProviderWriteState | null,
): PactProviderValidateState['inputVerdicts'] {
  return {
    scan: scanState?.relevance.verdict ?? 'missing',
    plan: planState?.verificationReadiness.verdict ?? 'missing',
    write: writeState?.writeOutcome ?? 'missing',
  };
}

function evaluateStateConsistency(
  scanLoad: LoadedState<PactProviderScanState>,
  planLoad: LoadedState<PactProviderPlanState>,
  writeLoad: LoadedState<PactProviderWriteState>,
): PactProviderValidateState['stateConsistency'] {
  const checks: string[] = [];
  const issues: string[] = [];
  const scanState = scanLoad.state;
  const planState = planLoad.state;
  const writeState = writeLoad.state;

  for (const issue of [scanLoad.issue, planLoad.issue, writeLoad.issue]) {
    if (issue) {
      issues.push(issue);
    }
  }

  if (scanState) {
    checks.push(`Loaded persisted scan-state from ${scanLoad.relativePath}.`);
  }
  if (planState) {
    checks.push(`Loaded persisted plan-state from ${planLoad.relativePath}.`);
  }
  if (writeState) {
    checks.push(`Loaded persisted write-state from ${writeLoad.relativePath}.`);
  }

  if (issues.length > 0) {
    return {
      verdict: 'blocked',
      checks: uniqueSorted(checks),
      issues: uniqueSorted(issues),
    };
  }

  if (!scanState || !planState || !writeState) {
    return {
      verdict: 'blocked',
      checks: uniqueSorted(checks),
      issues: ['Validation inputs are incomplete, so the persisted verdict chain cannot be checked honestly.'],
    };
  }

  checks.push('Persisted scan, plan, and write inputs are all present.');

  if (scanState.relevance.verdict === 'irrelevant') {
    if (planState.verificationReadiness.verdict !== 'irrelevant') {
      issues.push('Scan marked Pact as irrelevant, but plan-state did not preserve the irrelevant verdict.');
    } else {
      checks.push('Plan-state preserved the irrelevant scan verdict.');
    }

    if (writeState.writeOutcome !== 'no-op') {
      issues.push('Scan/plan marked Pact as irrelevant, but write-state did not preserve an honest no-op outcome.');
    } else {
      checks.push('Write-state preserved the irrelevant verdict as an honest no-op.');
    }
  }

  if (planState.providerSelection.name !== writeState.providerSelection.name) {
    issues.push('Plan-state and write-state disagree on the selected provider.');
  } else {
    checks.push(`Plan-state and write-state agree on provider selection: ${planState.providerSelection.name ?? '(blocked or unclear)'}.`);
  }

  if (scanState.provider.name && planState.providerSelection.name && scanState.provider.name !== planState.providerSelection.name) {
    issues.push('Scan-state and plan-state disagree on provider identity.');
  } else if (scanState.provider.name && planState.providerSelection.name) {
    checks.push(`Scan-state and plan-state agree on provider identity: ${scanState.provider.name}.`);
  }

  const planVerdict = planState.verificationReadiness.verdict;
  const writeOutcome = writeState.writeOutcome;
  if (planVerdict === 'blocked') {
    if (writeOutcome !== 'blocked') {
      issues.push('Plan-state is blocked, but write-state did not preserve a blocked outcome.');
    } else {
      checks.push('Blocked plan verdict was preserved by write-state.');
    }
  }

  if (planVerdict === 'irrelevant') {
    if (writeOutcome !== 'no-op') {
      issues.push('Plan-state is irrelevant, but write-state did not preserve an honest no-op outcome.');
    } else {
      checks.push('Irrelevant plan verdict was preserved by write-state as no-op.');
    }
  }

  if (planVerdict === 'needs-provider-state-work') {
    const providerStateStillUnresolved = [
      ...writeState.unresolvedBlockers,
      ...writeState.manualFollowUps,
    ].some((entry) => /provider state/i.test(entry));

    if (writeOutcome === 'written') {
      if (providerStateStillUnresolved) {
        issues.push('Plan-state required provider-state work, but write-state claimed a written outcome while provider-state gaps still remained unresolved.');
      } else {
        checks.push('Write-state resolved the targeted provider-state slice and recorded a written outcome.');
      }
    } else if (writeOutcome === 'partial') {
      checks.push('Write-state preserved the partial nature of the needs-provider-state-work verdict.');
    }
  }

  if (planVerdict === 'needs-artifact-source-clarification') {
    if (writeOutcome === 'written') {
      issues.push('Plan-state still required artifact-source clarification, so write-state should not promote the outcome to fully written.');
    } else if (writeOutcome === 'partial') {
      checks.push('Write-state preserved the partial nature of the needs-artifact-source-clarification verdict.');
    }
  }

  return {
    verdict: issues.length > 0 ? 'inconsistent' : 'consistent',
    checks: uniqueSorted(checks),
    issues: uniqueSorted(issues),
  };
}

function expectedProviderTestMarkers(
  scanState: PactProviderScanState,
  planState: PactProviderPlanState,
  writeState: PactProviderWriteState,
): string[] {
  const markers = [
    'PactVerificationContext',
    'verifyInteraction()',
  ];

  if (planState.providerSelection.name) {
    markers.push(`@Provider("${planState.providerSelection.name}")`);
  }

  if (writeState.writeOutcome === 'written' || writeState.writeOutcome === 'partial' || writeState.filesPlanned.some((file) => file.endsWith('PactTest.java'))) {
    markers.push('HttpTestTarget');
    markers.push('context.setTarget(new HttpTestTarget("localhost", 8080));');
  }

  if (scanState.artifactSource.verdict === 'local') {
    markers.push('@PactFolder(');
  }

  if (scanState.artifactSource.verdict === 'broker') {
    markers.push('@PactBroker');
  }

  if (planState.verificationReadiness.verdict === 'needs-provider-state-work') {
    const unresolvedProviderStateNames = writeState.unresolvedBlockers.some((blocker) => blocker.toLowerCase().includes('provider state names'));
    if (unresolvedProviderStateNames) {
      markers.push('persisted pact inputs did not expose concrete provider state names');
    }
  }

  if (planState.verificationReadiness.verdict === 'needs-artifact-source-clarification') {
    markers.push('pact artifact retrieval is still unresolved');
  }

  return uniqueSorted(markers);
}

function expectedPomMarkers(): string[] {
  return uniqueSorted([
    '<groupId>au.com.dius.pact.provider</groupId>',
    '<artifactId>junit5spring</artifactId>',
    '<artifactId>spring-boot-starter-test</artifactId>',
  ]);
}

function expectedMarkersForPath(
  relativePath: string,
  scanState: PactProviderScanState,
  planState: PactProviderPlanState,
  writeState: PactProviderWriteState,
): string[] {
  if (relativePath.endsWith('PactTest.java')) {
    return expectedProviderTestMarkers(scanState, planState, writeState);
  }

  if (path.posix.basename(relativePath) === 'pom.xml') {
    return expectedPomMarkers();
  }

  return [];
}

function evaluateRepoReality(
  projectRoot: string,
  scanState: PactProviderScanState | null,
  planState: PactProviderPlanState | null,
  writeState: PactProviderWriteState | null,
  stateConsistency: PactProviderValidateState['stateConsistency'],
): PactProviderValidateState['repoRealityChecks'] {
  const expectedArtifactsPresent: string[] = [];
  const expectedArtifactsMissing: string[] = [];
  const scaffoldMarkersVerified: string[] = [];
  const scaffoldMarkersMissing: string[] = [];
  const intentionallyNotWritten = writeState?.writesSkipped ?? [];
  const notes: string[] = [];

  if (stateConsistency.verdict === 'blocked') {
    notes.push('Repo reality checks stayed blocked because one or more persisted inputs could not be loaded.');
    return {
      expectedArtifactsPresent,
      expectedArtifactsMissing,
      scaffoldMarkersVerified,
      scaffoldMarkersMissing,
      intentionallyNotWritten,
      notes,
    };
  }

  if (!scanState || !planState || !writeState) {
    notes.push('Repo reality checks could not proceed because the persisted validation inputs were incomplete.');
    return {
      expectedArtifactsPresent,
      expectedArtifactsMissing,
      scaffoldMarkersVerified,
      scaffoldMarkersMissing,
      intentionallyNotWritten,
      notes,
    };
  }

  const expectedPaths = uniqueSorted([
    ...writeState.filesPlanned,
    ...writeState.filesWritten,
    ...writeState.filesModified,
  ]);

  if (expectedPaths.length === 0) {
    notes.push('Write-state did not claim any provider verification files as planned, written, or modified.');
  }

  for (const relativePath of expectedPaths) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      expectedArtifactsMissing.push(relativePath);
      continue;
    }

    expectedArtifactsPresent.push(relativePath);
    const markers = expectedMarkersForPath(relativePath, scanState, planState, writeState);
    if (markers.length === 0) {
      notes.push(`No explicit scaffold markers were configured for ${relativePath}; existence-only validation was used.`);
      continue;
    }

    const content = readFileSync(absolutePath, 'utf8');
    const missingMarkers = markers.filter((marker) => !content.includes(marker));
    if (missingMarkers.length > 0) {
      scaffoldMarkersMissing.push(`${relativePath} -> missing markers: ${missingMarkers.join(', ')}`);
      continue;
    }

    scaffoldMarkersVerified.push(relativePath);
  }

  return {
    expectedArtifactsPresent: uniqueSorted(expectedArtifactsPresent),
    expectedArtifactsMissing: uniqueSorted(expectedArtifactsMissing),
    scaffoldMarkersVerified: uniqueSorted(scaffoldMarkersVerified),
    scaffoldMarkersMissing: uniqueSorted(scaffoldMarkersMissing),
    intentionallyNotWritten,
    notes: uniqueSorted(notes),
  };
}

function evaluateCompileCheck(
  scanState: PactProviderScanState | null,
  planState: PactProviderPlanState | null,
  writeState: PactProviderWriteState | null,
  stateConsistency: PactProviderValidateState['stateConsistency'],
  repoRealityChecks: PactProviderValidateState['repoRealityChecks'],
): PactProviderValidateState['compileCheck'] {
  if (stateConsistency.verdict === 'blocked') {
    return {
      verdict: 'blocked',
      proofLevel: 'none',
      command: null,
      evidence: ['Compile/structural proof was blocked because the persisted validation input chain could not be loaded fully.'],
    };
  }

  if (!scanState || !planState || !writeState) {
    return {
      verdict: 'blocked',
      proofLevel: 'none',
      command: null,
      evidence: ['Compile/structural proof could not proceed because validation inputs were incomplete.'],
    };
  }

  if (planState.verificationReadiness.verdict === 'irrelevant') {
    return {
      verdict: 'not-applicable',
      proofLevel: 'none',
      command: null,
      evidence: ['Compile/structural proof is not applicable because Pact provider verification is irrelevant for this repo.'],
    };
  }

  if (repoRealityChecks.expectedArtifactsMissing.length > 0 || repoRealityChecks.scaffoldMarkersMissing.length > 0) {
    return {
      verdict: 'failed',
      proofLevel: 'structural',
      command: null,
      evidence: uniqueSorted([
        ...repoRealityChecks.expectedArtifactsMissing.map((entry) => `Missing expected artifact: ${entry}`),
        ...repoRealityChecks.scaffoldMarkersMissing.map((entry) => `Scaffold drift detected: ${entry}`),
      ]),
    };
  }

  if (writeState.writeOutcome === 'blocked') {
    return {
      verdict: 'blocked',
      proofLevel: 'none',
      command: null,
      evidence: ['Write-state stayed blocked, so validate cannot claim structural compile readiness.'],
    };
  }

  const evidence = [
    'Structural proof passed by confirming the expected provider verification artifacts still exist and still contain the recorded Pact scaffold markers.',
    repoRealityChecks.scaffoldMarkersVerified.length > 0
      ? `Verified scaffold markers in: ${repoRealityChecks.scaffoldMarkersVerified.join(', ')}.`
      : 'No file-level scaffold marker checks were required beyond existence-only validation.',
    writeState.expectedVerificationCommand
      ? `Validate did not execute ${writeState.expectedVerificationCommand}; this compile verdict is structural rather than command-executed.`
      : 'No runnable verification command was recorded, so compile proof stayed structural only.',
  ];

  return {
    verdict: 'passed',
    proofLevel: 'structural',
    command: null,
    evidence: uniqueSorted(evidence),
  };
}

function evaluateRunnableVerification(
  scanState: PactProviderScanState | null,
  planState: PactProviderPlanState | null,
  writeState: PactProviderWriteState | null,
  stateConsistency: PactProviderValidateState['stateConsistency'],
  repoRealityChecks: PactProviderValidateState['repoRealityChecks'],
): PactProviderValidateState['runnableVerificationCheck'] {
  if (stateConsistency.verdict === 'blocked') {
    return {
      verdict: 'blocked',
      command: null,
      evidence: ['Runnable verification stayed blocked because the persisted validation inputs were incomplete.'],
    };
  }

  if (!scanState || !planState || !writeState) {
    return {
      verdict: 'blocked',
      command: null,
      evidence: ['Runnable verification could not be evaluated because validation inputs were incomplete.'],
    };
  }

  if (planState.verificationReadiness.verdict === 'irrelevant') {
    return {
      verdict: 'not-applicable',
      command: null,
      evidence: ['Runnable verification is not applicable because Pact provider verification is irrelevant here.'],
    };
  }

  if (planState.verificationReadiness.verdict === 'blocked' || writeState.writeOutcome === 'blocked') {
    return {
      verdict: 'blocked',
      command: writeState.expectedVerificationCommand,
      evidence: uniqueSorted([
        'Runnable verification stayed blocked because the prior plan/write verdict chain is blocked.',
        ...writeState.unresolvedBlockers,
      ]),
    };
  }

  if (repoRealityChecks.expectedArtifactsMissing.length > 0 || repoRealityChecks.scaffoldMarkersMissing.length > 0) {
    return {
      verdict: 'blocked',
      command: writeState.expectedVerificationCommand,
      evidence: uniqueSorted([
        'Runnable verification is blocked because the repo no longer matches the recorded write outcome.',
        ...repoRealityChecks.expectedArtifactsMissing.map((entry) => `Missing expected artifact: ${entry}`),
        ...repoRealityChecks.scaffoldMarkersMissing.map((entry) => `Scaffold drift detected: ${entry}`),
      ]),
    };
  }

  const providerStateStillUnresolved = [
    ...writeState.unresolvedBlockers,
    ...writeState.manualFollowUps,
  ].some((entry) => /provider state/i.test(entry));

  if ((planState.verificationReadiness.verdict === 'needs-provider-state-work' && providerStateStillUnresolved)
    || (writeState.writeOutcome === 'partial' && providerStateStillUnresolved)) {
    return {
      verdict: 'unproven',
      command: writeState.expectedVerificationCommand,
      evidence: uniqueSorted([
        'Runnable verification remains unproven because provider-state work is still unresolved.',
        ...writeState.unresolvedBlockers,
        ...writeState.manualFollowUps,
      ]),
    };
  }

  if (planState.verificationReadiness.verdict === 'needs-artifact-source-clarification' || scanState.artifactSource.verdict !== 'local') {
    return {
      verdict: 'unproven',
      command: writeState.expectedVerificationCommand,
      evidence: uniqueSorted([
        'Runnable verification remains unproven because Pact artifact retrieval is not yet grounded enough to claim runnable success.',
        ...writeState.unresolvedBlockers,
      ]),
    };
  }

  if (!writeState.expectedVerificationCommand) {
    return {
      verdict: 'unproven',
      command: null,
      evidence: ['Runnable verification could not be claimed ready because write-state did not record a verification command.'],
    };
  }

  return {
    verdict: 'ready',
    command: writeState.expectedVerificationCommand,
    evidence: uniqueSorted([
      `Runnable verification is ready to attempt via: ${writeState.expectedVerificationCommand}.`,
      'Validate did not execute the provider verification command; this verdict means ready-to-run, not proven-by-execution.',
      'Local pact artifacts, consistent write-state, and matching scaffold markers provide enough evidence for an honest ready claim.',
    ]),
  };
}

function determineValidationOutcome(
  inputVerdicts: PactProviderValidateState['inputVerdicts'],
  stateConsistency: PactProviderValidateState['stateConsistency'],
  repoRealityChecks: PactProviderValidateState['repoRealityChecks'],
  compileCheck: PactProviderValidateState['compileCheck'],
  runnableVerificationCheck: PactProviderValidateState['runnableVerificationCheck'],
): PactValidateOutcome {
  if (stateConsistency.verdict === 'blocked') {
    return 'blocked';
  }

  if (stateConsistency.verdict === 'inconsistent') {
    return 'inconsistent';
  }

  if (repoRealityChecks.expectedArtifactsMissing.length > 0 || repoRealityChecks.scaffoldMarkersMissing.length > 0) {
    return 'inconsistent';
  }

  if (inputVerdicts.plan === 'irrelevant' && inputVerdicts.write === 'no-op') {
    return 'irrelevant';
  }

  if (inputVerdicts.plan === 'blocked' || inputVerdicts.write === 'blocked') {
    return 'blocked';
  }

  if (compileCheck.verdict === 'failed') {
    return 'inconsistent';
  }

  if (compileCheck.verdict === 'blocked') {
    return 'blocked';
  }

  if (runnableVerificationCheck.verdict === 'ready' || runnableVerificationCheck.verdict === 'proven') {
    return 'ready';
  }

  return 'partial';
}

function buildRemainingBlockers(
  stateConsistency: PactProviderValidateState['stateConsistency'],
  repoRealityChecks: PactProviderValidateState['repoRealityChecks'],
  runnableVerificationCheck: PactProviderValidateState['runnableVerificationCheck'],
  writeState: PactProviderWriteState | null,
): string[] {
  return uniqueSorted([
    ...stateConsistency.issues,
    ...repoRealityChecks.expectedArtifactsMissing.map((entry) => `Expected artifact missing: ${entry}`),
    ...repoRealityChecks.scaffoldMarkersMissing.map((entry) => `Scaffold markers missing: ${entry}`),
    ...(writeState?.unresolvedBlockers ?? []),
    ...runnableVerificationCheck.evidence.filter((entry) =>
      /blocked|unproven|missing|unresolved|clarification/i.test(entry),
    ),
  ]);
}

function buildEvidence(
  scanState: PactProviderScanState | null,
  planState: PactProviderPlanState | null,
  writeState: PactProviderWriteState | null,
  repoRealityChecks: PactProviderValidateState['repoRealityChecks'],
  compileCheck: PactProviderValidateState['compileCheck'],
  runnableVerificationCheck: PactProviderValidateState['runnableVerificationCheck'],
): string[] {
  return uniqueSorted([
    ...(scanState?.provider.evidence ?? []),
    ...(scanState?.artifactSource.evidence ?? []),
    ...(planState?.providerSelection.selectionReason ?? []),
    ...(planState?.verificationReadiness.why ?? []),
    ...(writeState?.notes ?? []),
    ...repoRealityChecks.scaffoldMarkersVerified.map((entry) => `Repo scaffold verified: ${entry}`),
    ...compileCheck.evidence,
    ...runnableVerificationCheck.evidence,
  ]);
}

function buildNotes(
  validationOutcome: PactValidateOutcome,
  stateConsistency: PactProviderValidateState['stateConsistency'],
  compileCheck: PactProviderValidateState['compileCheck'],
  runnableVerificationCheck: PactProviderValidateState['runnableVerificationCheck'],
): string[] {
  return uniqueSorted([
    validationOutcome === 'ready'
      ? 'Validate outcome is ready: persisted state chain is consistent, repo reality still matches the recorded scaffold, and runnable verification is ready to attempt.'
      : '',
    validationOutcome === 'partial'
      ? 'Validate outcome is partial: repo reality is usable enough to continue, but runnable verification is still unresolved or unproven.'
      : '',
    validationOutcome === 'blocked'
      ? 'Validate outcome is blocked: required inputs or prior verdicts do not support an honest readiness claim.'
      : '',
    validationOutcome === 'irrelevant'
      ? 'Validate outcome is irrelevant: persisted state confirms an honest no-op for Pact provider verification in this repo.'
      : '',
    validationOutcome === 'inconsistent'
      ? 'Validate outcome is inconsistent: current repo reality drifted from, or conflicted with, the recorded write/plan/scan chain.'
      : '',
    stateConsistency.verdict === 'consistent' ? 'Persisted scan/plan/write chain remained internally consistent.' : '',
    compileCheck.proofLevel === 'structural' ? 'Compile proof is structural only; validate did not execute a Maven or Gradle command.' : '',
    runnableVerificationCheck.verdict === 'ready'
      ? 'Runnable verification is ready-to-run, not execution-proven.'
      : '',
  ].filter((value) => value.length > 0));
}

export function deriveValidateFromPersistedState(projectRoot: string): PactProviderValidateState {
  const scanLoad = loadOptionalState<PactProviderScanState>(projectRoot, PERSISTED_SCAN_STATE_RELATIVE_PATH, 'scan-state');
  const planLoad = loadOptionalState<PactProviderPlanState>(projectRoot, PERSISTED_PLAN_STATE_RELATIVE_PATH, 'plan-state');
  const writeLoad = loadOptionalState<PactProviderWriteState>(projectRoot, PERSISTED_WRITE_STATE_RELATIVE_PATH, 'write-state');
  const inputVerdicts = determineInputVerdicts(scanLoad.state, planLoad.state, writeLoad.state);
  const stateConsistency = evaluateStateConsistency(scanLoad, planLoad, writeLoad);
  const repoRealityChecks = evaluateRepoReality(projectRoot, scanLoad.state, planLoad.state, writeLoad.state, stateConsistency);
  const compileCheck = evaluateCompileCheck(scanLoad.state, planLoad.state, writeLoad.state, stateConsistency, repoRealityChecks);
  const runnableVerificationCheck = evaluateRunnableVerification(scanLoad.state, planLoad.state, writeLoad.state, stateConsistency, repoRealityChecks);
  const validationOutcome = determineValidationOutcome(inputVerdicts, stateConsistency, repoRealityChecks, compileCheck, runnableVerificationCheck);
  const remainingBlockers = buildRemainingBlockers(stateConsistency, repoRealityChecks, runnableVerificationCheck, writeLoad.state);
  const manualFollowUps = uniqueSorted(writeLoad.state?.manualFollowUps ?? []);
  const evidence = buildEvidence(scanLoad.state, planLoad.state, writeLoad.state, repoRealityChecks, compileCheck, runnableVerificationCheck);
  const notes = buildNotes(validationOutcome, stateConsistency, compileCheck, runnableVerificationCheck);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    scanStatePath: scanLoad.state ? scanLoad.relativePath : null,
    planStatePath: planLoad.state ? planLoad.relativePath : null,
    writeStatePath: writeLoad.state ? writeLoad.relativePath : null,
    inputVerdicts,
    validationOutcome,
    stateConsistency,
    repoRealityChecks,
    compileCheck,
    runnableVerificationCheck,
    remainingBlockers,
    manualFollowUps,
    evidence,
    notes,
  };
}

export function renderValidateSummary(state: PactProviderValidateState): string {
  const why = state.notes[0] ?? state.remainingBlockers[0] ?? '(none)';
  return [
    '# Pact provider validate summary',
    '',
    'This file is only a concise summary. Canonical machine-readable validate state lives in JSON under `.oma/packs/oh-my-pactgpb/state/shared/validate/`.',
    '',
    '## Canonical JSON files',
    '',
    '- `validate-state.json`',
    '',
    '## Summary',
    '',
    '### Input verdict chain',
    `- Scan verdict: ${state.inputVerdicts.scan}`,
    `- Plan verdict: ${state.inputVerdicts.plan}`,
    `- Write outcome: ${state.inputVerdicts.write}`,
    '',
    '### Validation outcome',
    `- Outcome: ${state.validationOutcome}`,
    `- Why: ${why}`,
    '',
    '### State consistency',
    `- Verdict: ${state.stateConsistency.verdict}`,
    `- Checks: ${state.stateConsistency.checks.join('; ') || '(none)'}`,
    `- Issues: ${state.stateConsistency.issues.join('; ') || '(none)'}`,
    '',
    '### Repo reality',
    `- Expected and present: ${state.repoRealityChecks.expectedArtifactsPresent.join(', ') || '(none)'}`,
    `- Missing or drifted: ${[...state.repoRealityChecks.expectedArtifactsMissing, ...state.repoRealityChecks.scaffoldMarkersMissing].join('; ') || '(none)'}`,
    `- Intentionally not written: ${state.repoRealityChecks.intentionallyNotWritten.map((entry) => `${entry.path} — ${entry.reason}`).join('; ') || '(none)'}`,
    '',
    '### Compile / structural proof',
    `- Verdict: ${state.compileCheck.verdict}`,
    `- Proof level: ${state.compileCheck.proofLevel}`,
    `- Command: ${state.compileCheck.command ?? '(none)'}`,
    `- Evidence: ${state.compileCheck.evidence.join('; ') || '(none)'}`,
    '',
    '### Runnable verification',
    `- Verdict: ${state.runnableVerificationCheck.verdict}`,
    `- Command: ${state.runnableVerificationCheck.command ?? '(none)'}`,
    `- Evidence: ${state.runnableVerificationCheck.evidence.join('; ') || '(none)'}`,
    '',
    '### Remaining blockers',
    ...(state.remainingBlockers.length > 0 ? state.remainingBlockers.map((entry) => `- ${entry}`) : ['- None.']),
    '',
    '### Manual follow-ups',
    ...(state.manualFollowUps.length > 0 ? state.manualFollowUps.map((entry) => `- ${entry}`) : ['- None.']),
    '',
  ].join('\n');
}

export function hasInstalledValidateContract(projectRoot: string): boolean {
  const contractPath = path.join(projectRoot, INSTALLED_VALIDATE_CONTRACT_RELATIVE_PATH);
  return existsSync(contractPath) && statSync(contractPath).isFile();
}

export function writeProofValidateArtifacts(projectRoot: string): ProofValidateArtifacts {
  const state = deriveValidateFromPersistedState(projectRoot);
  const outputDir = path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'state', 'shared', 'validate');
  mkdirSync(outputDir, { recursive: true });

  const statePath = path.join(outputDir, 'validate-state.json');
  const summaryPath = path.join(outputDir, 'validate-summary.md');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  writeFileSync(summaryPath, `${renderValidateSummary(state).trimEnd()}\n`, 'utf8');

  return {
    state,
    statePath,
    summaryPath,
  };
}
