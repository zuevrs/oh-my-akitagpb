import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PactProviderPlanState, PactPlanVerdict } from './plan-proof.js';
import type {
  ArtifactSourceVerdict,
  PactProviderEndpointCoverage,
  PactProviderInteractionCoverage,
  PactProviderScanState,
  ProviderConfidence,
} from './scan-proof.js';

export type PactWriteOutcome = 'written' | 'partial' | 'blocked' | 'no-op';
export type PactWriteCategory =
  | 'extend-existing-provider-verification'
  | 'add-missing-provider-states'
  | 'extend-partial-endpoint-coverage'
  | 'prepare-uncovered-endpoint-coverage'
  | 'partial-preparation'
  | 'blocked'
  | 'irrelevant';

export interface PactProviderWriteState {
  schemaVersion: 2;
  generatedAt: string;
  projectRoot: string;
  scanStatePath: string;
  planStatePath: string;
  providerSelection: {
    name: string | null;
    confidence: ProviderConfidence;
    existingSetup: string;
    artifactSource: ArtifactSourceVerdict;
  };
  inputPlanVerdict: PactPlanVerdict;
  writeOutcome: PactWriteOutcome;
  targetCoverageSlice: {
    category: PactWriteCategory;
    summary: string;
    verificationTarget: string | null;
    endpoints: string[];
    interactions: string[];
    providerStates: string[];
    plannedTaskIds: string[];
    plannedTaskTitles: string[];
  };
  remainingCoverageGaps: {
    endpointsWithGaps: string[];
    unverifiedEndpoints: string[];
    uncoveredEndpoints: string[];
    interactionStateGaps: string[];
    unverifiedInteractions: string[];
    missingProviderStates: string[];
  };
  validationFocus: string[];
  filesPlanned: string[];
  filesWritten: string[];
  filesModified: string[];
  writesSkipped: Array<{
    path: string;
    reason: string;
  }>;
  unresolvedBlockers: string[];
  manualFollowUps: string[];
  expectedVerificationCommand: string | null;
  notes: string[];
}

export interface ProofWriteArtifacts {
  state: PactProviderWriteState;
  statePath: string;
  summaryPath: string;
}

interface RepoWritePlan {
  targetPath: string | null;
  targetCoverageSlice: PactProviderWriteState['targetCoverageSlice'];
  remainingCoverageGaps: PactProviderWriteState['remainingCoverageGaps'];
  validationFocus: string[];
  filesPlanned: string[];
  filesWritten: string[];
  filesModified: string[];
  writesSkipped: Array<{
    path: string;
    reason: string;
  }>;
  unresolvedBlockers: string[];
  manualFollowUps: string[];
  notes: string[];
  coverageImplemented: boolean;
}

interface CoverageSliceDraft {
  category: PactWriteCategory;
  summary: string;
  endpoints: string[];
  interactions: string[];
  providerStates: string[];
  plannedTaskIds: string[];
  plannedTaskTitles: string[];
  coverageImplemented: boolean;
}

const INSTALLED_WRITE_CONTRACT_RELATIVE_PATH = path.join(
  '.oma',
  'packs',
  'oh-my-pactgpb',
  'templates',
  'write',
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

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function toJavaMethodName(stateName: string): string {
  const sanitized = stateName
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (sanitized.length === 0) {
    return 'providerState';
  }

  const [first, ...rest] = sanitized;
  return [first!.toLowerCase(), ...rest.map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`)].join('');
}

function toJavaClassName(providerName: string | null): string {
  const normalized = (providerName ?? 'provider')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`)
    .join('');

  return `${normalized || 'Provider'}PactTest`;
}

function extractConcreteStateNames(projectRoot: string, scanState: PactProviderScanState): string[] {
  const stateNames = new Set<string>(scanState.providerStates.stateAnnotations);

  for (const relativePath of scanState.verificationEvidence.localPactFiles) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as {
        interactions?: Array<{
          providerStates?: Array<{ name?: string }>;
        }>;
      };

      for (const interaction of parsed.interactions ?? []) {
        for (const providerState of interaction.providerStates ?? []) {
          if (typeof providerState.name === 'string' && providerState.name.trim().length > 0) {
            stateNames.add(providerState.name.trim());
          }
        }
      }
    } catch {
      continue;
    }
  }

  return uniqueSorted(stateNames);
}

function localPactFolderPath(scanState: PactProviderScanState): string | null {
  const firstPactFile = scanState.verificationEvidence.localPactFiles[0];
  if (!firstPactFile) {
    return null;
  }

  return toPosixPath(path.posix.dirname(firstPactFile));
}

function selectExistingProviderTest(projectRoot: string, scanState: PactProviderScanState, planState: PactProviderPlanState): string | null {
  const testPaths = scanState.verificationEvidence.providerVerificationTests;
  if (testPaths.length === 0) {
    return null;
  }

  if (testPaths.length === 1) {
    return testPaths[0] ?? null;
  }

  const providerName = planState.providerSelection.name;
  if (!providerName) {
    return null;
  }

  const matchingPaths = testPaths.filter((relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!existsSync(absolutePath)) {
      return false;
    }

    return readFileSync(absolutePath, 'utf8').includes(`@Provider("${providerName}")`);
  });

  return matchingPaths.length === 1 ? (matchingPaths[0] ?? null) : null;
}

function deriveNewProviderTestPath(scanState: PactProviderScanState, planState: PactProviderPlanState): string | null {
  const controllerPath = scanState.httpSurface.controllerFiles[0];
  if (!controllerPath || !planState.providerSelection.name) {
    return null;
  }

  const normalized = toPosixPath(controllerPath);
  const javaPrefix = 'src/main/java/';
  const kotlinPrefix = 'src/main/kotlin/';
  const sourcePrefix = normalized.startsWith(javaPrefix)
    ? javaPrefix
    : normalized.startsWith(kotlinPrefix)
      ? kotlinPrefix
      : null;

  if (!sourcePrefix) {
    return null;
  }

  const packageAndFile = normalized.slice(sourcePrefix.length);
  const lastSlash = packageAndFile.lastIndexOf('/');
  if (lastSlash === -1) {
    return null;
  }

  const packagePath = packageAndFile.slice(0, lastSlash);
  const contractPackagePath = packagePath.endsWith('/api') ? `${packagePath.slice(0, -4)}/contract` : `${packagePath}/contract`;
  const testFileName = `${toJavaClassName(planState.providerSelection.name)}.java`;

  return `src/test/java/${contractPackagePath}/${testFileName}`;
}

function ensureImport(content: string, importLine: string): string {
  if (content.includes(importLine)) {
    return content;
  }

  const packageMatch = content.match(/^(package\s+[^;]+;\n\n)/);
  const packageBlock = packageMatch?.[1];
  if (!packageBlock) {
    return `${importLine}\n${content}`;
  }

  return content.replace(packageBlock, `${packageBlock}${importLine}\n`);
}

function insertBeforeClassClosingBrace(content: string, block: string): string {
  const closingIndex = content.lastIndexOf('}');
  if (closingIndex === -1) {
    return `${content.trimEnd()}\n\n${block.trimEnd()}\n`;
  }

  return `${content.slice(0, closingIndex).trimEnd()}\n\n${block.trimEnd()}\n${content.slice(closingIndex)}`;
}

function ensureHttpTargetSetup(content: string): string {
  if (content.includes('HttpTestTarget(') || content.includes('setTarget(')) {
    return content;
  }

  let nextContent = ensureImport(content, 'import au.com.dius.pact.provider.junitsupport.target.HttpTestTarget;');
  nextContent = ensureImport(nextContent, 'import org.junit.jupiter.api.BeforeEach;');

  const insertionPoint = nextContent.indexOf('  @TestTemplate');
  const beforeEachBlock = [
    '  @BeforeEach',
    '  void beforeEach(PactVerificationContext context) {',
    '    context.setTarget(new HttpTestTarget("localhost", 8080));',
    '  }',
    '',
  ].join('\n');

  if (insertionPoint === -1) {
    return insertBeforeClassClosingBrace(nextContent, beforeEachBlock);
  }

  return `${nextContent.slice(0, insertionPoint)}${beforeEachBlock}${nextContent.slice(insertionPoint)}`;
}

function ensureStateMethods(content: string, stateNames: readonly string[]): string {
  const existingStates = new Set<string>();
  for (const match of content.matchAll(/@State\("([^"]+)"\)/g)) {
    const stateName = match[1];
    if (stateName) {
      existingStates.add(stateName);
    }
  }

  const missingStates = stateNames.filter((stateName) => !existingStates.has(stateName));
  if (missingStates.length === 0) {
    return content;
  }

  let nextContent = ensureImport(content, 'import au.com.dius.pact.provider.junitsupport.State;');
  const methods = missingStates.map((stateName) => [
    `  @State("${stateName}")`,
    `  void ${toJavaMethodName(stateName)}() {`,
    '  }',
  ].join('\n')).join('\n\n');

  nextContent = insertBeforeClassClosingBrace(nextContent, methods);
  return nextContent;
}

function ensureComment(content: string, commentLines: readonly string[]): string {
  const firstLine = commentLines[0];
  if (!firstLine || content.includes(firstLine)) {
    return content;
  }

  return insertBeforeClassClosingBrace(content, commentLines.join('\n'));
}

function interactionLabel(interaction: PactProviderInteractionCoverage): string {
  const requestLabel = interaction.method && interaction.path ? `${interaction.method} ${interaction.path}` : interaction.description;
  return `${requestLabel} (${interaction.sourceFile})`;
}

function endpointLabel(endpoint: PactProviderEndpointCoverage): string {
  return `${endpoint.method} ${endpoint.path}`;
}

function isLocalContractGrounding(scanState: PactProviderScanState): boolean {
  return scanState.artifactSource.verdict === 'local' && scanState.verificationEvidence.localPactFiles.length > 0;
}

function pickTaskLinks(planState: PactProviderPlanState, preferredTitles: readonly string[]): Pick<CoverageSliceDraft, 'plannedTaskIds' | 'plannedTaskTitles'> {
  const preferred = new Set(preferredTitles);
  const matchingTasks = planState.plannedTasks.filter((task) => preferred.has(task.title));

  return {
    plannedTaskIds: uniqueSorted(matchingTasks.map((task) => task.id)),
    plannedTaskTitles: uniqueSorted(matchingTasks.map((task) => task.title)),
  };
}

function labelsFromInteractions(
  interactions: readonly PactProviderInteractionCoverage[],
  endpointIndex: Map<string, PactProviderEndpointCoverage>,
): { interactionLabels: string[]; endpointLabels: string[] } {
  const interactionLabels = uniqueSorted(interactions.map((interaction) => interactionLabel(interaction)));
  const endpointLabels = new Set<string>();

  for (const interaction of interactions) {
    for (const endpointId of interaction.matchedEndpointIds) {
      const endpoint = endpointIndex.get(endpointId);
      if (endpoint) {
        endpointLabels.add(endpointLabel(endpoint));
      }
    }

    if (interaction.method && interaction.path) {
      endpointLabels.add(`${interaction.method} ${interaction.path.replace(/\/[^/]+(?=\/|$)/g, '{id}').replace(/\/{2,}/g, '/')}`);
    }
  }

  return {
    interactionLabels,
    endpointLabels: uniqueSorted(endpointLabels),
  };
}

function deriveTargetCoverageSlice(
  scanState: PactProviderScanState,
  planState: PactProviderPlanState,
  verificationTarget: string | null,
  concreteStateNames: readonly string[],
): CoverageSliceDraft {
  const planVerdict = planState.verificationReadiness.verdict;
  const endpointIndex = new Map(scanState.coverageModel.contractSurfaceInventory.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const interactions = scanState.coverageModel.interactionInventory;
  const missingStates = scanState.coverageModel.stateInventory.missing;
  const groundedMissingStates = missingStates.filter((stateName) => concreteStateNames.includes(stateName));
  const localGrounding = isLocalContractGrounding(scanState);
  const coveredEndpointFocus = planState.coverageSummary.coveredEndpoints[0] ?? scanState.httpSurface.requestMappings[0] ?? '(unknown endpoint)';

  if (planVerdict === 'blocked') {
    const taskLinks = pickTaskLinks(planState, ['Resolve provider binding ambiguity']);
    return {
      category: 'blocked',
      summary: 'Write stayed blocked because persisted plan state did not identify a safe provider contract target.',
      endpoints: [],
      interactions: [],
      providerStates: [],
      coverageImplemented: false,
      ...taskLinks,
    };
  }

  if (planVerdict === 'irrelevant') {
    return {
      category: 'irrelevant',
      summary: 'Write stayed a no-op because Pact provider verification is irrelevant for this repo.',
      endpoints: [],
      interactions: [],
      providerStates: [],
      plannedTaskIds: [],
      plannedTaskTitles: [],
      coverageImplemented: false,
    };
  }

  if (groundedMissingStates.length > 0) {
    const relatedInteractions = interactions.filter((interaction) =>
      interaction.providerStates.some((stateName) => groundedMissingStates.includes(stateName)),
    );
    const labels = labelsFromInteractions(relatedInteractions, endpointIndex);
    const taskLinks = pickTaskLinks(planState, [
      'Extend the existing provider verification setup',
      'Scaffold a provider verification test',
      'Add missing provider states',
      'Extend coverage for partially represented endpoints',
    ]);

    return {
      category: 'add-missing-provider-states',
      summary: `Implement the missing provider state coverage for ${groundedMissingStates.join(', ')}${labels.endpointLabels.length > 0 ? ` on ${labels.endpointLabels.join(', ')}` : ''}.`,
      endpoints: labels.endpointLabels,
      interactions: labels.interactionLabels,
      providerStates: uniqueSorted(groundedMissingStates),
      coverageImplemented: localGrounding,
      ...taskLinks,
    };
  }

  const partialInteractions = interactions.filter((interaction) => interaction.status === 'state-gap' || interaction.status === 'unverified');
  if (partialInteractions.length > 0) {
    const labels = labelsFromInteractions(partialInteractions, endpointIndex);
    const taskLinks = pickTaskLinks(planState, [
      'Extend the existing provider verification setup',
      'Scaffold a provider verification test',
      'Extend coverage for partially represented endpoints',
    ]);

    return {
      category: 'extend-partial-endpoint-coverage',
      summary: `Extend the next partially represented provider contract slice for ${labels.endpointLabels.join(', ') || 'the persisted interaction gaps'}.`,
      endpoints: labels.endpointLabels,
      interactions: labels.interactionLabels,
      providerStates: uniqueSorted(partialInteractions.flatMap((interaction) => interaction.providerStates.filter((stateName) => concreteStateNames.includes(stateName)))),
      coverageImplemented: localGrounding && labels.interactionLabels.length > 0,
      ...taskLinks,
    };
  }

  if (planState.coverageSummary.uncoveredEndpoints.length > 0) {
    const nextEndpoint = planState.coverageSummary.uncoveredEndpoints[0]!;
    const taskLinks = pickTaskLinks(planState, [
      'Extend the existing provider verification setup',
      'Scaffold a provider verification test',
      'Add coverage for uncovered provider endpoints',
      'Clarify pact artifact source',
      'Clarify broker-backed pact retrieval',
    ]);

    const category: PactWriteCategory = planVerdict === 'needs-artifact-source-clarification'
      ? 'partial-preparation'
      : 'prepare-uncovered-endpoint-coverage';

    return {
      category,
      summary: planVerdict === 'needs-artifact-source-clarification'
        ? `Keep ${nextEndpoint} as the next uncovered endpoint slice, but stay in preparation mode until the pact artifact source is grounded.`
        : `Prepare the next uncovered provider endpoint slice for ${nextEndpoint} without widening beyond that endpoint.`,
      endpoints: [nextEndpoint],
      interactions: [],
      providerStates: [],
      coverageImplemented: false,
      ...taskLinks,
    };
  }

  const taskLinks = pickTaskLinks(planState, [
    'Extend the existing provider verification setup',
    'Scaffold a provider verification test',
  ]);

  return {
    category: verificationTarget ? 'extend-existing-provider-verification' : 'partial-preparation',
    summary: verificationTarget
      ? `Extend the existing provider verification target in place for ${coveredEndpointFocus}.`
      : `Create the minimal provider verification entrypoint needed to start the next coverage-aware write increment for ${coveredEndpointFocus}.`,
    endpoints: [coveredEndpointFocus],
    interactions: uniqueSorted(scanState.coverageModel.coverageSummary.coveredInteractions.slice(0, 1)),
    providerStates: uniqueSorted(scanState.providerStates.stateAnnotations),
    coverageImplemented: localGrounding && scanState.coverageModel.coverageSummary.coveredInteractions.length > 0,
    ...taskLinks,
  };
}

function deriveRemainingCoverageGaps(
  scanState: PactProviderScanState,
  targetCoverageSlice: CoverageSliceDraft,
): PactProviderWriteState['remainingCoverageGaps'] {
  const summary = scanState.coverageModel.coverageSummary;
  const resolvedEndpoints = new Set<string>(targetCoverageSlice.coverageImplemented ? targetCoverageSlice.endpoints : []);
  const resolvedInteractions = new Set<string>(targetCoverageSlice.coverageImplemented ? targetCoverageSlice.interactions : []);
  const resolvedProviderStates = new Set<string>(targetCoverageSlice.coverageImplemented ? targetCoverageSlice.providerStates : []);

  return {
    endpointsWithGaps: uniqueSorted(summary.endpointsWithGaps.filter((entry) => !resolvedEndpoints.has(entry))),
    unverifiedEndpoints: uniqueSorted(summary.unverifiedEndpoints.filter((entry) => !resolvedEndpoints.has(entry))),
    uncoveredEndpoints: uniqueSorted(summary.uncoveredEndpoints.filter((entry) => !resolvedEndpoints.has(entry))),
    interactionStateGaps: uniqueSorted(summary.interactionStateGaps.filter((entry) => !resolvedInteractions.has(entry))),
    unverifiedInteractions: uniqueSorted(summary.unverifiedInteractions.filter((entry) => !resolvedInteractions.has(entry))),
    missingProviderStates: uniqueSorted(scanState.coverageModel.stateInventory.missing.filter((entry) => !resolvedProviderStates.has(entry))),
  };
}

function buildValidationFocus(
  targetCoverageSlice: CoverageSliceDraft,
  remainingCoverageGaps: PactProviderWriteState['remainingCoverageGaps'],
  verificationTarget: string | null,
): string[] {
  return uniqueSorted([
    `Validate the targeted coverage slice: ${targetCoverageSlice.summary}`,
    verificationTarget ? `Confirm ${verificationTarget} was used as the write target.` : '',
    targetCoverageSlice.endpoints.length > 0 ? `Recheck target endpoints: ${targetCoverageSlice.endpoints.join(', ')}.` : '',
    targetCoverageSlice.interactions.length > 0 ? `Recheck target interactions: ${targetCoverageSlice.interactions.join(', ')}.` : '',
    targetCoverageSlice.providerStates.length > 0 ? `Recheck target provider states: ${targetCoverageSlice.providerStates.join(', ')}.` : '',
    remainingCoverageGaps.uncoveredEndpoints.length > 0 ? `Keep remaining uncovered endpoints explicit: ${remainingCoverageGaps.uncoveredEndpoints.join(', ')}.` : '',
    remainingCoverageGaps.missingProviderStates.length > 0 ? `Keep remaining missing provider states explicit: ${remainingCoverageGaps.missingProviderStates.join(', ')}.` : '',
  ].filter((entry) => entry.length > 0));
}

function buildCoverageSliceCommentLines(
  targetCoverageSlice: CoverageSliceDraft,
  coverageImplemented: boolean,
): string[] {
  return [
    `  // Coverage slice: ${targetCoverageSlice.category}`,
    `  // Summary: ${targetCoverageSlice.summary}`,
    `  // Target endpoints: ${targetCoverageSlice.endpoints.join(', ') || '(none)'}`,
    `  // Target interactions: ${targetCoverageSlice.interactions.join(', ') || '(none)'}`,
    `  // Target provider states: ${targetCoverageSlice.providerStates.join(', ') || '(none)'}`,
    coverageImplemented
      ? '  // Coverage slice status: provider-side coverage was extended from persisted scan/plan evidence.'
      : '  // Coverage slice status: preparation only; do not claim full endpoint or interaction coverage yet.',
  ];
}

function renderNewProviderVerificationTest(
  scanState: PactProviderScanState,
  planState: PactProviderPlanState,
  packageName: string,
  stateNames: readonly string[],
  targetCoverageSlice: CoverageSliceDraft,
  coverageImplemented: boolean,
): string {
  const artifactSourceAnnotation = scanState.artifactSource.verdict === 'local'
    ? `@PactFolder("${localPactFolderPath(scanState) ?? 'src/test/resources/pacts'}")`
    : scanState.artifactSource.verdict === 'broker'
      ? '@PactBroker'
      : null;

  const stateMethods = stateNames.length > 0
    ? `\n\n${stateNames.map((stateName) => [
      `  @State("${stateName}")`,
      `  void ${toJavaMethodName(stateName)}() {`,
      '  }',
    ].join('\n')).join('\n\n')}`
    : '';

  const coverageComment = `\n\n${buildCoverageSliceCommentLines(targetCoverageSlice, coverageImplemented).join('\n')}`;

  const unresolvedStateComment = planState.verificationReadiness.verdict === 'needs-provider-state-work' && stateNames.length === 0
    ? '\n\n  // Manual follow-up: persisted write inputs did not expose concrete provider state names.\n  // Add @State handlers here once the pact interaction state names are confirmed.'
    : '';

  const artifactClarificationComment = planState.verificationReadiness.verdict === 'needs-artifact-source-clarification'
    ? '\n\n  // Manual follow-up: pact artifact retrieval is still unresolved.\n  // Confirm local pact inputs or broker access before treating this verification as runnable.'
    : '';

  const uncoveredEndpointComment = targetCoverageSlice.category === 'prepare-uncovered-endpoint-coverage' || targetCoverageSlice.category === 'partial-preparation'
    ? `\n\n  // Manual follow-up: obtain or author grounded Pact interactions before claiming coverage for ${targetCoverageSlice.endpoints.join(', ') || 'the targeted endpoint slice'}.`
    : '';

  return [
    `package ${packageName};`,
    '',
    'import au.com.dius.pact.provider.junitsupport.Provider;',
    'import au.com.dius.pact.provider.junitsupport.State;',
    ...(artifactSourceAnnotation === '@PactBroker'
      ? ['import au.com.dius.pact.provider.junitsupport.loader.PactBroker;']
      : ['import au.com.dius.pact.provider.junitsupport.loader.PactFolder;']),
    'import au.com.dius.pact.provider.junitsupport.target.HttpTestTarget;',
    'import au.com.dius.pact.provider.junit5.PactVerificationContext;',
    'import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider;',
    'import org.junit.jupiter.api.BeforeEach;',
    'import org.junit.jupiter.api.TestTemplate;',
    'import org.junit.jupiter.api.extension.ExtendWith;',
    'import org.springframework.boot.test.context.SpringBootTest;',
    '',
    `@Provider("${planState.providerSelection.name}")`,
    ...(artifactSourceAnnotation ? [artifactSourceAnnotation] : []),
    '@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)',
    `class ${toJavaClassName(planState.providerSelection.name)} {`,
    '',
    '  @BeforeEach',
    '  void beforeEach(PactVerificationContext context) {',
    '    context.setTarget(new HttpTestTarget("localhost", 8080));',
    '  }',
    '',
    '  @TestTemplate',
    '  @ExtendWith(PactVerificationInvocationContextProvider.class)',
    '  void verifyPacts(PactVerificationContext context) {',
    '    context.verifyInteraction();',
    '  }',
    stateMethods,
    coverageComment,
    unresolvedStateComment,
    artifactClarificationComment,
    uncoveredEndpointComment,
    '}',
    '',
  ].filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');
}

function ensurePomDependency(content: string, dependencyBlock: string): string {
  if (content.includes(dependencyBlock)) {
    return content;
  }

  const dependenciesClosingTag = '</dependencies>';
  if (!content.includes(dependenciesClosingTag)) {
    return content;
  }

  return content.replace(dependenciesClosingTag, `${dependencyBlock}\n  ${dependenciesClosingTag}`);
}

function maybePatchPom(projectRoot: string, targetPath: string, filesModified: string[], notes: string[]): void {
  const pomPath = path.join(projectRoot, 'pom.xml');
  if (!existsSync(pomPath)) {
    return;
  }

  const original = readFileSync(pomPath, 'utf8');
  let nextContent = original;

  if (!nextContent.includes('<artifactId>spring-boot-starter-test</artifactId>')) {
    nextContent = ensurePomDependency(nextContent, [
      '    <dependency>',
      '      <groupId>org.springframework.boot</groupId>',
      '      <artifactId>spring-boot-starter-test</artifactId>',
      '      <scope>test</scope>',
      '    </dependency>',
    ].join('\n'));
  }

  if (!nextContent.includes('<groupId>au.com.dius.pact.provider</groupId>') || !nextContent.includes('<artifactId>junit5spring</artifactId>')) {
    nextContent = ensurePomDependency(nextContent, [
      '    <dependency>',
      '      <groupId>au.com.dius.pact.provider</groupId>',
      '      <artifactId>junit5spring</artifactId>',
      '      <version>4.6.10</version>',
      '      <scope>test</scope>',
      '    </dependency>',
    ].join('\n'));
  }

  if (nextContent !== original) {
    writeFileSync(pomPath, nextContent, 'utf8');
    const relativePomPath = toPosixPath(path.relative(projectRoot, pomPath));
    if (!filesModified.includes(relativePomPath) && relativePomPath !== targetPath) {
      filesModified.push(relativePomPath);
    }
    notes.push('Patched pom.xml only for minimal Pact/Spring test dependencies required by the targeted coverage slice.');
  }
}

function determineVerificationCommand(projectRoot: string, targetPath: string | null): string | null {
  if (!targetPath) {
    return null;
  }

  const className = path.basename(targetPath, path.extname(targetPath));
  if (existsSync(path.join(projectRoot, 'pom.xml'))) {
    return `mvn test -Dtest=${className}`;
  }

  if (existsSync(path.join(projectRoot, 'build.gradle')) || existsSync(path.join(projectRoot, 'build.gradle.kts'))) {
    return `./gradlew test --tests ${className}`;
  }

  return null;
}

function applyRepoWrites(projectRoot: string, scanState: PactProviderScanState, planState: PactProviderPlanState): RepoWritePlan {
  const inputPlanVerdict = planState.verificationReadiness.verdict;
  const writesSkipped: RepoWritePlan['writesSkipped'] = [];
  const unresolvedBlockers = [...planState.blockedBy];
  const manualFollowUps: string[] = [];
  const notes: string[] = [];
  const filesWritten: string[] = [];
  const filesModified: string[] = [];
  const filesPlanned: string[] = [];

  const concreteStateNames = extractConcreteStateNames(projectRoot, scanState);
  const existingTargetPath = selectExistingProviderTest(projectRoot, scanState, planState);
  const targetPath = existingTargetPath ?? deriveNewProviderTestPath(scanState, planState);
  const targetCoverageSliceDraft = deriveTargetCoverageSlice(scanState, planState, targetPath, concreteStateNames);
  const targetCoverageSlice: PactProviderWriteState['targetCoverageSlice'] = {
    category: targetCoverageSliceDraft.category,
    summary: targetCoverageSliceDraft.summary,
    verificationTarget: targetPath,
    endpoints: targetCoverageSliceDraft.endpoints,
    interactions: targetCoverageSliceDraft.interactions,
    providerStates: targetCoverageSliceDraft.providerStates,
    plannedTaskIds: targetCoverageSliceDraft.plannedTaskIds,
    plannedTaskTitles: targetCoverageSliceDraft.plannedTaskTitles,
  };
  const remainingCoverageGaps = deriveRemainingCoverageGaps(scanState, targetCoverageSliceDraft);
  const validationFocus = buildValidationFocus(targetCoverageSliceDraft, remainingCoverageGaps, targetPath);

  if (inputPlanVerdict === 'blocked') {
    writesSkipped.push({
      path: 'provider-verification-scaffold',
      reason: 'Persisted plan verdict is blocked, so write must not imply progress by generating scaffolding.',
    });
    return {
      targetPath: null,
      targetCoverageSlice,
      remainingCoverageGaps,
      validationFocus,
      filesPlanned,
      filesWritten,
      filesModified,
      writesSkipped,
      unresolvedBlockers: uniqueSorted(unresolvedBlockers),
      manualFollowUps,
      notes,
      coverageImplemented: false,
    };
  }

  if (inputPlanVerdict === 'irrelevant') {
    writesSkipped.push({
      path: 'provider-verification-scaffold',
      reason: 'Persisted plan verdict is irrelevant, so Pact provider verification artifacts were not written.',
    });
    return {
      targetPath: null,
      targetCoverageSlice,
      remainingCoverageGaps,
      validationFocus,
      filesPlanned,
      filesWritten,
      filesModified,
      writesSkipped,
      unresolvedBlockers: [],
      manualFollowUps,
      notes,
      coverageImplemented: false,
    };
  }

  if (!targetPath) {
    unresolvedBlockers.push('No safe provider verification target file could be identified from persisted plan and scan state.');
    writesSkipped.push({
      path: 'provider-verification-scaffold',
      reason: 'Safe target selection failed, so write refused to invent a new architecture.',
    });
    return {
      targetPath: null,
      targetCoverageSlice,
      remainingCoverageGaps,
      validationFocus,
      filesPlanned,
      filesWritten,
      filesModified,
      writesSkipped,
      unresolvedBlockers: uniqueSorted(unresolvedBlockers),
      manualFollowUps,
      notes,
      coverageImplemented: false,
    };
  }

  filesPlanned.push(targetPath);

  const targetStatesToAdd = targetCoverageSlice.providerStates.filter((stateName) => concreteStateNames.includes(stateName));

  if (targetCoverageSlice.category === 'prepare-uncovered-endpoint-coverage' || targetCoverageSlice.category === 'partial-preparation') {
    const uncoveredMessage = `No grounded Pact interaction exists yet for: ${targetCoverageSlice.endpoints.join(', ') || 'the targeted endpoint slice'}.`;
    unresolvedBlockers.push(uncoveredMessage);
    manualFollowUps.push(`Obtain or author grounded Pact interactions before claiming coverage for ${targetCoverageSlice.endpoints.join(', ') || 'the targeted endpoint slice'}.`);
  }

  if (inputPlanVerdict === 'needs-provider-state-work' && targetStatesToAdd.length === 0) {
    manualFollowUps.push('Confirm pact interaction provider state names, then add concrete @State handlers to the provider verification target.');
    unresolvedBlockers.push('Provider state names are still unresolved, so verification must not be claimed ready yet.');
  }

  if (inputPlanVerdict === 'needs-artifact-source-clarification') {
    manualFollowUps.push('Confirm the Pact artifact source before treating provider verification as runnable.');
    unresolvedBlockers.push('Pact artifact source still needs clarification before runnable verification can be claimed.');
  }

  if (existingTargetPath) {
    const absoluteTargetPath = path.join(projectRoot, existingTargetPath);
    const original = readFileSync(absoluteTargetPath, 'utf8');
    let nextContent = ensureHttpTargetSetup(original);

    if (targetStatesToAdd.length > 0) {
      nextContent = ensureStateMethods(nextContent, targetStatesToAdd);
    }

    nextContent = ensureComment(nextContent, buildCoverageSliceCommentLines(targetCoverageSliceDraft, targetCoverageSliceDraft.coverageImplemented));

    if (inputPlanVerdict === 'needs-provider-state-work' && targetStatesToAdd.length === 0) {
      nextContent = ensureComment(nextContent, [
        '  // Manual follow-up: persisted pact inputs did not expose concrete provider state names.',
        '  // Add @State handlers here once interaction state names are confirmed.',
      ]);
    }

    if (inputPlanVerdict === 'needs-artifact-source-clarification') {
      nextContent = ensureComment(nextContent, [
        '  // Manual follow-up: pact artifact retrieval is still unresolved.',
        '  // Confirm local pact inputs or broker access before treating this verification as runnable.',
      ]);
    }

    if (targetCoverageSlice.category === 'prepare-uncovered-endpoint-coverage' || targetCoverageSlice.category === 'partial-preparation') {
      nextContent = ensureComment(nextContent, [
        `  // Manual follow-up: obtain or author grounded Pact interactions before claiming coverage for ${targetCoverageSlice.endpoints.join(', ') || 'the targeted endpoint slice'}.`,
      ]);
    }

    if (nextContent !== original) {
      writeFileSync(absoluteTargetPath, nextContent, 'utf8');
      filesModified.push(existingTargetPath);
      notes.push('Extended the existing provider verification target in place instead of creating a parallel suite.');
    } else {
      writesSkipped.push({
        path: existingTargetPath,
        reason: 'Existing provider verification target already contained the narrow coverage-aware changes this writer would add.',
      });
      notes.push('Existing provider verification target already reflected the selected coverage slice.');
    }

    maybePatchPom(projectRoot, existingTargetPath, filesModified, notes);

    return {
      targetPath: existingTargetPath,
      targetCoverageSlice,
      remainingCoverageGaps,
      validationFocus,
      filesPlanned: uniqueSorted(filesPlanned),
      filesWritten: uniqueSorted(filesWritten),
      filesModified: uniqueSorted(filesModified),
      writesSkipped,
      unresolvedBlockers: uniqueSorted(unresolvedBlockers),
      manualFollowUps: uniqueSorted(manualFollowUps),
      notes: uniqueSorted([
        ...notes,
        `Targeted coverage slice: ${targetCoverageSlice.category} — ${targetCoverageSlice.summary}`,
      ]),
      coverageImplemented: targetCoverageSliceDraft.coverageImplemented,
    };
  }

  const absoluteTargetPath = path.join(projectRoot, targetPath);
  mkdirSync(path.dirname(absoluteTargetPath), { recursive: true });
  const packagePath = targetPath
    .replace(/^src\/test\/java\//, '')
    .replace(/\/[^/]+$/, '')
    .split('/')
    .join('.');
  const rendered = renderNewProviderVerificationTest(
    scanState,
    planState,
    packagePath,
    targetStatesToAdd,
    targetCoverageSliceDraft,
    targetCoverageSliceDraft.coverageImplemented,
  );
  writeFileSync(absoluteTargetPath, rendered, 'utf8');
  filesWritten.push(targetPath);
  notes.push('Created a new provider verification target because persisted plan/scan state did not expose a safe existing extension point.');

  maybePatchPom(projectRoot, targetPath, filesModified, notes);

  return {
    targetPath,
    targetCoverageSlice,
    remainingCoverageGaps,
    validationFocus,
    filesPlanned: uniqueSorted(filesPlanned),
    filesWritten: uniqueSorted(filesWritten),
    filesModified: uniqueSorted(filesModified),
    writesSkipped,
    unresolvedBlockers: uniqueSorted(unresolvedBlockers),
    manualFollowUps: uniqueSorted(manualFollowUps),
    notes: uniqueSorted([
      ...notes,
      `Targeted coverage slice: ${targetCoverageSlice.category} — ${targetCoverageSlice.summary}`,
    ]),
    coverageImplemented: targetCoverageSliceDraft.coverageImplemented,
  };
}

function determineWriteOutcome(inputPlanVerdict: PactPlanVerdict, repoWritePlan: RepoWritePlan): PactWriteOutcome {
  if (inputPlanVerdict === 'blocked') {
    return 'blocked';
  }

  if (inputPlanVerdict === 'irrelevant') {
    return 'no-op';
  }

  const changedCount = repoWritePlan.filesWritten.length + repoWritePlan.filesModified.length;

  if (repoWritePlan.coverageImplemented && changedCount > 0) {
    return 'written';
  }

  if (changedCount > 0) {
    return 'partial';
  }

  if (repoWritePlan.unresolvedBlockers.length > 0) {
    return 'blocked';
  }

  return 'no-op';
}

export function deriveWriteFromPersistedState(projectRoot: string): PactProviderWriteState {
  const scanState = readPersistedScanState(projectRoot);
  const planState = readPersistedPlanState(projectRoot);
  const repoWritePlan = applyRepoWrites(projectRoot, scanState, planState);
  const inputPlanVerdict = planState.verificationReadiness.verdict;
  const writeOutcome = determineWriteOutcome(inputPlanVerdict, repoWritePlan);

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    projectRoot,
    scanStatePath: toPosixPath(PERSISTED_SCAN_STATE_RELATIVE_PATH),
    planStatePath: toPosixPath(PERSISTED_PLAN_STATE_RELATIVE_PATH),
    providerSelection: {
      name: planState.providerSelection.name,
      confidence: planState.providerSelection.confidence,
      existingSetup: planState.verificationReadiness.existingSetup,
      artifactSource: planState.artifactSourceStrategy.verdict,
    },
    inputPlanVerdict,
    writeOutcome,
    targetCoverageSlice: repoWritePlan.targetCoverageSlice,
    remainingCoverageGaps: repoWritePlan.remainingCoverageGaps,
    validationFocus: repoWritePlan.validationFocus,
    filesPlanned: repoWritePlan.filesPlanned,
    filesWritten: repoWritePlan.filesWritten,
    filesModified: repoWritePlan.filesModified,
    writesSkipped: repoWritePlan.writesSkipped,
    unresolvedBlockers: repoWritePlan.unresolvedBlockers,
    manualFollowUps: repoWritePlan.manualFollowUps,
    expectedVerificationCommand: determineVerificationCommand(projectRoot, repoWritePlan.targetPath),
    notes: uniqueSorted([
      ...repoWritePlan.notes,
      writeOutcome === 'written'
        ? 'Write recorded a real provider-side coverage extension for the targeted slice.'
        : '',
      writeOutcome === 'partial'
        ? 'Write recorded only a preparatory partial increment for the targeted slice.'
        : '',
      writeOutcome === 'blocked'
        ? 'Write persisted a blocked outcome instead of generating misleading scaffolding.'
        : '',
      writeOutcome === 'no-op'
        ? 'Write persisted an honest no-op outcome because no safe Pact provider increment could be applied.'
        : '',
    ].filter((value) => value.length > 0)),
  };
}

export function renderWriteSummary(state: PactProviderWriteState): string {
  const readinessClaim = state.writeOutcome === 'written'
    ? 'A real provider-side coverage increment was written for the targeted slice.'
    : state.writeOutcome === 'partial'
      ? 'Only partial preparation or remediation was written; do not claim full contract coverage yet.'
      : state.writeOutcome === 'blocked'
        ? 'No provider verification changes were written because the write stayed blocked.'
        : 'No Pact provider verification changes were written because the outcome was an honest no-op.';

  return [
    '# Pact provider write summary',
    '',
    'This file is only a concise summary. Canonical machine-readable write state lives in JSON under `.oma/packs/oh-my-pactgpb/state/shared/write/.`',
    '',
    '## Canonical JSON files',
    '',
    '- `write-state.json`',
    '',
    '## Summary',
    '',
    '### Provider selection',
    `- Selected provider: ${state.providerSelection.name ?? '(blocked or unclear)'}`,
    `- Input plan verdict: ${state.inputPlanVerdict}`,
    `- Write outcome: ${state.writeOutcome}`,
    '',
    '### Target coverage slice',
    `- Category: ${state.targetCoverageSlice.category}`,
    `- Summary: ${state.targetCoverageSlice.summary}`,
    `- Verification target: ${state.targetCoverageSlice.verificationTarget ?? '(none)'}`,
    `- Target endpoints: ${state.targetCoverageSlice.endpoints.join(', ') || '(none)'}`,
    `- Target interactions: ${state.targetCoverageSlice.interactions.join(', ') || '(none)'}`,
    `- Target provider states: ${state.targetCoverageSlice.providerStates.join(', ') || '(none)'}`,
    `- Planned task links: ${state.targetCoverageSlice.plannedTaskTitles.map((title, index) => `${state.targetCoverageSlice.plannedTaskIds[index] ?? '(task)'} ${title}`).join('; ') || '(none)'}`,
    '',
    '### Files planned and changed',
    `- Files planned: ${state.filesPlanned.join(', ') || '(none)'}`,
    `- Files written: ${state.filesWritten.join(', ') || '(none)'}`,
    `- Files modified: ${state.filesModified.join(', ') || '(none)'}`,
    `- Writes skipped: ${state.writesSkipped.map((entry) => `${entry.path} — ${entry.reason}`).join('; ') || '(none)'}`,
    '',
    '### Remaining coverage gaps',
    `- Endpoints with gaps: ${state.remainingCoverageGaps.endpointsWithGaps.join(', ') || '(none)'}`,
    `- Unverified endpoints: ${state.remainingCoverageGaps.unverifiedEndpoints.join(', ') || '(none)'}`,
    `- Uncovered endpoints: ${state.remainingCoverageGaps.uncoveredEndpoints.join(', ') || '(none)'}`,
    `- Interaction state gaps: ${state.remainingCoverageGaps.interactionStateGaps.join(', ') || '(none)'}`,
    `- Unverified interactions: ${state.remainingCoverageGaps.unverifiedInteractions.join(', ') || '(none)'}`,
    `- Missing provider states: ${state.remainingCoverageGaps.missingProviderStates.join(', ') || '(none)'}`,
    '',
    '### Remaining blockers and follow-up',
    `- Unresolved blockers: ${state.unresolvedBlockers.join('; ') || '(none)'}`,
    `- Manual follow-ups: ${state.manualFollowUps.join('; ') || '(none)'}`,
    `- Validation focus: ${state.validationFocus.join('; ') || '(none)'}`,
    `- Notes: ${state.notes.join('; ') || '(none)'}`,
    '',
    '### Verification next step',
    `- Expected verification command: ${state.expectedVerificationCommand ?? '(none)'}`,
    `- Verification readiness claim: ${readinessClaim}`,
    '',
  ].join('\n');
}

export function hasInstalledWriteContract(projectRoot: string): boolean {
  const contractPath = path.join(projectRoot, INSTALLED_WRITE_CONTRACT_RELATIVE_PATH);
  return existsSync(contractPath) && statSync(contractPath).isFile();
}

export function readPersistedScanState(projectRoot: string): PactProviderScanState {
  const scanStatePath = path.join(projectRoot, PERSISTED_SCAN_STATE_RELATIVE_PATH);

  if (!existsSync(scanStatePath)) {
    throw new Error(`Persisted scan-state is missing: ${toPosixPath(path.relative(projectRoot, scanStatePath))}`);
  }

  return readJsonFile<PactProviderScanState>(scanStatePath);
}

export function readPersistedPlanState(projectRoot: string): PactProviderPlanState {
  const planStatePath = path.join(projectRoot, PERSISTED_PLAN_STATE_RELATIVE_PATH);

  if (!existsSync(planStatePath)) {
    throw new Error(`Persisted plan-state is missing: ${toPosixPath(path.relative(projectRoot, planStatePath))}`);
  }

  return readJsonFile<PactProviderPlanState>(planStatePath);
}

export function writeProofWriteArtifacts(projectRoot: string): ProofWriteArtifacts {
  const state = deriveWriteFromPersistedState(projectRoot);
  const outputDir = path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'state', 'shared', 'write');
  mkdirSync(outputDir, { recursive: true });

  const statePath = path.join(outputDir, 'write-state.json');
  const summaryPath = path.join(outputDir, 'write-summary.md');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  writeFileSync(summaryPath, `${renderWriteSummary(state).trimEnd()}\n`, 'utf8');

  return {
    state,
    statePath,
    summaryPath,
  };
}
