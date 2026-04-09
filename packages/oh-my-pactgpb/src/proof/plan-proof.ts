import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  ArtifactSourceVerdict,
  PactProviderScanState,
  ProviderConfidence,
} from './scan-proof.js';

export type PactPlanVerdict =
  | 'ready-to-scaffold'
  | 'needs-provider-state-work'
  | 'needs-artifact-source-clarification'
  | 'blocked'
  | 'irrelevant';

export interface PactProviderPlanState {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  scanStatePath: string;
  providerSelection: {
    name: string | null;
    selectionReason: string[];
    confidence: ProviderConfidence;
    ambiguities: string[];
  };
  artifactSourceStrategy: {
    verdict: ArtifactSourceVerdict;
    evidence: string[];
    assumptions: string[];
  };
  verificationReadiness: {
    verdict: PactPlanVerdict;
    existingSetup: string;
    why: string[];
  };
  providerStateWork: {
    existingStates: string[];
    gaps: string[];
    recommendedActions: string[];
  };
  plannedTasks: Array<{
    id: string;
    title: string;
    rationale: string;
  }>;
  verificationApproach: {
    expectedTestStyle: string;
    scaffoldDirection: string;
    evidence: string[];
  };
  blockedBy: string[];
}

export interface ProofPlanArtifacts {
  state: PactProviderPlanState;
  statePath: string;
  summaryPath: string;
}

const INSTALLED_PLAN_CONTRACT_RELATIVE_PATH = path.join(
  '.oma',
  'packs',
  'oh-my-pactgpb',
  'templates',
  'plan',
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

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function makeTask(id: number, title: string, rationale: string) {
  return {
    id: `T${String(id).padStart(2, '0')}`,
    title,
    rationale,
  };
}

function selectProviderAmbiguities(scanState: PactProviderScanState): string[] {
  const explicitAmbiguities = scanState.gaps.filter((gap) => {
    const normalized = gap.toLowerCase();
    return normalized.includes('ambiguous') || normalized.includes('no confident provider');
  });

  if (explicitAmbiguities.length > 0) {
    return uniqueSorted(explicitAmbiguities);
  }

  if (scanState.provider.name === null) {
    return ['No confident provider under contract could be identified from persisted scan-state.'];
  }

  if (scanState.provider.confidence === 'low') {
    return ['Persisted scan-state reports low provider confidence, so binding should be treated as ambiguous.'];
  }

  return [];
}

function classifyExistingSetup(scanState: PactProviderScanState): string {
  if (scanState.relevance.verdict === 'irrelevant') {
    return 'not-applicable';
  }

  if (scanState.verificationEvidence.providerVerificationTests.length > 0) {
    return scanState.providerStates.missingStateSupport
      ? 'extend-existing-provider-verification'
      : 'extend-existing-provider-verification';
  }

  return 'scaffold-new-provider-verification';
}

function buildArtifactAssumptions(scanState: PactProviderScanState): string[] {
  if (scanState.artifactSource.verdict === 'local') {
    return [];
  }

  if (scanState.artifactSource.verdict === 'broker') {
    return [
      'Broker-related hints exist, but persisted scan-state does not prove broker access, auth, or artifact retrieval wiring.',
    ];
  }

  return [
    'Persisted scan-state does not identify a runnable pact artifact location yet.',
  ];
}

function buildProviderStateGaps(scanState: PactProviderScanState): string[] {
  const gaps = scanState.gaps.filter((gap) => gap.toLowerCase().includes('state'));

  if (scanState.relevance.verdict === 'irrelevant') {
    return [];
  }

  if (scanState.providerStates.missingStateSupport) {
    gaps.push('No provider state hooks were detected in persisted scan-state.');
  }

  if (scanState.providerStates.stateAnnotations.length > 0) {
    gaps.push('Existing provider states are only partially known from scan-state; interaction-to-state coverage still needs review.');
  }

  return uniqueSorted(gaps);
}

function buildProviderStateActions(scanState: PactProviderScanState): string[] {
  const actions: string[] = [];
  const stateNames = scanState.providerStates.stateAnnotations;

  if (scanState.relevance.verdict === 'irrelevant') {
    return actions;
  }

  if (stateNames.length > 0) {
    actions.push(`Review existing @State handlers and confirm they cover the pact interactions already implied by: ${stateNames.join(', ')}.`);
  } else {
    actions.push('Add provider state handlers for the interactions required by the selected provider contracts.');
  }

  if (scanState.verificationEvidence.integrationTestPriorArt.length > 0) {
    actions.push(`Reuse existing integration-test bootstrap as fixture/setup prior art: ${scanState.verificationEvidence.integrationTestPriorArt.join(', ')}.`);
  }

  return uniqueSorted(actions);
}

function buildBlockedBy(
  scanState: PactProviderScanState,
  providerAmbiguities: string[],
  artifactAssumptions: string[],
): string[] {
  if (scanState.relevance.verdict === 'irrelevant') {
    return [];
  }

  const blockedBy: string[] = [];

  blockedBy.push(...providerAmbiguities);

  if (scanState.artifactSource.verdict === 'unclear') {
    blockedBy.push('Pact artifact source must be clarified before runnable verification can be planned honestly.');
  }

  if (scanState.artifactSource.verdict === 'broker') {
    blockedBy.push(...artifactAssumptions);
  }

  for (const gap of scanState.gaps) {
    const normalized = gap.toLowerCase();
    if (normalized.includes('controller surface') || normalized.includes('artifact source')) {
      blockedBy.push(gap);
    }
  }

  return uniqueSorted(blockedBy);
}

function determineVerificationVerdict(
  scanState: PactProviderScanState,
  providerAmbiguities: string[],
): PactPlanVerdict {
  if (scanState.relevance.verdict === 'irrelevant') {
    return 'irrelevant';
  }

  if (providerAmbiguities.length > 0) {
    return 'blocked';
  }

  if (scanState.artifactSource.verdict !== 'local') {
    return 'needs-artifact-source-clarification';
  }

  if (scanState.providerStates.missingStateSupport) {
    return 'needs-provider-state-work';
  }

  return 'ready-to-scaffold';
}

function buildReadinessWhy(
  scanState: PactProviderScanState,
  verdict: PactPlanVerdict,
  existingSetup: string,
): string[] {
  const reasons = [...scanState.relevance.because];

  if (existingSetup === 'extend-existing-provider-verification' && scanState.verificationEvidence.providerVerificationTests.length > 0) {
    reasons.push(`Existing provider verification should be extended instead of recreated: ${scanState.verificationEvidence.providerVerificationTests.join(', ')}.`);
  }

  if (existingSetup === 'scaffold-new-provider-verification') {
    reasons.push('No provider verification test class was persisted in scan-state, so the next safe step is to scaffold one rather than assume it already exists.');
  }

  if (verdict === 'needs-provider-state-work') {
    reasons.push('Artifact access looks grounded enough to continue, but provider-state support is too weak to treat verification as runnable.');
  }

  if (verdict === 'needs-artifact-source-clarification') {
    reasons.push('Provider binding is not enough on its own; pact artifact retrieval still needs proof before runnable verification can be claimed.');
  }

  if (verdict === 'ready-to-scaffold') {
    reasons.push('Provider binding, local pact artifacts, and provider-state evidence are strong enough to scaffold the next verification slice safely.');
  }

  if (verdict === 'blocked') {
    reasons.push('Provider binding is still ambiguous, so planning must stop short of a fake target selection.');
  }

  return uniqueSorted(reasons);
}

function buildVerificationApproach(scanState: PactProviderScanState, existingSetup: string): PactProviderPlanState['verificationApproach'] {
  const scaffoldDirection = existingSetup === 'extend-existing-provider-verification'
    ? `Extend the existing provider verification entrypoint instead of creating a parallel flow: ${scanState.verificationEvidence.providerVerificationTests.join(', ') || '(no test path persisted)'}.`
    : `Create a new Spring Pact provider verification test scaffold for ${scanState.provider.name ?? 'the selected provider'} using repo-backed HTTP surface evidence.`;

  const expectedTestStyle = scanState.artifactSource.verdict === 'local'
    ? 'Spring HTTP provider verification using local pact artifacts.'
    : scanState.artifactSource.verdict === 'broker'
      ? 'Spring HTTP provider verification, but only after broker-backed artifact retrieval is confirmed.'
      : 'Spring HTTP provider verification is still conditional because artifact source is unclear.';

  const evidence = uniqueSorted([
    ...scanState.verificationEvidence.providerVerificationTests,
    ...scanState.verificationEvidence.localPactFiles,
    ...scanState.httpSurface.controllerFiles,
    ...scanState.verificationEvidence.integrationTestPriorArt,
  ]);

  return {
    expectedTestStyle,
    scaffoldDirection,
    evidence,
  };
}

function buildPlannedTasks(
  scanState: PactProviderScanState,
  verdict: PactPlanVerdict,
  existingSetup: string,
): PactProviderPlanState['plannedTasks'] {
  if (verdict === 'irrelevant') {
    return [];
  }

  const tasks: PactProviderPlanState['plannedTasks'] = [];

  if (verdict === 'blocked') {
    tasks.push(
      makeTask(
        1,
        'Resolve provider binding ambiguity',
        'Compare the competing provider candidates in persisted scan-state and choose the provider under contract explicitly before any verification scaffolding.',
      ),
    );
    return tasks;
  }

  if (scanState.artifactSource.verdict === 'broker') {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Clarify broker-backed pact retrieval',
        `Persist how broker artifacts are expected to be resolved and authenticated before treating verification as runnable. Evidence: ${scanState.verificationEvidence.brokerConfigHints.join(', ') || '(broker hints only)'}.`,
      ),
    );
  }

  if (scanState.artifactSource.verdict === 'unclear') {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Clarify pact artifact source',
        'Determine whether pact files come from local fixtures or a broker before scaffolding provider verification.',
      ),
    );
  }

  if (existingSetup === 'extend-existing-provider-verification') {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Extend the existing provider verification setup',
        `Reuse and remediate the existing Pact provider test instead of recreating it: ${scanState.verificationEvidence.providerVerificationTests.join(', ')}.`,
      ),
    );
  } else {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Scaffold a provider verification test',
        `Create a Spring Pact provider verification entrypoint for ${scanState.provider.name ?? 'the selected provider'} using the persisted HTTP surface and artifact-source evidence.`,
      ),
    );
  }

  if (scanState.providerStates.missingStateSupport) {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Add provider state handlers',
        'Implement the @State-driven fixture/bootstrap hooks needed to make provider verification runnable instead of relying on empty happy-path scaffolding.',
      ),
    );
  } else {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Audit provider state coverage',
        `Start from the known provider states and verify they still match the target interactions: ${scanState.providerStates.stateAnnotations.join(', ')}.`,
      ),
    );
  }

  if (scanState.verificationEvidence.integrationTestPriorArt.length > 0) {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Reuse existing integration bootstrap',
        `Lift stable fixture/bootstrap patterns from existing tests instead of inventing a new harness: ${scanState.verificationEvidence.integrationTestPriorArt.join(', ')}.`,
      ),
    );
  }

  return tasks;
}

export function derivePlanFromScanState(scanState: PactProviderScanState): PactProviderPlanState {
  const scanStatePath = toPosixPath(PERSISTED_SCAN_STATE_RELATIVE_PATH);
  const providerAmbiguities = selectProviderAmbiguities(scanState);
  const artifactAssumptions = buildArtifactAssumptions(scanState);
  const existingSetup = classifyExistingSetup(scanState);
  const verdict = determineVerificationVerdict(scanState, providerAmbiguities);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: scanState.projectRoot,
    scanStatePath,
    providerSelection: {
      name: providerAmbiguities.length > 0 ? null : scanState.provider.name,
      selectionReason: scanState.provider.evidence.length > 0 ? scanState.provider.evidence : scanState.relevance.because,
      confidence: scanState.provider.confidence,
      ambiguities: providerAmbiguities,
    },
    artifactSourceStrategy: {
      verdict: scanState.artifactSource.verdict,
      evidence: scanState.artifactSource.evidence,
      assumptions: artifactAssumptions,
    },
    verificationReadiness: {
      verdict,
      existingSetup,
      why: buildReadinessWhy(scanState, verdict, existingSetup),
    },
    providerStateWork: {
      existingStates: scanState.providerStates.stateAnnotations,
      gaps: buildProviderStateGaps(scanState),
      recommendedActions: buildProviderStateActions(scanState),
    },
    plannedTasks: buildPlannedTasks(scanState, verdict, existingSetup),
    verificationApproach: buildVerificationApproach(scanState, existingSetup),
    blockedBy: buildBlockedBy(scanState, providerAmbiguities, artifactAssumptions),
  };
}

export function renderPlanSummary(state: PactProviderPlanState): string {
  return [
    '# Pact provider plan summary',
    '',
    'This file is only a concise summary. Canonical machine-readable plan state lives in JSON under `.oma/packs/oh-my-pactgpb/state/shared/plan/`.',
    '',
    '## Canonical JSON files',
    '',
    '- `plan-state.json`',
    '',
    '## Summary',
    '',
    '### Provider selection',
    `- Selected provider: ${state.providerSelection.name ?? '(blocked or unclear)'}`,
    `- Selection reason: ${state.providerSelection.selectionReason.join('; ') || '(none)'}`,
    `- Confidence: ${state.providerSelection.confidence}`,
    `- Ambiguities: ${state.providerSelection.ambiguities.join('; ') || '(none)'}`,
    '',
    '### Artifact source strategy',
    `- Verdict: ${state.artifactSourceStrategy.verdict}`,
    `- Evidence: ${state.artifactSourceStrategy.evidence.join(', ') || '(none)'}`,
    `- Assumptions to confirm: ${state.artifactSourceStrategy.assumptions.join('; ') || '(none)'}`,
    '',
    '### Verification readiness',
    `- Planning verdict: ${state.verificationReadiness.verdict}`,
    `- Existing setup: ${state.verificationReadiness.existingSetup}`,
    `- Why: ${state.verificationReadiness.why.join('; ') || '(none)'}`,
    '',
    '### Provider-state work',
    `- Existing states: ${state.providerStateWork.existingStates.join(', ') || '(none)'}`,
    `- Gaps: ${state.providerStateWork.gaps.join('; ') || '(none)'}`,
    `- Recommended actions: ${state.providerStateWork.recommendedActions.join('; ') || '(none)'}`,
    '',
    '### Planned tasks',
    ...(state.plannedTasks.length > 0
      ? state.plannedTasks.map((task) => `${task.id}. ${task.title} — ${task.rationale}`)
      : ['(none)']),
    '',
    '### Verification approach',
    `- Expected test/scaffold direction: ${state.verificationApproach.expectedTestStyle}`,
    `- What should be extended or created: ${state.verificationApproach.scaffoldDirection}`,
    '',
    '### Blockers',
    ...(state.blockedBy.length > 0 ? state.blockedBy.map((blocker) => `- ${blocker}`) : ['- None.']),
    '',
  ].join('\n');
}

export function hasInstalledPlanContract(projectRoot: string): boolean {
  const contractPath = path.join(projectRoot, INSTALLED_PLAN_CONTRACT_RELATIVE_PATH);
  return existsSync(contractPath) && statSync(contractPath).isFile();
}

export function readPersistedScanState(projectRoot: string): PactProviderScanState {
  const scanStatePath = path.join(projectRoot, PERSISTED_SCAN_STATE_RELATIVE_PATH);

  if (!existsSync(scanStatePath)) {
    throw new Error(`Persisted scan-state is missing: ${toPosixPath(path.relative(projectRoot, scanStatePath))}`);
  }

  return readJsonFile<PactProviderScanState>(scanStatePath);
}

export function writeProofPlanArtifacts(projectRoot: string): ProofPlanArtifacts {
  const scanState = readPersistedScanState(projectRoot);
  const state = derivePlanFromScanState(scanState);
  const outputDir = path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'state', 'shared', 'plan');
  mkdirSync(outputDir, { recursive: true });

  const statePath = path.join(outputDir, 'plan-state.json');
  const summaryPath = path.join(outputDir, 'plan-summary.md');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  writeFileSync(summaryPath, `${renderPlanSummary(state).trimEnd()}\n`, 'utf8');

  return {
    state,
    statePath,
    summaryPath,
  };
}
