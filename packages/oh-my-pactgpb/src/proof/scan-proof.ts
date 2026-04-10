import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type RelevanceVerdict = 'relevant' | 'irrelevant' | 'needs-review';
export type ArtifactSourceVerdict = 'local' | 'broker' | 'unclear';
export type ProviderConfidence = 'high' | 'medium' | 'low';

export interface PactProviderScanState {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  provider: {
    name: string | null;
    confidence: ProviderConfidence;
    evidence: string[];
  };
  relevance: {
    verdict: RelevanceVerdict;
    because: string[];
  };
  artifactSource: {
    verdict: ArtifactSourceVerdict;
    evidence: string[];
  };
  verificationEvidence: {
    pactDependencies: string[];
    providerVerificationTests: string[];
    localPactFiles: string[];
    brokerConfigHints: string[];
    integrationTestPriorArt: string[];
  };
  providerStates: {
    stateAnnotations: string[];
    stateMethodFiles: string[];
    missingStateSupport: boolean;
  };
  httpSurface: {
    controllerFiles: string[];
    requestMappings: string[];
    dtoFiles: string[];
  };
  gaps: string[];
}

export interface ProofScanArtifacts {
  state: PactProviderScanState;
  statePath: string;
  summaryPath: string;
}

const IGNORED_DIRS = new Set(['.git', '.oma', '.opencode', 'node_modules', 'target', 'dist', 'build']);

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

    if (!entry.isFile()) {
      continue;
    }

    files.push(path.join(currentDir, entry.name));
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

function collectRegexMatches(content: string, pattern: RegExp): string[] {
  const values: string[] = [];
  for (const match of content.matchAll(pattern)) {
    const value = match[1];
    if (typeof value === 'string' && value.length > 0) {
      values.push(value);
    }
  }
  return values;
}

function detectPomArtifactId(content: string): string | null {
  const match = content.match(/<artifactId>([^<]+)<\/artifactId>/);
  return match?.[1]?.trim() ?? null;
}

function detectSpringApplicationName(content: string): string | null {
  const yamlMatch = content.match(/spring:\s*[\s\S]*?application:\s*[\s\S]*?name:\s*([^\n#]+)/m);
  if (yamlMatch?.[1]) {
    return yamlMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }

  const propertiesMatch = content.match(/spring\.application\.name\s*=\s*(.+)/);
  return propertiesMatch?.[1]?.trim() ?? null;
}

export function scanPactProviderRepo(projectRoot: string): PactProviderScanState {
  const pactDependencies: string[] = [];
  const providerVerificationTests: string[] = [];
  const localPactFiles: string[] = [];
  const brokerConfigHints: string[] = [];
  const integrationTestPriorArt: string[] = [];
  const stateAnnotations = new Set<string>();
  const stateMethodFiles = new Set<string>();
  const controllerFiles = new Set<string>();
  const requestMappings = new Set<string>();
  const dtoFiles = new Set<string>();
  const providerNames = new Set<string>();
  const providerEvidence: string[] = [];
  const fallbackProviderNames = new Set<string>();

  for (const absolutePath of walkFiles(projectRoot)) {
    const relativePath = toPosixPath(path.relative(projectRoot, absolutePath));

    if (relativePath.includes('/pacts/') && relativePath.endsWith('.json')) {
      localPactFiles.push(relativePath);
    }

    const content = readTextIfUseful(absolutePath);
    if (content === null) {
      continue;
    }

    const lowerContent = content.toLowerCase();
    const isPom = path.basename(relativePath) === 'pom.xml';
    const isGradle = relativePath.endsWith('.gradle') || relativePath.endsWith('.gradle.kts');
    const isJavaFile = relativePath.endsWith('.java') || relativePath.endsWith('.kt');

    if ((isPom || isGradle) && /au\.com\.dius\.pact\.provider|pact-jvm-provider|junit5spring/i.test(content)) {
      pactDependencies.push(relativePath);
    }

    if (/@PactBroker|pactbroker|PACT_BROKER|pact\.broker|pactbroker\.|brokerUrl/i.test(content)) {
      brokerConfigHints.push(relativePath);
    }

    if (isPom) {
      const artifactId = detectPomArtifactId(content);
      if (artifactId) {
        fallbackProviderNames.add(artifactId);
        providerEvidence.push(`${relativePath}#artifactId=${artifactId}`);
      }
    }

    if (relativePath.endsWith('.yml') || relativePath.endsWith('.yaml') || relativePath.endsWith('.properties')) {
      const applicationName = detectSpringApplicationName(content);
      if (applicationName) {
        fallbackProviderNames.add(applicationName);
        providerEvidence.push(`${relativePath}#spring.application.name=${applicationName}`);
      }
    }

    if (isJavaFile) {
      for (const providerName of collectRegexMatches(content, /@Provider\("([^"]+)"\)/g)) {
        providerNames.add(providerName);
        providerEvidence.push(`${relativePath}#@Provider(${providerName})`);
      }

      for (const stateName of collectRegexMatches(content, /@State\("([^"]+)"\)/g)) {
        stateAnnotations.add(stateName);
        stateMethodFiles.add(relativePath);
      }

      if (/@Provider\(|PactVerificationContext|@PactBroker|@PactFolder\(/.test(content)) {
        providerVerificationTests.push(relativePath);
      }

      if ((/@SpringBootTest|MockMvc|WebTestClient/.test(content)) && !/@Provider\(/.test(content)) {
        integrationTestPriorArt.push(relativePath);
      }

      if (/@RestController|@Controller/.test(content)) {
        controllerFiles.add(relativePath);
      }

      for (const mapping of collectRegexMatches(content, /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\("([^"]+)"\)/g)) {
        requestMappings.add(`${relativePath}#${mapping}`);
      }

      const lowerPath = relativePath.toLowerCase();
      if (lowerPath.includes('/dto/') || /(request|response|dto)\.(java|kt)$/i.test(lowerPath) || /@JsonProperty/.test(content)) {
        dtoFiles.add(relativePath);
      }
    }

    if (lowerContent.includes('spring-boot-starter-web') && isGradle) {
      providerEvidence.push(`${relativePath}#spring-web`);
    }
  }

  const pactDependencyHits = uniqueSorted(pactDependencies);
  const providerTestHits = uniqueSorted(providerVerificationTests);
  const localPactHits = uniqueSorted(localPactFiles);
  const brokerHintHits = uniqueSorted(brokerConfigHints);
  const priorArtHits = uniqueSorted(integrationTestPriorArt);
  const providerStateNames = uniqueSorted(stateAnnotations);
  const providerStateFiles = uniqueSorted(stateMethodFiles);
  const controllerHits = uniqueSorted(controllerFiles);
  const requestMappingHits = uniqueSorted(requestMappings);
  const dtoHits = uniqueSorted(dtoFiles);

  let providerName: string | null = null;
  let providerConfidence: ProviderConfidence = 'low';
  const distinctProviderNames = uniqueSorted(providerNames);
  const distinctFallbackNames = uniqueSorted(fallbackProviderNames);

  if (distinctProviderNames.length === 1) {
    providerName = distinctProviderNames[0] ?? null;
    providerConfidence = 'high';
  } else if (distinctProviderNames.length > 1) {
    providerConfidence = 'low';
  } else if (distinctFallbackNames.length > 0) {
    providerName = distinctFallbackNames[0] ?? null;
    providerConfidence = 'medium';
  }

  const artifactSourceVerdict: ArtifactSourceVerdict = localPactHits.length > 0 ? 'local' : brokerHintHits.length > 0 ? 'broker' : 'unclear';

  const relevanceReasons: string[] = [];
  let relevanceVerdict: RelevanceVerdict = 'irrelevant';

  if (pactDependencyHits.length > 0) {
    relevanceReasons.push('Pact provider dependencies are declared in build files.');
  }
  if (providerTestHits.length > 0) {
    relevanceReasons.push('Provider verification test classes are present.');
  }
  if (providerStateNames.length > 0) {
    relevanceReasons.push('Provider state hooks are already implemented.');
  }
  if (localPactHits.length > 0) {
    relevanceReasons.push('Local pact files are present in the repo.');
  }
  if (brokerHintHits.length > 0) {
    relevanceReasons.push('Broker-related Pact configuration is present.');
  }

  if (relevanceReasons.length > 0) {
    relevanceVerdict = 'relevant';
  } else if (controllerHits.length > 0) {
    relevanceReasons.push('Spring HTTP provider code exists, but Pact-specific evidence was not found.');
  } else {
    relevanceReasons.push('No Java/Spring HTTP provider verification evidence was detected.');
  }

  const gaps: string[] = [];
  if (distinctProviderNames.length > 1) {
    gaps.push(`Provider under contract is ambiguous: ${distinctProviderNames.join(', ')}.`);
    relevanceVerdict = 'needs-review';
  }
  if (!providerName) {
    gaps.push('No confident provider under contract could be identified.');
  }
  if (artifactSourceVerdict === 'unclear' && relevanceVerdict !== 'irrelevant') {
    gaps.push('Pact artifact source is unclear: no local pact files or broker-related config were detected.');
  }
  if (providerTestHits.length === 0 && relevanceVerdict !== 'irrelevant') {
    gaps.push('No existing Pact provider verification test class was detected.');
  }
  if (providerStateNames.length === 0 && relevanceVerdict !== 'irrelevant') {
    gaps.push('No provider state hooks were detected.');
  }
  if (controllerHits.length === 0 && relevanceVerdict !== 'irrelevant') {
    gaps.push('No Spring controller surface was detected for HTTP verification.');
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    provider: {
      name: providerName,
      confidence: providerConfidence,
      evidence: uniqueSorted(providerEvidence),
    },
    relevance: {
      verdict: relevanceVerdict,
      because: uniqueSorted(relevanceReasons),
    },
    artifactSource: {
      verdict: artifactSourceVerdict,
      evidence: artifactSourceVerdict === 'local' ? localPactHits : brokerHintHits,
    },
    verificationEvidence: {
      pactDependencies: pactDependencyHits,
      providerVerificationTests: providerTestHits,
      localPactFiles: localPactHits,
      brokerConfigHints: brokerHintHits,
      integrationTestPriorArt: priorArtHits,
    },
    providerStates: {
      stateAnnotations: providerStateNames,
      stateMethodFiles: providerStateFiles,
      missingStateSupport: providerStateNames.length === 0,
    },
    httpSurface: {
      controllerFiles: controllerHits,
      requestMappings: requestMappingHits,
      dtoFiles: dtoHits,
    },
    gaps: uniqueSorted(gaps),
  };
}

export function renderScanSummary(state: PactProviderScanState): string {
  return [
    '# Pact provider scan summary',
    '',
    'This file is only a concise summary. Canonical machine-readable scan state lives in JSON under `.oma/packs/oh-my-pactgpb/state/shared/scan/`.',
    '',
    '## Canonical JSON files',
    '',
    '- `scan-state.json`',
    '',
    '## Summary',
    '',
    '### Provider under contract',
    `- Provider candidate: ${state.provider.name ?? '(unclear)'}`,
    `- Why this provider is the best fit: ${state.provider.evidence.join('; ') || '(no direct provider evidence)'}`,
    `- Pact relevance verdict: ${state.relevance.verdict}`,
    '',
    '### Verification evidence found',
    `- Build dependencies (Maven/Gradle): ${state.verificationEvidence.pactDependencies.join(', ') || '(none)'}`,
    `- Provider verification tests/annotations: ${state.verificationEvidence.providerVerificationTests.join(', ') || '(none)'}`,
    `- Existing verification setup: ${state.verificationEvidence.providerVerificationTests.length > 0 ? 'present' : 'not detected'}`,
    `- Prior-art integration tests worth reusing: ${state.verificationEvidence.integrationTestPriorArt.join(', ') || '(none)'}`,
    '',
    '### Pact artifact source',
    `- Local pact files: ${state.verificationEvidence.localPactFiles.join(', ') || '(none)'}`,
    `- Broker-related config/env/properties/scripts: ${state.verificationEvidence.brokerConfigHints.join(', ') || '(none)'}`,
    `- Expected artifact source verdict: ${state.artifactSource.verdict}`,
    '',
    '### Provider state readiness',
    `- Existing provider state hooks: ${state.providerStates.stateAnnotations.join(', ') || '(none)'}`,
    `- State setup fixtures/helpers: ${state.providerStates.stateMethodFiles.join(', ') || '(none)'}`,
    `- Notable gaps: ${state.gaps.filter((gap) => gap.toLowerCase().includes('state')).join('; ') || '(none)'}`,
    '',
    '### HTTP provider surface',
    `- Controllers / request mappings: ${(state.httpSurface.controllerFiles.length > 0 ? state.httpSurface.controllerFiles : ['(none)']).join(', ')}`,
    `- DTOs / serializers / payload models: ${state.httpSurface.dtoFiles.join(', ') || '(none)'}`,
    `- Notes on likely contract surface: ${state.httpSurface.requestMappings.join(', ') || '(none)'}`,
    '',
    '### Main blockers',
    ...(state.gaps.length > 0 ? state.gaps.map((gap) => `- ${gap}`) : ['- None.']),
    '',
    '### Why Pact is relevant or not',
    ...(state.relevance.because.map((reason) => `- ${reason}`)),
    '',
  ].join('\n');
}

export function writeProofScanArtifacts(projectRoot: string): ProofScanArtifacts {
  const state = scanPactProviderRepo(projectRoot);
  const outputDir = path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'state', 'shared', 'scan');
  mkdirSync(outputDir, { recursive: true });

  const statePath = path.join(outputDir, 'scan-state.json');
  const summaryPath = path.join(outputDir, 'scan-summary.md');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  writeFileSync(summaryPath, `${renderScanSummary(state).trimEnd()}\n`, 'utf8');

  return {
    state,
    statePath,
    summaryPath,
  };
}

export function hasInstalledScanContract(projectRoot: string): boolean {
  return existsSync(path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json')) &&
    statSync(path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json')).isFile();
}
