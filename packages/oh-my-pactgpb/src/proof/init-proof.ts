import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { scanPactProviderRepo, type ProviderConfidence } from './scan-proof.js';

export type PactInitVerdict =
  | 'init-completed'
  | 'init-not-justified'
  | 'insufficient-boundary-evidence'
  | 'existing-pact-evidence-detected';

export interface PactProviderInitState {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  verdict: PactInitVerdict;
  providerCandidate: {
    name: string | null;
    reason: string;
    confidence: ProviderConfidence;
    ambiguities: string[];
    controllerGroups: string[];
  };
  httpSurface: {
    controllers: string[];
    requestMappings: string[];
    openApiEvidence: string[];
    dtoEvidence: string[];
    integrationTestPriorArt: string[];
  };
  existingPactEvidence: {
    detected: boolean;
    pactDependencies: string[];
    providerVerificationTests: string[];
    pactFiles: string[];
    brokerConfigHints: string[];
    providerStates: string[];
  };
  initJustification: {
    verdict: 'justified' | 'not-justified' | 'insufficient-evidence' | 'redirect-existing-pact';
    reasons: string[];
    blockers: string[];
  };
  bootstrapPlan: {
    allowed: boolean;
    dependencyTargets: string[];
    testTargetPath: string | null;
    providerStateSkeletons: string[];
    plannedWrites: string[];
    notes: string[];
  };
  writesPerformed: {
    filesWritten: string[];
    filesModified: string[];
    writesSkipped: Array<{
      path: string;
      reason: string;
    }>;
  };
  remainingBlockers: string[];
  recommendedNextStep: string;
  expectedFollowUpCommand: string | null;
  notes: string[];
}

export interface ProofInitArtifacts {
  state: PactProviderInitState;
  statePath: string;
  summaryPath: string;
}

interface OpenApiSignal {
  file: string;
  title: string | null;
  pathCount: number;
}

interface MappingHit {
  relativePath: string;
  method: string;
  fullPath: string;
}

interface BootstrapWritePlan {
  targetPath: string | null;
  filesWritten: string[];
  filesModified: string[];
  writesSkipped: PactProviderInitState['writesPerformed']['writesSkipped'];
}

const INSTALLED_INIT_CONTRACT_RELATIVE_PATH = path.join(
  '.oma',
  'packs',
  'oh-my-pactgpb',
  'templates',
  'init',
  'state-contract.json',
);

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build']);
const INTERNAL_SURFACE_SEGMENTS = ['/internal', '/admin', '/actuator'];

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function walkFiles(rootDir: string, currentDir: string = rootDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      files.push(...walkFiles(rootDir, path.join(currentDir, entry.name)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.join(currentDir, entry.name));
    }
  }

  return files;
}

function readTextIfUseful(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.xml', '.gradle', '.kts', '.properties', '.yml', '.yaml', '.java', '.kt', '.json', '.md', '.txt'].includes(ext)) {
    return null;
  }

  return readFileSync(filePath, 'utf8');
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function normalizeHttpPath(value: string): string {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  if (normalized.length === 0) {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function joinHttpPaths(basePath: string, methodPath: string): string {
  const combined = `${basePath === '/' ? '' : basePath}${methodPath === '/' ? '' : methodPath}`;
  return combined.length === 0 ? '/' : combined.replace(/\/+/g, '/');
}

function extractFirstMappingValue(content: string, annotation: string): string | null {
  const patterns = [
    new RegExp(`@${annotation}\\((?:[^)]*?value\\s*=\\s*)?"([^"]+)"`, 'm'),
    new RegExp(`@${annotation}\\((?:[^)]*?path\\s*=\\s*)?"([^"]+)"`, 'm'),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return normalizeHttpPath(match[1]);
    }
  }

  return null;
}

function extractControllerMappings(relativePath: string, content: string): MappingHit[] {
  const basePath = extractFirstMappingValue(content, 'RequestMapping') ?? '/';
  const hits: MappingHit[] = [];
  const annotationPairs: Array<[annotation: string, method: string]> = [
    ['GetMapping', 'GET'],
    ['PostMapping', 'POST'],
    ['PutMapping', 'PUT'],
    ['DeleteMapping', 'DELETE'],
    ['PatchMapping', 'PATCH'],
  ];

  for (const [annotation, method] of annotationPairs) {
    const pattern = new RegExp(`@${annotation}\\((?:[^)]*?(?:value|path)\\s*=\\s*)?"([^"]+)"`, 'g');
    for (const match of content.matchAll(pattern)) {
      const value = match[1];
      if (!value) {
        continue;
      }

      hits.push({
        relativePath,
        method,
        fullPath: joinHttpPaths(basePath, normalizeHttpPath(value)),
      });
    }
  }

  if (hits.length === 0 && basePath !== '/') {
    hits.push({
      relativePath,
      method: 'REQUEST',
      fullPath: basePath,
    });
  }

  return hits;
}

function deriveControllerGroup(relativePath: string): string | null {
  const normalized = toPosixPath(relativePath);
  const prefixes = ['src/main/java/', 'src/main/kotlin/'];
  const sourcePrefix = prefixes.find((prefix) => normalized.startsWith(prefix));
  if (!sourcePrefix) {
    return null;
  }

  const remainder = normalized.slice(sourcePrefix.length);
  const segments = remainder.split('/');
  const apiIndex = segments.indexOf('api');
  if (apiIndex > 0) {
    return segments[apiIndex - 1] ?? null;
  }

  if (segments.length >= 2) {
    return segments[segments.length - 2] ?? null;
  }

  return null;
}

function detectOpenApiSignals(projectRoot: string): OpenApiSignal[] {
  const signals: OpenApiSignal[] = [];

  for (const absolutePath of walkFiles(projectRoot)) {
    const relativePath = toPosixPath(path.relative(projectRoot, absolutePath));
    const baseName = path.basename(relativePath).toLowerCase();
    const content = readTextIfUseful(absolutePath);
    if (!content) {
      continue;
    }

    const looksLikeOpenApiFile = baseName.includes('openapi') || baseName.includes('swagger');
    const looksLikeOpenApiContent = /(^|\n)openapi:\s*[0-9]/m.test(content) || /"openapi"\s*:\s*"[0-9]/m.test(content);

    if (!looksLikeOpenApiFile && !looksLikeOpenApiContent) {
      continue;
    }

    const yamlTitle = content.match(/(^|\n)info:\s*[\s\S]*?\n\s*title:\s*([^\n#]+)/m)?.[2] ?? null;
    const jsonTitle = content.match(/"title"\s*:\s*"([^"]+)"/)?.[1] ?? null;
    const title = stripQuotes(yamlTitle ?? jsonTitle ?? '');
    const pathCount = (content.match(/(^|\n)\s{2,}\/[^:\n]+:\s*$/gm) ?? []).length || (content.match(/"\/[^\"]+"\s*:/g) ?? []).length;

    signals.push({
      file: relativePath,
      title: title.length > 0 ? title : null,
      pathCount,
    });
  }

  return signals;
}

function renderOpenApiEvidence(signals: readonly OpenApiSignal[]): string[] {
  return uniqueSorted(
    signals.map((signal) => `${signal.file}${signal.title ? `#title=${signal.title}` : ''}${signal.pathCount > 0 ? `#paths=${signal.pathCount}` : ''}`),
  );
}

function detectControllerMappings(projectRoot: string, controllerFiles: readonly string[]): MappingHit[] {
  const hits: MappingHit[] = [];

  for (const relativePath of controllerFiles) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    hits.push(...extractControllerMappings(relativePath, readFileSync(absolutePath, 'utf8')));
  }

  return hits;
}

function mappingEvidence(hits: readonly MappingHit[]): string[] {
  return uniqueSorted(hits.map((hit) => `${hit.relativePath}#${hit.method} ${hit.fullPath}`));
}

function hasOnlyInternalMappings(hits: readonly MappingHit[]): boolean {
  if (hits.length === 0) {
    return false;
  }

  return hits.every((hit) => INTERNAL_SURFACE_SEGMENTS.some((segment) => hit.fullPath.startsWith(segment)));
}

function existingPactDetected(scanState: ReturnType<typeof scanPactProviderRepo>): boolean {
  return scanState.verificationEvidence.pactDependencies.length > 0
    || scanState.verificationEvidence.providerVerificationTests.length > 0
    || scanState.verificationEvidence.localPactFiles.length > 0
    || scanState.verificationEvidence.brokerConfigHints.length > 0
    || scanState.providerStates.stateAnnotations.length > 0;
}

function pickProviderName(
  scanState: ReturnType<typeof scanPactProviderRepo>,
  controllerGroups: readonly string[],
  openApiSignals: readonly OpenApiSignal[],
): { name: string | null; reason: string; confidence: ProviderConfidence; ambiguities: string[] } {
  if (controllerGroups.length > 1) {
    return {
      name: null,
      reason: `Multiple provider boundaries remain plausible from the controller layout: ${controllerGroups.join(', ')}.`,
      confidence: 'low',
      ambiguities: controllerGroups.map((group) => `Controller group candidate: ${group}.`),
    };
  }

  if (scanState.provider.name) {
    return {
      name: scanState.provider.name,
      reason: 'Spring application or build metadata already points to a single provider candidate.',
      confidence: controllerGroups.length === 1 ? 'high' : scanState.provider.confidence,
      ambiguities: [],
    };
  }

  if (controllerGroups.length === 1) {
    const group = controllerGroups[0]!;
    return {
      name: `${group}-provider`,
      reason: `A single controller group was detected under the HTTP surface: ${group}.`,
      confidence: 'medium',
      ambiguities: [],
    };
  }

  if (openApiSignals.length === 1 && openApiSignals[0]?.title) {
    const normalizedTitle = openApiSignals[0].title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return {
      name: normalizedTitle.length > 0 ? normalizedTitle : null,
      reason: `Only one OpenAPI document was found and it names a single service candidate: ${openApiSignals[0].title}.`,
      confidence: normalizedTitle.length > 0 ? 'low' : 'low',
      ambiguities: [],
    };
  }

  return {
    name: null,
    reason: 'No single provider boundary could be derived confidently from the current repo evidence.',
    confidence: 'low',
    ambiguities: ['No single controller group or provider name signal could be selected honestly.'],
  };
}

function determineBootstrapVerdict(
  scanState: ReturnType<typeof scanPactProviderRepo>,
  providerCandidate: ReturnType<typeof pickProviderName>,
  controllerMappings: readonly MappingHit[],
  openApiSignals: readonly OpenApiSignal[],
): { verdict: PactInitVerdict; justificationVerdict: PactProviderInitState['initJustification']['verdict']; reasons: string[]; blockers: string[] } {
  if (existingPactDetected(scanState)) {
    return {
      verdict: 'existing-pact-evidence-detected',
      justificationVerdict: 'redirect-existing-pact',
      reasons: ['Meaningful Pact provider evidence already exists, so init should not create a second bootstrap path.'],
      blockers: ['Existing Pact evidence already places this repo on the verification track.'],
    };
  }

  if (providerCandidate.ambiguities.length > 0) {
    return {
      verdict: 'insufficient-boundary-evidence',
      justificationVerdict: 'insufficient-evidence',
      reasons: ['The repo does not point to one provider boundary strongly enough to bootstrap safely.'],
      blockers: providerCandidate.ambiguities,
    };
  }

  if (scanState.httpSurface.controllerFiles.length === 0) {
    return {
      verdict: openApiSignals.length > 0 ? 'init-not-justified' : 'insufficient-boundary-evidence',
      justificationVerdict: openApiSignals.length > 0 ? 'not-justified' : 'insufficient-evidence',
      reasons: openApiSignals.length > 0
        ? ['OpenAPI evidence exists, but code-backed Spring controller seams were not found, so bootstrap would be too speculative.']
        : ['No meaningful external HTTP contract surface was found in the repo.'],
      blockers: ['No Spring controller surface was detected for provider-side HTTP contract verification.'],
    };
  }

  if (hasOnlyInternalMappings(controllerMappings)) {
    return {
      verdict: 'init-not-justified',
      justificationVerdict: 'not-justified',
      reasons: ['The detected HTTP surface looks internal/admin-oriented rather than a stable external provider contract.'],
      blockers: ['Detected request mappings are internal/admin-only, so Pact would add weak value right now.'],
    };
  }

  if (!providerCandidate.name) {
    return {
      verdict: 'insufficient-boundary-evidence',
      justificationVerdict: 'insufficient-evidence',
      reasons: ['A provider candidate could not be named honestly from the repo evidence.'],
      blockers: ['No provider candidate could be named confidently enough for bootstrap.'],
    };
  }

  return {
    verdict: 'init-completed',
    justificationVerdict: 'justified',
    reasons: uniqueSorted([
      `A single provider candidate can be named: ${providerCandidate.name}.`,
      scanState.httpSurface.controllerFiles.length > 0
        ? 'Spring controller evidence exists for an external HTTP surface.'
        : '',
      scanState.verificationEvidence.integrationTestPriorArt.length > 0
        ? 'Integration-test prior art exists and can anchor the bootstrap harness.'
        : '',
      openApiSignals.length > 0
        ? 'OpenAPI strengthens the candidate HTTP contract surface.'
        : '',
    ].filter((value) => value.length > 0)),
    blockers: uniqueSorted([
      'Bootstrap prepares provider-side verification only; Pact artifacts and full interaction grounding still need the normal verification track.',
      scanState.providerStates.stateAnnotations.length === 0
        ? 'Concrete provider state names are still unknown and must be added later.'
        : '',
    ].filter((value) => value.length > 0)),
  };
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

  return `${normalized || 'Provider'}PactInitTest`;
}

function deriveNewProviderTestPath(controllerPath: string | undefined, providerName: string | null): string | null {
  if (!controllerPath || !providerName) {
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
  return `src/test/java/${contractPackagePath}/${toJavaClassName(providerName)}.java`;
}

function renderProviderVerificationTest(packageName: string, providerName: string, stateNames: readonly string[]): string {
  const stateMethods = stateNames.length > 0
    ? `\n\n${stateNames.map((stateName) => [
      `  @State("${stateName}")`,
      `  void ${toJavaMethodName(stateName)}() {`,
      '  }',
    ].join('\n')).join('\n\n')}`
    : '\n\n  // Manual follow-up: add concrete @State handlers once interaction state names are known.';

  return [
    `package ${packageName};`,
    '',
    'import au.com.dius.pact.provider.junitsupport.Provider;',
    'import au.com.dius.pact.provider.junitsupport.State;',
    'import au.com.dius.pact.provider.junitsupport.loader.PactFolder;',
    'import au.com.dius.pact.provider.junitsupport.target.HttpTestTarget;',
    'import au.com.dius.pact.provider.junit5.PactVerificationContext;',
    'import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider;',
    'import org.junit.jupiter.api.BeforeEach;',
    'import org.junit.jupiter.api.TestTemplate;',
    'import org.junit.jupiter.api.extension.ExtendWith;',
    'import org.springframework.boot.test.context.SpringBootTest;',
    '',
    `@Provider("${providerName}")`,
    '@PactFolder("src/test/resources/pacts")',
    '@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)',
    `class ${toJavaClassName(providerName)} {`,
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
    '',
    '  // Bootstrap note: this harness prepares provider-side verification only.',
    '  // Add local pact files or broker-backed retrieval before expecting runnable verification.',
    stateMethods,
    '}',
    '',
  ].join('\n');
}

function ensurePomDependency(content: string, dependencyBlock: string): string {
  if (content.includes(dependencyBlock)) {
    return content;
  }

  if (!content.includes('</dependencies>')) {
    return content;
  }

  return content.replace('</dependencies>', `${dependencyBlock}\n  </dependencies>`);
}

function maybePatchPom(projectRoot: string, filesModified: string[]): void {
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
    filesModified.push('pom.xml');
  }
}

function applyBootstrapWrites(
  projectRoot: string,
  verdict: PactInitVerdict,
  providerName: string | null,
  controllerFiles: readonly string[],
  providerStates: readonly string[],
): BootstrapWritePlan {
  const writesSkipped: PactProviderInitState['writesPerformed']['writesSkipped'] = [];
  const filesWritten: string[] = [];
  const filesModified: string[] = [];

  if (verdict !== 'init-completed' || !providerName) {
    writesSkipped.push({
      path: 'provider-bootstrap',
      reason: 'Init did not complete, so bootstrap writes were skipped intentionally.',
    });
    return {
      targetPath: null,
      filesWritten,
      filesModified,
      writesSkipped,
    };
  }

  const targetPath = deriveNewProviderTestPath(controllerFiles[0], providerName);
  if (!targetPath) {
    writesSkipped.push({
      path: 'provider-bootstrap',
      reason: 'No safe provider verification test target path could be derived from the controller surface.',
    });
    return {
      targetPath: null,
      filesWritten,
      filesModified,
      writesSkipped,
    };
  }

  const absoluteTargetPath = path.join(projectRoot, targetPath);
  mkdirSync(path.dirname(absoluteTargetPath), { recursive: true });

  const packageName = targetPath
    .replace(/^src\/test\/java\//, '')
    .replace(/\/[^/]+$/, '')
    .split('/')
    .join('.');

  writeFileSync(absoluteTargetPath, renderProviderVerificationTest(packageName, providerName, providerStates), 'utf8');
  filesWritten.push(targetPath);
  maybePatchPom(projectRoot, filesModified);

  return {
    targetPath,
    filesWritten: uniqueSorted(filesWritten),
    filesModified: uniqueSorted(filesModified),
    writesSkipped,
  };
}

function renderInitSummary(state: PactProviderInitState): string {
  return [
    '# Pact provider init summary',
    '',
    'This file is only a concise summary. Canonical machine-readable init state lives in JSON under `.oma/packs/oh-my-pactgpb/state/shared/init/`.',
    '',
    '## Canonical JSON files',
    '',
    '- `init-state.json`',
    '',
    '## Summary',
    '',
    '### Outcome',
    `- Init verdict: ${state.verdict}`,
    `- Recommended next step: ${state.recommendedNextStep}`,
    `- Expected follow-up command: ${state.expectedFollowUpCommand ?? '(none)'}`,
    '',
    '### Provider boundary',
    `- Provider candidate: ${state.providerCandidate.name ?? '(unclear)'}`,
    `- Confidence: ${state.providerCandidate.confidence}`,
    `- Why this boundary is the best fit: ${state.providerCandidate.reason}`,
    `- Ambiguities: ${state.providerCandidate.ambiguities.join('; ') || '(none)'}`,
    '',
    '### HTTP contract surface',
    `- Controllers: ${state.httpSurface.controllers.join(', ') || '(none)'}`,
    `- Request mappings: ${state.httpSurface.requestMappings.join(', ') || '(none)'}`,
    `- OpenAPI evidence: ${state.httpSurface.openApiEvidence.join(', ') || '(none)'}`,
    `- DTO / payload evidence: ${state.httpSurface.dtoEvidence.join(', ') || '(none)'}`,
    '',
    '### Existing Pact evidence check',
    `- Pact dependencies: ${state.existingPactEvidence.pactDependencies.join(', ') || '(none)'}`,
    `- Provider verification tests: ${state.existingPactEvidence.providerVerificationTests.join(', ') || '(none)'}`,
    `- Pact files: ${state.existingPactEvidence.pactFiles.join(', ') || '(none)'}`,
    `- Broker config hints: ${state.existingPactEvidence.brokerConfigHints.join(', ') || '(none)'}`,
    `- Provider state hooks: ${state.existingPactEvidence.providerStates.join(', ') || '(none)'}`,
    '',
    '### Bootstrap decision',
    `- Why init is justified or not: ${state.initJustification.reasons.join('; ') || '(none)'}`,
    `- Planned bootstrap writes: ${state.bootstrapPlan.plannedWrites.join(', ') || '(none)'}`,
    `- Writes performed: ${[...state.writesPerformed.filesWritten, ...state.writesPerformed.filesModified].join(', ') || '(none)'}`,
    '',
    '### Remaining blockers',
    ...(state.remainingBlockers.length > 0 ? state.remainingBlockers.map((entry) => `- ${entry}`) : ['- None.']),
    '',
    '### Notes',
    ...(state.notes.length > 0 ? state.notes.map((entry) => `- ${entry}`) : ['- None.']),
    '',
  ].join('\n');
}

export function deriveInitState(projectRoot: string): PactProviderInitState {
  const scanState = scanPactProviderRepo(projectRoot);
  const openApiSignals = detectOpenApiSignals(projectRoot);
  const controllerGroups = uniqueSorted(
    scanState.httpSurface.controllerFiles
      .map((file) => deriveControllerGroup(file))
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const controllerMappings = detectControllerMappings(projectRoot, scanState.httpSurface.controllerFiles);
  const providerCandidate = pickProviderName(scanState, controllerGroups, openApiSignals);
  const bootstrapDecision = determineBootstrapVerdict(scanState, providerCandidate, controllerMappings, openApiSignals);
  const writePlan = applyBootstrapWrites(
    projectRoot,
    bootstrapDecision.verdict,
    providerCandidate.name,
    scanState.httpSurface.controllerFiles,
    scanState.providerStates.stateAnnotations,
  );

  const plannedWrites = uniqueSorted([
    writePlan.targetPath ?? '',
    existsSync(path.join(projectRoot, 'pom.xml')) ? 'pom.xml' : '',
  ].filter((value) => value.length > 0));

  const notes = uniqueSorted([
    bootstrapDecision.verdict === 'init-completed'
      ? 'Bootstrap prepares provider-side Pact verification only; it does not prove that verification is already runnable or passing.'
      : '',
    bootstrapDecision.verdict === 'existing-pact-evidence-detected'
      ? 'Init stopped because the repo already belongs on the normal verification track.'
      : '',
    bootstrapDecision.verdict === 'init-not-justified'
      ? 'Init stopped intentionally instead of scaffolding a low-value or internal-only contract surface.'
      : '',
    bootstrapDecision.verdict === 'insufficient-boundary-evidence'
      ? 'Init stopped because the provider boundary would have been a guess.'
      : '',
    writePlan.targetPath
      ? `Bootstrap test harness written to ${writePlan.targetPath}.`
      : '',
  ].filter((value) => value.length > 0));

  const recommendedNextStep = bootstrapDecision.verdict === 'init-completed'
    ? 'Continue on the normal verification track, starting with `/pact-scan` to persist grounded Pact evidence after bootstrap.'
    : bootstrapDecision.verdict === 'existing-pact-evidence-detected'
      ? 'Use `/pact-scan` instead of `/pact-init` so the existing Pact evidence drives the normal verification track.'
      : 'Do not scaffold further until the recorded blocker or justification is resolved.';

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    verdict: bootstrapDecision.verdict,
    providerCandidate: {
      name: providerCandidate.name,
      reason: providerCandidate.reason,
      confidence: providerCandidate.confidence,
      ambiguities: providerCandidate.ambiguities,
      controllerGroups,
    },
    httpSurface: {
      controllers: uniqueSorted(scanState.httpSurface.controllerFiles),
      requestMappings: mappingEvidence(controllerMappings),
      openApiEvidence: renderOpenApiEvidence(openApiSignals),
      dtoEvidence: uniqueSorted(scanState.httpSurface.dtoFiles),
      integrationTestPriorArt: uniqueSorted(scanState.verificationEvidence.integrationTestPriorArt),
    },
    existingPactEvidence: {
      detected: existingPactDetected(scanState),
      pactDependencies: uniqueSorted(scanState.verificationEvidence.pactDependencies),
      providerVerificationTests: uniqueSorted(scanState.verificationEvidence.providerVerificationTests),
      pactFiles: uniqueSorted(scanState.verificationEvidence.localPactFiles),
      brokerConfigHints: uniqueSorted(scanState.verificationEvidence.brokerConfigHints),
      providerStates: uniqueSorted(scanState.providerStates.stateAnnotations),
    },
    initJustification: {
      verdict: bootstrapDecision.justificationVerdict,
      reasons: uniqueSorted(bootstrapDecision.reasons),
      blockers: uniqueSorted(bootstrapDecision.blockers),
    },
    bootstrapPlan: {
      allowed: bootstrapDecision.verdict === 'init-completed',
      dependencyTargets: existsSync(path.join(projectRoot, 'pom.xml')) ? ['pom.xml'] : [],
      testTargetPath: writePlan.targetPath,
      providerStateSkeletons: uniqueSorted(scanState.providerStates.stateAnnotations),
      plannedWrites,
      notes: uniqueSorted([
        bootstrapDecision.verdict === 'init-completed'
          ? 'After bootstrap, move to `/pact-scan` instead of creating more init-specific state.'
          : '',
        scanState.providerStates.stateAnnotations.length === 0
          ? 'No concrete provider state names were available during init bootstrap.'
          : '',
      ].filter((value) => value.length > 0)),
    },
    writesPerformed: {
      filesWritten: writePlan.filesWritten,
      filesModified: writePlan.filesModified,
      writesSkipped: writePlan.writesSkipped,
    },
    remainingBlockers: uniqueSorted([
      ...bootstrapDecision.blockers,
      ...(bootstrapDecision.verdict === 'init-completed'
        ? ['Pact artifacts are still not grounded; use the normal verification track to determine local files or broker-backed inputs.']
        : []),
    ]),
    recommendedNextStep,
    expectedFollowUpCommand: bootstrapDecision.verdict === 'init-completed' || bootstrapDecision.verdict === 'existing-pact-evidence-detected'
      ? '/pact-scan'
      : null,
    notes,
  };
}

export function hasInstalledInitContract(projectRoot: string): boolean {
  const contractPath = path.join(projectRoot, INSTALLED_INIT_CONTRACT_RELATIVE_PATH);
  return existsSync(contractPath) && statSync(contractPath).isFile();
}

export function writeProofInitArtifacts(projectRoot: string): ProofInitArtifacts {
  const state = deriveInitState(projectRoot);
  const outputDir = path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'state', 'shared', 'init');
  mkdirSync(outputDir, { recursive: true });

  const statePath = path.join(outputDir, 'init-state.json');
  const summaryPath = path.join(outputDir, 'init-summary.md');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  writeFileSync(summaryPath, `${renderInitSummary(state).trimEnd()}\n`, 'utf8');

  return {
    state,
    statePath,
    summaryPath,
  };
}
