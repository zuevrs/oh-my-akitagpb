import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  ArtifactSourceVerdict,
  CoverageConfidence,
  PactProviderScanState,
  ProviderConfidence,
} from './scan-proof.js';

export type PactPlanVerdict =
  | 'ready-to-scaffold'
  | 'needs-provider-state-work'
  | 'needs-artifact-source-clarification'
  | 'blocked'
  | 'irrelevant';

export interface PactProviderPlanTask {
  id: string;
  title: string;
  rationale: string;
  targets: string[];
  evidence: string[];
}

export interface PactProviderPlanState {
  schemaVersion: 2;
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
    missingStates: string[];
    gaps: string[];
    recommendedActions: string[];
  };
  coverageSummary: {
    coveredEndpoints: string[];
    endpointsWithGaps: string[];
    unverifiedEndpoints: string[];
    uncoveredEndpoints: string[];
    ambiguousEndpoints: string[];
    coveredInteractions: string[];
    interactionStateGaps: string[];
    unverifiedInteractions: string[];
    unmappedInteractions: string[];
    setupOnlyTargets: string[];
    recommendedNextSlice: string[];
    contractSurfaceConfidence: CoverageConfidence;
  };
  plannedTasks: PactProviderPlanTask[];
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

function makeTask(id: number, title: string, rationale: string, targets: string[] = [], evidence: string[] = []): PactProviderPlanTask {
  return {
    id: `T${String(id).padStart(2, '0')}`,
    title,
    rationale,
    targets: uniqueSorted(targets),
    evidence: uniqueSorted(evidence),
  };
}

function selectProviderAmbiguities(scanState: PactProviderScanState): string[] {
  const explicitAmbiguities = uniqueSorted([
    ...scanState.coverageModel.ambiguityMarkers,
    ...scanState.gaps.filter((gap) => {
      const normalized = gap.toLowerCase();
      return normalized.includes('ambiguous') || normalized.includes('no confident provider');
    }),
  ]);

  if (explicitAmbiguities.length > 0) {
    return explicitAmbiguities;
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
    return 'extend-existing-provider-verification';
  }

  return 'scaffold-new-provider-verification';
}

function buildArtifactAssumptions(scanState: PactProviderScanState): string[] {
  if (scanState.artifactSource.verdict === 'local') {
    return [];
  }

  if (scanState.artifactSource.verdict === 'broker') {
    return uniqueSorted([
      'Broker-related hints exist, but persisted scan-state does not prove broker access, auth, or artifact retrieval wiring.',
      ...scanState.coverageModel.coverageSummary.setupOnlyTargets.length > 0
        ? ['Existing verification targets still look setup-only until broker-backed pact retrieval is confirmed.']
        : [],
    ]);
  }

  return uniqueSorted([
    'Persisted scan-state does not identify a runnable pact artifact location yet.',
    ...scanState.coverageModel.coverageSummary.setupOnlyTargets.length > 0
      ? ['Bootstrap-only verification targets exist, but they do not prove real interaction coverage yet.']
      : [],
  ]);
}

function buildProviderStateGaps(scanState: PactProviderScanState): string[] {
  if (scanState.relevance.verdict === 'irrelevant') {
    return [];
  }

  const gaps = [...scanState.gaps.filter((gap) => gap.toLowerCase().includes('state'))];
  const missingStates = scanState.coverageModel.stateInventory.missing;

  if (missingStates.length > 0) {
    gaps.push(`Missing provider states: ${missingStates.join(', ')}.`);
  }

  if (scanState.providerStates.stateAnnotations.length === 0) {
    gaps.push('No provider state hooks were detected in persisted scan-state.');
  }

  if (scanState.coverageModel.stateInventory.referenced.length === 0 && scanState.artifactSource.verdict !== 'local') {
    gaps.push('No grounded interaction-derived provider-state inventory exists yet.');
  }

  return uniqueSorted(gaps);
}

function buildProviderStateActions(scanState: PactProviderScanState): string[] {
  const actions: string[] = [];
  const missingStates = scanState.coverageModel.stateInventory.missing;
  const existingStates = scanState.providerStates.stateAnnotations;

  if (scanState.relevance.verdict === 'irrelevant') {
    return actions;
  }

  if (missingStates.length > 0) {
    actions.push(`Add provider state handlers for: ${missingStates.join(', ')}.`);
  } else if (existingStates.length > 0) {
    actions.push(`Audit existing @State handlers and keep only the ones still justified by the current interactions: ${existingStates.join(', ')}.`);
  } else {
    actions.push('Add provider state handlers once grounded pact interactions expose the required state names.');
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

  blockedBy.push(...scanState.coverageModel.ambiguityMarkers);

  for (const gap of scanState.gaps) {
    const normalized = gap.toLowerCase();
    if (
      normalized.includes('artifact source')
      || normalized.includes('ambiguous')
      || normalized.includes('no spring controller surface')
      || normalized.includes('could not be mapped')
    ) {
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

  if (scanState.coverageModel.stateInventory.missing.length > 0 || scanState.providerStates.missingStateSupport) {
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
  const coverageSummary = scanState.coverageModel.coverageSummary;

  reasons.push(`Covered endpoints: ${coverageSummary.coveredEndpoints.join(', ') || '(none)'}.`);
  reasons.push(`Uncovered endpoints: ${coverageSummary.uncoveredEndpoints.join(', ') || '(none)'}.`);

  if (existingSetup === 'extend-existing-provider-verification' && scanState.verificationEvidence.providerVerificationTests.length > 0) {
    reasons.push(`Existing provider verification should be extended instead of recreated: ${scanState.verificationEvidence.providerVerificationTests.join(', ')}.`);
  }

  if (existingSetup === 'scaffold-new-provider-verification') {
    reasons.push('No provider verification test class was persisted in scan-state, so the next safe step is to scaffold one rather than assume it already exists.');
  }

  if (coverageSummary.setupOnlyTargets.length > 0) {
    reasons.push(`Some provider verification targets are setup-only today: ${coverageSummary.setupOnlyTargets.join(', ')}.`);
  }

  if (verdict === 'needs-provider-state-work') {
    reasons.push('Artifact access looks grounded enough to continue, but provider-state support is too weak to treat verification as runnable.');
  }

  if (verdict === 'needs-artifact-source-clarification') {
    reasons.push('Provider binding alone is not enough; pact artifact retrieval still needs proof before runnable verification can be claimed.');
  }

  if (verdict === 'ready-to-scaffold') {
    reasons.push('Provider binding, local pact artifacts, and current state coverage are strong enough to plan the next verification slice concretely.');
  }

  if (verdict === 'blocked') {
    reasons.push('Provider binding is still ambiguous, so planning must stop short of a fake target selection.');
  }

  return uniqueSorted(reasons);
}

function buildVerificationApproach(scanState: PactProviderScanState, existingSetup: string): PactProviderPlanState['verificationApproach'] {
  const coverageSummary = scanState.coverageModel.coverageSummary;
  const scaffoldDirection = existingSetup === 'extend-existing-provider-verification'
    ? `Extend the existing provider verification entrypoint instead of creating a parallel flow: ${scanState.verificationEvidence.providerVerificationTests.join(', ') || '(no test path persisted)'}.`
    : `Create a new Spring Pact provider verification test scaffold for ${scanState.provider.name ?? 'the selected provider'} using repo-backed endpoint inventory.`;

  const expectedTestStyle = scanState.artifactSource.verdict === 'local'
    ? 'Spring HTTP provider verification using local pact artifacts with endpoint-by-endpoint coverage expansion.'
    : scanState.artifactSource.verdict === 'broker'
      ? 'Spring HTTP provider verification, but only after broker-backed artifact retrieval is confirmed.'
      : 'Spring HTTP provider verification is still conditional because artifact source is unclear.';

  const evidence = uniqueSorted([
    ...scanState.verificationEvidence.providerVerificationTests,
    ...scanState.verificationEvidence.localPactFiles,
    ...scanState.httpSurface.requestMappings,
    ...coverageSummary.coveredEndpoints,
    ...coverageSummary.uncoveredEndpoints,
    ...coverageSummary.endpointsWithGaps,
    ...scanState.verificationEvidence.integrationTestPriorArt,
  ]);

  return {
    expectedTestStyle,
    scaffoldDirection,
    evidence,
  };
}

function buildCoverageSummary(scanState: PactProviderScanState): PactProviderPlanState['coverageSummary'] {
  const summary = scanState.coverageModel.coverageSummary;

  return {
    coveredEndpoints: summary.coveredEndpoints,
    endpointsWithGaps: summary.endpointsWithGaps,
    unverifiedEndpoints: summary.unverifiedEndpoints,
    uncoveredEndpoints: summary.uncoveredEndpoints,
    ambiguousEndpoints: summary.ambiguousEndpoints,
    coveredInteractions: summary.coveredInteractions,
    interactionStateGaps: summary.interactionStateGaps,
    unverifiedInteractions: summary.unverifiedInteractions,
    unmappedInteractions: summary.unmappedInteractions,
    setupOnlyTargets: summary.setupOnlyTargets,
    recommendedNextSlice: summary.recommendedNextSlice,
    contractSurfaceConfidence: scanState.coverageModel.contractSurfaceInventory.confidence,
  };
}

function buildPlannedTasks(
  scanState: PactProviderScanState,
  verdict: PactPlanVerdict,
  existingSetup: string,
): PactProviderPlanTask[] {
  if (verdict === 'irrelevant') {
    return [];
  }

  const tasks: PactProviderPlanTask[] = [];
  const coverageSummary = scanState.coverageModel.coverageSummary;
  const missingStates = scanState.coverageModel.stateInventory.missing;

  if (verdict === 'blocked') {
    tasks.push(
      makeTask(
        1,
        'Resolve provider binding ambiguity',
        'Compare the competing provider candidates in persisted scan-state and choose the provider under contract explicitly before any verification scaffolding.',
        [],
        [...scanState.coverageModel.ambiguityMarkers, ...scanState.provider.evidence],
      ),
    );
    return tasks;
  }

  if (scanState.artifactSource.verdict === 'broker') {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Clarify broker-backed pact retrieval',
        `Persist how broker artifacts are expected to be resolved and authenticated before treating verification as runnable. Evidence: ${scanState.artifactSource.evidence.join(', ') || '(broker hints only)'}.`,
        scanState.artifactSource.evidence,
        scanState.artifactSource.evidence,
      ),
    );
  }

  if (scanState.artifactSource.verdict === 'unclear') {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Clarify pact artifact source',
        'Determine whether pact files come from local fixtures or a broker before treating any provider endpoint as truly covered.',
        [],
        [...coverageSummary.setupOnlyTargets, ...scanState.httpSurface.requestMappings],
      ),
    );
  }

  if (existingSetup === 'extend-existing-provider-verification') {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Extend the existing provider verification setup',
        `Reuse and remediate the existing Pact provider test instead of recreating it: ${scanState.verificationEvidence.providerVerificationTests.join(', ')}.`,
        scanState.verificationEvidence.providerVerificationTests,
        scanState.verificationEvidence.providerVerificationTests,
      ),
    );
  } else {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Scaffold a provider verification test',
        `Create a Spring Pact provider verification entrypoint for ${scanState.provider.name ?? 'the selected provider'} using the persisted HTTP surface and artifact-source evidence.`,
        scanState.httpSurface.controllerFiles,
        scanState.httpSurface.requestMappings,
      ),
    );
  }

  if (missingStates.length > 0) {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Add missing provider states',
        `Implement the missing provider-state support surfaced by scan-state: ${missingStates.join(', ')}.`,
        missingStates,
        coverageSummary.interactionStateGaps,
      ),
    );
  } else if (scanState.providerStates.stateAnnotations.length > 0) {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Audit provider state coverage',
        `Start from the known provider states and verify they still match the target interactions: ${scanState.providerStates.stateAnnotations.join(', ')}.`,
        scanState.providerStates.stateAnnotations,
        coverageSummary.coveredInteractions,
      ),
    );
  }

  if (coverageSummary.endpointsWithGaps.length > 0 || coverageSummary.unverifiedEndpoints.length > 0) {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Extend coverage for partially represented endpoints',
        'Close the gap between existing Pact interactions and runnable provider verification for endpoints that are represented but still weak, state-gapped, or setup-only.',
        [...coverageSummary.endpointsWithGaps, ...coverageSummary.unverifiedEndpoints],
        [...coverageSummary.interactionStateGaps, ...coverageSummary.unverifiedInteractions, ...coverageSummary.setupOnlyTargets],
      ),
    );
  }

  if (coverageSummary.uncoveredEndpoints.length > 0) {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Add coverage for uncovered provider endpoints',
        'Implement the next provider contract-test slice for the endpoints that are present in the Spring HTTP surface but not represented by current Pact verification.',
        coverageSummary.uncoveredEndpoints,
        scanState.httpSurface.requestMappings,
      ),
    );
  }

  if (scanState.verificationEvidence.integrationTestPriorArt.length > 0) {
    tasks.push(
      makeTask(
        tasks.length + 1,
        'Reuse existing integration bootstrap',
        `Lift stable fixture/bootstrap patterns from existing tests instead of inventing a new harness: ${scanState.verificationEvidence.integrationTestPriorArt.join(', ')}.`,
        scanState.verificationEvidence.integrationTestPriorArt,
        scanState.verificationEvidence.integrationTestPriorArt,
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
  const coverageSummary = buildCoverageSummary(scanState);

  return {
    schemaVersion: 2,
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
      missingStates: scanState.coverageModel.stateInventory.missing,
      gaps: buildProviderStateGaps(scanState),
      recommendedActions: buildProviderStateActions(scanState),
    },
    coverageSummary,
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
    '### Coverage snapshot',
    `- Contract surface confidence: ${state.coverageSummary.contractSurfaceConfidence}`,
    `- Covered endpoints: ${state.coverageSummary.coveredEndpoints.join(', ') || '(none)'}`,
    `- Endpoints with gaps: ${state.coverageSummary.endpointsWithGaps.join(', ') || '(none)'}`,
    `- Unverified endpoints: ${state.coverageSummary.unverifiedEndpoints.join(', ') || '(none)'}`,
    `- Uncovered endpoints: ${state.coverageSummary.uncoveredEndpoints.join(', ') || '(none)'}`,
    `- Covered interactions: ${state.coverageSummary.coveredInteractions.join(', ') || '(none)'}`,
    `- Interaction state gaps: ${state.coverageSummary.interactionStateGaps.join(', ') || '(none)'}`,
    `- Setup-only targets: ${state.coverageSummary.setupOnlyTargets.join(', ') || '(none)'}`,
    '',
    '### Verification readiness',
    `- Planning verdict: ${state.verificationReadiness.verdict}`,
    `- Existing setup: ${state.verificationReadiness.existingSetup}`,
    `- Why: ${state.verificationReadiness.why.join('; ') || '(none)'}`,
    '',
    '### Provider-state work',
    `- Existing states: ${state.providerStateWork.existingStates.join(', ') || '(none)'}`,
    `- Missing states: ${state.providerStateWork.missingStates.join(', ') || '(none)'}`,
    `- Gaps: ${state.providerStateWork.gaps.join('; ') || '(none)'}`,
    `- Recommended actions: ${state.providerStateWork.recommendedActions.join('; ') || '(none)'}`,
    '',
    '### Planned tasks',
    ...(state.plannedTasks.length > 0
      ? state.plannedTasks.map((task) => `${task.id}. ${task.title} — ${task.rationale}`)
      : ['(none)']),
    '',
    '### Next concrete slice',
    ...(state.coverageSummary.recommendedNextSlice.length > 0
      ? state.coverageSummary.recommendedNextSlice.map((entry) => `- ${entry}`)
      : ['- None.']),
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
