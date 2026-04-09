import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PactProviderPlanState, PactPlanVerdict } from './plan-proof.js';
import type { ArtifactSourceVerdict, PactProviderScanState, ProviderConfidence } from './scan-proof.js';

export type PactWriteOutcome = 'written' | 'partial' | 'blocked' | 'no-op';

export interface PactProviderWriteState {
  schemaVersion: 1;
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
  targetKind: 'existing-test' | 'new-test' | 'none';
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

function renderNewProviderVerificationTest(
  scanState: PactProviderScanState,
  planState: PactProviderPlanState,
  packageName: string,
  stateNames: readonly string[],
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

  const unresolvedStateComment = stateNames.length === 0
    ? '\n\n  // Manual follow-up: persisted write inputs did not expose concrete provider state names.\n  // Add @State handlers here once the pact interaction state names are confirmed.'
    : '';

  const artifactClarificationComment = planState.verificationReadiness.verdict === 'needs-artifact-source-clarification'
    ? '\n\n  // Manual follow-up: pact artifact retrieval is still unresolved.\n  // Confirm local pact inputs or broker access before treating this verification as runnable.'
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
    unresolvedStateComment,
    artifactClarificationComment,
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
    notes.push('Patched pom.xml only for minimal Pact/Spring test dependencies required by the written scaffold.');
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

  if (inputPlanVerdict === 'blocked') {
    writesSkipped.push({
      path: 'provider-verification-scaffold',
      reason: 'Persisted plan verdict is blocked, so write must not imply progress by generating scaffolding.',
    });
    return {
      targetPath: null,
      targetKind: 'none',
      filesPlanned,
      filesWritten,
      filesModified,
      writesSkipped,
      unresolvedBlockers: uniqueSorted(unresolvedBlockers),
      manualFollowUps,
      notes,
    };
  }

  if (inputPlanVerdict === 'irrelevant') {
    writesSkipped.push({
      path: 'provider-verification-scaffold',
      reason: 'Persisted plan verdict is irrelevant, so Pact provider verification artifacts were not written.',
    });
    return {
      targetPath: null,
      targetKind: 'none',
      filesPlanned,
      filesWritten,
      filesModified,
      writesSkipped,
      unresolvedBlockers: [],
      manualFollowUps,
      notes,
    };
  }

  const concreteStateNames = extractConcreteStateNames(projectRoot, scanState);
  const existingTargetPath = selectExistingProviderTest(projectRoot, scanState, planState);
  const targetPath = existingTargetPath ?? deriveNewProviderTestPath(scanState, planState);

  if (!targetPath) {
    unresolvedBlockers.push('No safe provider verification target file could be identified from persisted plan and scan state.');
    writesSkipped.push({
      path: 'provider-verification-scaffold',
      reason: 'Safe target selection failed, so write refused to invent a new architecture.',
    });
    return {
      targetPath: null,
      targetKind: 'none',
      filesPlanned,
      filesWritten,
      filesModified,
      writesSkipped,
      unresolvedBlockers: uniqueSorted(unresolvedBlockers),
      manualFollowUps,
      notes,
    };
  }

  filesPlanned.push(targetPath);

  if (existingTargetPath) {
    const absoluteTargetPath = path.join(projectRoot, existingTargetPath);
    const original = readFileSync(absoluteTargetPath, 'utf8');
    let nextContent = ensureHttpTargetSetup(original);

    if (concreteStateNames.length > 0) {
      nextContent = ensureStateMethods(nextContent, concreteStateNames);
    }

    if (inputPlanVerdict === 'needs-provider-state-work' && concreteStateNames.length === 0) {
      nextContent = ensureComment(nextContent, [
        '  // Manual follow-up: persisted pact inputs did not expose concrete provider state names.',
        '  // Add @State handlers here once interaction state names are confirmed.',
      ]);
      manualFollowUps.push('Confirm pact interaction provider state names, then add concrete @State handlers to the provider verification test.');
      unresolvedBlockers.push('Provider state names are still unresolved, so verification must not be claimed ready yet.');
    }

    if (inputPlanVerdict === 'needs-artifact-source-clarification') {
      nextContent = ensureComment(nextContent, [
        '  // Manual follow-up: pact artifact retrieval is still unresolved.',
        '  // Confirm local pact inputs or broker access before treating this verification as runnable.',
      ]);
      manualFollowUps.push('Confirm the Pact artifact source before treating provider verification as runnable.');
      unresolvedBlockers.push('Pact artifact source still needs clarification before runnable verification can be claimed.');
    }

    if (nextContent !== original) {
      writeFileSync(absoluteTargetPath, nextContent, 'utf8');
      filesModified.push(existingTargetPath);
      notes.push('Extended the existing provider verification test instead of creating a parallel suite.');
    } else {
      writesSkipped.push({
        path: existingTargetPath,
        reason: 'Existing provider verification test already contained the minimal scaffold this writer would add.',
      });
      notes.push('Existing provider verification test was already close to the minimal scaffold shape.');
    }

    maybePatchPom(projectRoot, existingTargetPath, filesModified, notes);

    return {
      targetPath: existingTargetPath,
      targetKind: 'existing-test',
      filesPlanned: uniqueSorted(filesPlanned),
      filesWritten: uniqueSorted(filesWritten),
      filesModified: uniqueSorted(filesModified),
      writesSkipped,
      unresolvedBlockers: uniqueSorted(unresolvedBlockers),
      manualFollowUps: uniqueSorted(manualFollowUps),
      notes: uniqueSorted(notes),
    };
  }

  const absoluteTargetPath = path.join(projectRoot, targetPath);
  mkdirSync(path.dirname(absoluteTargetPath), { recursive: true });
  const packagePath = targetPath
    .replace(/^src\/test\/java\//, '')
    .replace(/\/[^/]+$/, '')
    .split('/')
    .join('.');
  const rendered = renderNewProviderVerificationTest(scanState, planState, packagePath, concreteStateNames);
  writeFileSync(absoluteTargetPath, rendered, 'utf8');
  filesWritten.push(targetPath);
  notes.push('Created a new provider verification test scaffold because persisted plan state did not point to an existing one.');

  if (inputPlanVerdict === 'needs-provider-state-work' && concreteStateNames.length === 0) {
    manualFollowUps.push('Confirm pact interaction provider state names, then replace the placeholder note with concrete @State handlers.');
    unresolvedBlockers.push('Provider state names are still unresolved, so verification must not be claimed ready yet.');
  }

  if (inputPlanVerdict === 'needs-artifact-source-clarification') {
    manualFollowUps.push('Confirm the Pact artifact source before treating the new scaffold as runnable verification.');
    unresolvedBlockers.push('Pact artifact source still needs clarification before runnable verification can be claimed.');
  }

  maybePatchPom(projectRoot, targetPath, filesModified, notes);

  return {
    targetPath,
    targetKind: 'new-test',
    filesPlanned: uniqueSorted(filesPlanned),
    filesWritten: uniqueSorted(filesWritten),
    filesModified: uniqueSorted(filesModified),
    writesSkipped,
    unresolvedBlockers: uniqueSorted(unresolvedBlockers),
    manualFollowUps: uniqueSorted(manualFollowUps),
    notes: uniqueSorted(notes),
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

  if (inputPlanVerdict === 'ready-to-scaffold') {
    return changedCount > 0 ? 'written' : 'no-op';
  }

  return changedCount > 0 ? 'partial' : 'blocked';
}

export function deriveWriteFromPersistedState(projectRoot: string): PactProviderWriteState {
  const scanState = readPersistedScanState(projectRoot);
  const planState = readPersistedPlanState(projectRoot);
  const repoWritePlan = applyRepoWrites(projectRoot, scanState, planState);
  const inputPlanVerdict = planState.verificationReadiness.verdict;
  const writeOutcome = determineWriteOutcome(inputPlanVerdict, repoWritePlan);

  return {
    schemaVersion: 1,
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
    filesPlanned: repoWritePlan.filesPlanned,
    filesWritten: repoWritePlan.filesWritten,
    filesModified: repoWritePlan.filesModified,
    writesSkipped: repoWritePlan.writesSkipped,
    unresolvedBlockers: repoWritePlan.unresolvedBlockers,
    manualFollowUps: repoWritePlan.manualFollowUps,
    expectedVerificationCommand: determineVerificationCommand(projectRoot, repoWritePlan.targetPath),
    notes: uniqueSorted([
      ...repoWritePlan.notes,
      inputPlanVerdict === 'needs-provider-state-work'
        ? 'Write stayed in partial mode because provider state work remains unresolved.'
        : '',
      inputPlanVerdict === 'needs-artifact-source-clarification'
        ? 'Write stayed in partial mode because pact artifact retrieval is not yet proven.'
        : '',
      inputPlanVerdict === 'blocked'
        ? 'Write persisted a blocked outcome instead of generating misleading scaffolding.'
        : '',
      inputPlanVerdict === 'irrelevant'
        ? 'Write persisted an honest no-op outcome because Pact provider verification is irrelevant here.'
        : '',
    ].filter((value) => value.length > 0)),
  };
}

export function renderWriteSummary(state: PactProviderWriteState): string {
  const readinessClaim = state.writeOutcome === 'written'
    ? 'Scaffold was written or extended and is ready for the next verification attempt.'
    : state.writeOutcome === 'partial'
      ? 'Only partial scaffold/remediation was written; verification is not ready to be claimed complete.'
      : state.writeOutcome === 'blocked'
        ? 'No provider verification scaffold was written because the plan remained blocked.'
        : 'No Pact provider verification scaffold was written because the plan verdict was irrelevant.';

  return [
    '# Pact provider write summary',
    '',
    'This file is only a concise summary. Canonical machine-readable write state lives in JSON under `.oma/packs/oh-my-pactgpb/state/shared/write/`.',
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
    '### Files planned and changed',
    `- Files planned: ${state.filesPlanned.join(', ') || '(none)'}`,
    `- Files written: ${state.filesWritten.join(', ') || '(none)'}`,
    `- Files modified: ${state.filesModified.join(', ') || '(none)'}`,
    `- Writes skipped: ${state.writesSkipped.map((entry) => `${entry.path} — ${entry.reason}`).join('; ') || '(none)'}`,
    '',
    '### Remaining gaps',
    `- Unresolved blockers: ${state.unresolvedBlockers.join('; ') || '(none)'}`,
    `- Manual follow-ups: ${state.manualFollowUps.join('; ') || '(none)'}`,
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
