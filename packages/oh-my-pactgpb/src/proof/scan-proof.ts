import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type RelevanceVerdict = 'relevant' | 'irrelevant' | 'needs-review';
export type ArtifactSourceVerdict = 'local' | 'broker' | 'unclear';
export type ProviderConfidence = 'high' | 'medium' | 'low';
export type CoverageConfidence = 'high' | 'medium' | 'low';
export type VerificationTargetArtifactBinding = 'local' | 'broker' | 'unresolved';
export type EndpointCoverageStatus = 'covered' | 'covered-with-gaps' | 'unverified' | 'uncovered' | 'ambiguous';
export type InteractionCoverageStatus = 'covered' | 'state-gap' | 'unverified' | 'unmapped' | 'ambiguous';

export interface PactProviderVerificationTarget {
  id: string;
  file: string;
  providerName: string | null;
  artifactBinding: VerificationTargetArtifactBinding;
  bootstrapOnly: boolean;
  stateHandlers: string[];
  confidence: CoverageConfidence;
  notes: string[];
}

export interface PactProviderEndpointCoverage {
  id: string;
  method: string;
  path: string;
  sourceFile: string;
  matchedInteractionIds: string[];
  status: EndpointCoverageStatus;
  confidence: CoverageConfidence;
  notes: string[];
}

export interface PactProviderInteractionCoverage {
  id: string;
  sourceFile: string;
  providerName: string | null;
  consumerName: string | null;
  description: string;
  method: string | null;
  path: string | null;
  providerStates: string[];
  matchedEndpointIds: string[];
  status: InteractionCoverageStatus;
  confidence: CoverageConfidence;
  notes: string[];
}

export interface PactProviderCoverageModel {
  contractSurfaceInventory: {
    endpoints: PactProviderEndpointCoverage[];
    confidence: CoverageConfidence;
    notes: string[];
  };
  verificationTargets: PactProviderVerificationTarget[];
  interactionInventory: PactProviderInteractionCoverage[];
  stateInventory: {
    implemented: string[];
    referenced: string[];
    missing: string[];
    unreferenced: string[];
    notes: string[];
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
    ambiguousInteractions: string[];
    setupOnlyTargets: string[];
    recommendedNextSlice: string[];
  };
  ambiguityMarkers: string[];
}

export interface PactProviderScanState {
  schemaVersion: 2;
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
  coverageModel: PactProviderCoverageModel;
  gaps: string[];
}

export interface ProofScanArtifacts {
  state: PactProviderScanState;
  statePath: string;
  summaryPath: string;
}

interface MappingHit {
  relativePath: string;
  method: string;
  fullPath: string;
}

interface VerificationTargetDraft {
  file: string;
  providerName: string | null;
  artifactBinding: VerificationTargetArtifactBinding;
  bootstrapOnly: boolean;
  stateHandlers: string[];
  confidence: CoverageConfidence;
  notes: string[];
}

interface PactInteractionDraft {
  sourceFile: string;
  providerName: string | null;
  consumerName: string | null;
  description: string;
  method: string | null;
  path: string | null;
  providerStates: string[];
  notes: string[];
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

function normalizeHttpPath(value: string): string {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  if (normalized.length === 0) {
    return '/';
  }

  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/g, '') || '/';
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
    let annotationMatched = false;
    const withValuePattern = new RegExp(`@${annotation}\\((?:[^)]*?(?:value|path)\\s*=\\s*)?"([^"]+)"`, 'g');
    for (const match of content.matchAll(withValuePattern)) {
      const value = match[1];
      if (!value) {
        continue;
      }

      annotationMatched = true;
      hits.push({
        relativePath,
        method,
        fullPath: joinHttpPaths(basePath, normalizeHttpPath(value)),
      });
    }

    const bareAnnotationPattern = new RegExp(`@${annotation}(?:\\s*\\(\\s*\\))?(?!\\s*"|\\s*value\\s*=|\\s*path\\s*=)`, 'g');
    const bareMatches = content.match(bareAnnotationPattern) ?? [];
    if (!annotationMatched && bareMatches.length > 0) {
      hits.push({
        relativePath,
        method,
        fullPath: basePath,
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

function pathSegments(value: string): string[] {
  const normalized = normalizeHttpPath(value);
  if (normalized === '/') {
    return [];
  }

  return normalized.split('/').filter((segment) => segment.length > 0);
}

function endpointMatchesInteraction(endpointPath: string, interactionPath: string): boolean {
  const endpointSegments = pathSegments(endpointPath);
  const interactionSegments = pathSegments(interactionPath);

  if (endpointSegments.length !== interactionSegments.length) {
    return false;
  }

  for (let index = 0; index < endpointSegments.length; index += 1) {
    const endpointSegment = endpointSegments[index];
    const interactionSegment = interactionSegments[index];

    if (!endpointSegment || !interactionSegment) {
      return false;
    }

    const isVariableSegment = endpointSegment.startsWith('{') && endpointSegment.endsWith('}');
    if (isVariableSegment) {
      continue;
    }

    if (endpointSegment !== interactionSegment) {
      return false;
    }
  }

  return true;
}

function makeId(prefix: 'VT' | 'E' | 'I', index: number): string {
  return `${prefix}${String(index).padStart(2, '0')}`;
}

function toCoverageConfidence(status: EndpointCoverageStatus | InteractionCoverageStatus): CoverageConfidence {
  switch (status) {
    case 'covered':
      return 'high';
    case 'covered-with-gaps':
    case 'state-gap':
    case 'unverified':
      return 'medium';
    default:
      return 'low';
  }
}

function targetCoverageConfidence(target: VerificationTargetDraft): CoverageConfidence {
  if (target.bootstrapOnly || target.artifactBinding === 'unresolved') {
    return 'medium';
  }

  return 'high';
}

function deriveContractSurfaceConfidence(
  endpoints: readonly PactProviderEndpointCoverage[],
  interactions: readonly PactProviderInteractionCoverage[],
  ambiguityMarkers: readonly string[],
): CoverageConfidence {
  if (ambiguityMarkers.length > 0) {
    return 'low';
  }

  if (endpoints.length === 0) {
    return 'low';
  }

  if (interactions.some((interaction) => interaction.status === 'covered' || interaction.status === 'state-gap')) {
    return 'high';
  }

  return 'medium';
}

function summarizeCoverage(statuses: readonly PactProviderEndpointCoverage[], predicate: (status: PactProviderEndpointCoverage) => boolean): string[] {
  return statuses
    .filter(predicate)
    .map((endpoint) => `${endpoint.method} ${endpoint.path}`);
}

function summarizeInteractions(statuses: readonly PactProviderInteractionCoverage[], predicate: (status: PactProviderInteractionCoverage) => boolean): string[] {
  return statuses
    .filter(predicate)
    .map((interaction) => {
      const requestLabel = interaction.method && interaction.path ? `${interaction.method} ${interaction.path}` : interaction.description;
      return `${requestLabel} (${interaction.sourceFile})`;
    });
}

function buildCoverageRecommendations(
  artifactSourceVerdict: ArtifactSourceVerdict,
  verificationTargets: readonly PactProviderVerificationTarget[],
  uncoveredEndpoints: readonly string[],
  endpointsWithGaps: readonly string[],
  unverifiedEndpoints: readonly string[],
  missingStates: readonly string[],
  ambiguityMarkers: readonly string[],
): string[] {
  const recommendations: string[] = [];

  if (ambiguityMarkers.length > 0) {
    recommendations.push('Resolve provider binding ambiguity before claiming endpoint or interaction coverage.');
  }

  if (artifactSourceVerdict === 'broker') {
    recommendations.push('Clarify broker-backed pact retrieval before treating any provider surface as covered.');
  }

  if (artifactSourceVerdict === 'unclear') {
    recommendations.push('Ground the pact artifact source before claiming real interaction coverage.');
  }

  if (verificationTargets.some((target) => target.bootstrapOnly)) {
    recommendations.push('Bootstrap verification targets exist, but they do not prove any real covered interactions yet.');
  }

  if (missingStates.length > 0) {
    recommendations.push(`Add missing provider states: ${missingStates.join(', ')}.`);
  }

  if (endpointsWithGaps.length > 0) {
    recommendations.push(`Extend partially covered endpoints: ${endpointsWithGaps.join(', ')}.`);
  }

  if (unverifiedEndpoints.length > 0) {
    recommendations.push(`Connect interaction evidence to provider verification for: ${unverifiedEndpoints.join(', ')}.`);
  }

  if (uncoveredEndpoints.length > 0) {
    recommendations.push(`Add Pact coverage for uncovered endpoints: ${uncoveredEndpoints.join(', ')}.`);
  }

  return uniqueSorted(recommendations);
}

function buildVerificationTarget(
  relativePath: string,
  content: string,
  stateHandlers: readonly string[],
): VerificationTargetDraft {
  const providerNames = uniqueSorted(collectRegexMatches(content, /@Provider\("([^"]+)"\)/g));
  const artifactBinding: VerificationTargetArtifactBinding = /^\s*@PactFolder\(/m.test(content)
    ? 'local'
    : /^\s*@PactBroker\b/m.test(content)
      ? 'broker'
      : 'unresolved';
  const bootstrapOnly = artifactBinding === 'unresolved' && /Bootstrap note:|deterministic provider-side baseline only|artifact retrieval is intentionally unresolved/i.test(content);
  const notes: string[] = [];

  if (bootstrapOnly) {
    notes.push('Bootstrap-only provider verification target detected; it is setup evidence, not covered interaction evidence.');
  } else if (artifactBinding === 'unresolved') {
    notes.push('Provider verification target exists, but its pact artifact binding is unresolved in-file.');
  }

  if (stateHandlers.length === 0) {
    notes.push('No @State handlers were detected in this provider verification target.');
  }

  if (providerNames.length > 1) {
    notes.push(`Multiple @Provider values were detected in one verification target: ${providerNames.join(', ')}.`);
  }

  const target: VerificationTargetDraft = {
    file: relativePath,
    providerName: providerNames.length === 1 ? (providerNames[0] ?? null) : null,
    artifactBinding,
    bootstrapOnly,
    stateHandlers: uniqueSorted(stateHandlers),
    confidence: 'high',
    notes: uniqueSorted(notes),
  };

  target.confidence = targetCoverageConfidence(target);
  return target;
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
  const dtoFiles = new Set<string>();
  const controllerMappings: MappingHit[] = [];
  const providerEvidence: string[] = [];
  const explicitProviderNames = new Set<string>();
  const fallbackProviderNames = new Set<string>();
  const verificationTargetDrafts: VerificationTargetDraft[] = [];
  const interactionDrafts: PactInteractionDraft[] = [];
  const localPactParseIssues: string[] = [];
  const referencedStates = new Set<string>();

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

    const hasBrokerHint = isJavaFile
      ? /^\s*@PactBroker\b/m.test(content)
      : /pactbroker|PACT_BROKER|pact\.broker|pactbroker\.|brokerUrl/i.test(content);

    if (hasBrokerHint) {
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

    if (!isJavaFile) {
      if (lowerContent.includes('spring-boot-starter-web') && isGradle) {
        providerEvidence.push(`${relativePath}#spring-web`);
      }
      continue;
    }

    const stateHandlers = uniqueSorted(collectRegexMatches(content, /@State\("([^"]+)"\)/g));
    for (const stateName of stateHandlers) {
      stateAnnotations.add(stateName);
      stateMethodFiles.add(relativePath);
    }

    const providerNames = uniqueSorted(collectRegexMatches(content, /@Provider\("([^"]+)"\)/g));
    for (const providerName of providerNames) {
      explicitProviderNames.add(providerName);
      providerEvidence.push(`${relativePath}#@Provider(${providerName})`);
    }

    const isProviderVerificationTarget = /@Provider\(|PactVerificationContext|verifyInteraction\(|PactVerificationInvocationContextProvider/.test(content);
    if (isProviderVerificationTarget) {
      providerVerificationTests.push(relativePath);
      verificationTargetDrafts.push(buildVerificationTarget(relativePath, content, stateHandlers));
    }

    if ((/@SpringBootTest|MockMvc|WebTestClient/.test(content)) && !isProviderVerificationTarget) {
      integrationTestPriorArt.push(relativePath);
    }

    if (/@RestController|@Controller/.test(content)) {
      controllerFiles.add(relativePath);
      controllerMappings.push(...extractControllerMappings(relativePath, content));
    }

    const lowerPath = relativePath.toLowerCase();
    if (lowerPath.includes('/dto/') || /(request|response|dto)\.(java|kt)$/i.test(lowerPath) || /@JsonProperty/.test(content)) {
      dtoFiles.add(relativePath);
    }
  }

  for (const relativePath of uniqueSorted(localPactFiles)) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as {
        provider?: { name?: string };
        consumer?: { name?: string };
        interactions?: Array<{
          description?: string;
          request?: { method?: string; path?: string };
          providerStates?: Array<{ name?: string }>;
        }>;
      };

      const pactProviderName = typeof parsed.provider?.name === 'string' && parsed.provider.name.trim().length > 0
        ? parsed.provider.name.trim()
        : null;
      const pactConsumerName = typeof parsed.consumer?.name === 'string' && parsed.consumer.name.trim().length > 0
        ? parsed.consumer.name.trim()
        : null;

      if (pactProviderName) {
        explicitProviderNames.add(pactProviderName);
        providerEvidence.push(`${relativePath}#pact.provider=${pactProviderName}`);
      }

      const interactions = Array.isArray(parsed.interactions) ? parsed.interactions : [];
      if (interactions.length === 0) {
        localPactParseIssues.push(`No interactions were found in local pact file ${relativePath}.`);
      }

      for (const interaction of interactions) {
        const providerStates = uniqueSorted(
          (interaction.providerStates ?? [])
            .map((state) => state.name?.trim() ?? '')
            .filter((stateName) => stateName.length > 0),
        );

        for (const stateName of providerStates) {
          referencedStates.add(stateName);
        }

        interactionDrafts.push({
          sourceFile: relativePath,
          providerName: pactProviderName,
          consumerName: pactConsumerName,
          description: interaction.description?.trim() || 'unnamed interaction',
          method: typeof interaction.request?.method === 'string' ? interaction.request.method.trim().toUpperCase() : null,
          path: typeof interaction.request?.path === 'string' ? normalizeHttpPath(interaction.request.path) : null,
          providerStates,
          notes: [],
        });
      }
    } catch (error) {
      localPactParseIssues.push(`Local pact file could not be parsed: ${relativePath} (${error instanceof Error ? error.message : 'unknown parse failure'}).`);
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
  const dtoHits = uniqueSorted(dtoFiles);
  const requestMappingHits = uniqueSorted(controllerMappings.map((hit) => `${hit.relativePath}#${hit.method} ${hit.fullPath}`));
  const distinctExplicitProviderNames = uniqueSorted(explicitProviderNames);
  const distinctFallbackNames = uniqueSorted(fallbackProviderNames);
  const ambiguityMarkers: string[] = [];

  let providerName: string | null = null;
  let providerConfidence: ProviderConfidence = 'low';

  if (distinctExplicitProviderNames.length === 1) {
    providerName = distinctExplicitProviderNames[0] ?? null;
    providerConfidence = 'high';
  } else if (distinctExplicitProviderNames.length > 1) {
    ambiguityMarkers.push(`Provider under contract is ambiguous: ${distinctExplicitProviderNames.join(', ')}.`);
  } else if (distinctFallbackNames.length > 0) {
    providerName = distinctFallbackNames[0] ?? null;
    providerConfidence = 'medium';
  }

  const verificationTargets = verificationTargetDrafts
    .slice()
    .sort((left, right) => left.file.localeCompare(right.file))
    .map((target, index) => ({
      id: makeId('VT', index + 1),
      ...target,
    }));

  const endpoints = controllerMappings
    .slice()
    .sort((left, right) => `${left.method} ${left.fullPath} ${left.relativePath}`.localeCompare(`${right.method} ${right.fullPath} ${right.relativePath}`))
    .map((hit, index) => ({
      id: makeId('E', index + 1),
      method: hit.method,
      path: hit.fullPath,
      sourceFile: hit.relativePath,
    }));

  const interactions = interactionDrafts
    .slice()
    .sort((left, right) => `${left.sourceFile} ${left.method ?? ''} ${left.path ?? ''} ${left.description}`.localeCompare(`${right.sourceFile} ${right.method ?? ''} ${right.path ?? ''} ${right.description}`))
    .map((draft, index) => ({
      id: makeId('I', index + 1),
      ...draft,
    }));

  const implementedStates = providerStateNames;
  const referencedStateNames = uniqueSorted(referencedStates);
  const missingStateNames = referencedStateNames.filter((stateName) => !implementedStates.includes(stateName));
  const unreferencedStateNames = implementedStates.filter((stateName) => !referencedStateNames.includes(stateName));

  const interactionInventory: PactProviderInteractionCoverage[] = interactions.map((interaction) => {
    const matchedEndpointIds = interaction.method && interaction.path
      ? endpoints
        .filter((endpoint) => endpoint.method === interaction.method && endpointMatchesInteraction(endpoint.path, interaction.path ?? '/'))
        .map((endpoint) => endpoint.id)
      : [];

    const targetCandidates = verificationTargets.filter((target) => {
      if (interaction.providerName && target.providerName) {
        return interaction.providerName === target.providerName;
      }

      return true;
    });

    const notes = [...interaction.notes];
    let status: InteractionCoverageStatus;

    if (!interaction.method || !interaction.path) {
      status = 'unmapped';
      notes.push('Interaction request method/path could not be read, so endpoint coverage could not be matched.');
    } else if (matchedEndpointIds.length > 1) {
      status = 'ambiguous';
      notes.push(`Interaction matched multiple provider endpoints: ${matchedEndpointIds.join(', ')}.`);
    } else if (matchedEndpointIds.length === 0) {
      status = 'unmapped';
      notes.push('Interaction did not map cleanly to a detected Spring controller endpoint.');
    } else if (targetCandidates.length === 0) {
      status = 'unverified';
      notes.push('Local pact interaction exists, but no matching provider verification target was detected.');
    } else if (interaction.providerStates.some((stateName) => missingStateNames.includes(stateName))) {
      status = 'state-gap';
      notes.push(`Interaction references missing provider states: ${interaction.providerStates.filter((stateName) => missingStateNames.includes(stateName)).join(', ')}.`);
    } else {
      status = 'covered';
      notes.push(`Interaction maps cleanly to provider endpoint ${matchedEndpointIds[0] ?? '(unknown)'}.`);
    }

    return {
      id: interaction.id,
      sourceFile: interaction.sourceFile,
      providerName: interaction.providerName,
      consumerName: interaction.consumerName,
      description: interaction.description,
      method: interaction.method,
      path: interaction.path,
      providerStates: interaction.providerStates,
      matchedEndpointIds,
      status,
      confidence: toCoverageConfidence(status),
      notes: uniqueSorted(notes),
    };
  });

  const endpointInventory: PactProviderEndpointCoverage[] = endpoints.map((endpoint) => {
    const matchedInteractions = interactionInventory.filter((interaction) => interaction.matchedEndpointIds.includes(endpoint.id));
    const matchedStatuses = matchedInteractions.map((interaction) => interaction.status);
    const notes: string[] = [];
    let status: EndpointCoverageStatus;

    if (matchedInteractions.length === 0) {
      status = 'uncovered';
      if (localPactHits.length === 0) {
        notes.push('No grounded local pact interactions were detected for this endpoint yet.');
      } else {
        notes.push('No local pact interaction mapped to this endpoint.');
      }
    } else if (matchedStatuses.includes('ambiguous')) {
      status = 'ambiguous';
      notes.push('At least one mapped interaction remained ambiguous across multiple endpoints.');
    } else if (matchedStatuses.includes('state-gap')) {
      status = 'covered-with-gaps';
      notes.push('At least one mapped interaction is blocked by missing provider-state support.');
    } else if (matchedStatuses.includes('unverified')) {
      status = 'unverified';
      notes.push('Interaction evidence exists for this endpoint, but runnable provider verification was not detected.');
    } else {
      status = 'covered';
      notes.push('At least one mapped interaction is already represented by existing provider verification evidence.');
    }

    return {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      sourceFile: endpoint.sourceFile,
      matchedInteractionIds: matchedInteractions.map((interaction) => interaction.id),
      status,
      confidence: toCoverageConfidence(status),
      notes: uniqueSorted(notes),
    };
  });

  const artifactSourceVerdict: ArtifactSourceVerdict = localPactHits.length > 0
    ? 'local'
    : brokerHintHits.length > 0 || verificationTargets.some((target) => target.artifactBinding === 'broker')
      ? 'broker'
      : 'unclear';
  const artifactSourceEvidence = artifactSourceVerdict === 'local'
    ? localPactHits
    : artifactSourceVerdict === 'broker'
      ? uniqueSorted([
        ...brokerHintHits,
        ...verificationTargets
          .filter((target) => target.artifactBinding === 'broker')
          .map((target) => `${target.file}#@PactBroker`),
      ])
      : [];

  const relevanceReasons: string[] = [];
  let relevanceVerdict: RelevanceVerdict = 'irrelevant';

  if (pactDependencyHits.length > 0) {
    relevanceReasons.push('Pact provider dependencies are declared in build files.');
  }
  if (providerTestHits.length > 0) {
    relevanceReasons.push('Provider verification targets are present in test sources.');
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

  if (ambiguityMarkers.length > 0) {
    relevanceVerdict = 'needs-review';
  }

  const coveredEndpoints = summarizeCoverage(endpointInventory, (endpoint) => endpoint.status === 'covered');
  const endpointsWithGaps = summarizeCoverage(endpointInventory, (endpoint) => endpoint.status === 'covered-with-gaps');
  const unverifiedEndpoints = summarizeCoverage(endpointInventory, (endpoint) => endpoint.status === 'unverified');
  const uncoveredEndpoints = summarizeCoverage(endpointInventory, (endpoint) => endpoint.status === 'uncovered');
  const ambiguousEndpoints = summarizeCoverage(endpointInventory, (endpoint) => endpoint.status === 'ambiguous');

  const coveredInteractions = summarizeInteractions(interactionInventory, (interaction) => interaction.status === 'covered');
  const interactionStateGaps = summarizeInteractions(interactionInventory, (interaction) => interaction.status === 'state-gap');
  const unverifiedInteractions = summarizeInteractions(interactionInventory, (interaction) => interaction.status === 'unverified');
  const unmappedInteractions = summarizeInteractions(interactionInventory, (interaction) => interaction.status === 'unmapped');
  const ambiguousInteractions = summarizeInteractions(interactionInventory, (interaction) => interaction.status === 'ambiguous');
  const setupOnlyTargets = verificationTargets
    .filter((target) => target.bootstrapOnly || target.artifactBinding === 'unresolved')
    .map((target) => `${target.file}${target.bootstrapOnly ? ' (bootstrap-only)' : ' (artifact binding unresolved)'}`);

  const coverageModel: PactProviderCoverageModel = {
    contractSurfaceInventory: {
      endpoints: endpointInventory,
      confidence: deriveContractSurfaceConfidence(endpointInventory, interactionInventory, ambiguityMarkers),
      notes: uniqueSorted([
        endpointInventory.length > 0
          ? `Detected ${endpointInventory.length} Spring HTTP endpoint candidate(s) from controller mappings.`
          : 'No Spring controller mappings were detected.',
        localPactHits.length > 0
          ? 'Coverage uses grounded local pact interaction inventory.'
          : 'Coverage uses provider HTTP surface only because no grounded local pact interactions were found.',
      ]),
    },
    verificationTargets,
    interactionInventory,
    stateInventory: {
      implemented: implementedStates,
      referenced: referencedStateNames,
      missing: missingStateNames,
      unreferenced: unreferencedStateNames,
      notes: uniqueSorted([
        missingStateNames.length > 0
          ? `Missing provider states were referenced by pact interactions: ${missingStateNames.join(', ')}.`
          : 'No missing provider-state names were detected from local pact interactions.',
        unreferencedStateNames.length > 0 && localPactHits.length > 0
          ? `Some implemented provider states were not referenced by the current local pact interactions: ${unreferencedStateNames.join(', ')}.`
          : '',
        implementedStates.length > 0 && localPactHits.length === 0
          ? 'Provider state handlers exist, but no grounded local pact interactions were available to confirm whether they are still needed.'
          : '',
      ].filter((value) => value.length > 0)),
    },
    coverageSummary: {
      coveredEndpoints,
      endpointsWithGaps,
      unverifiedEndpoints,
      uncoveredEndpoints,
      ambiguousEndpoints,
      coveredInteractions,
      interactionStateGaps,
      unverifiedInteractions,
      unmappedInteractions,
      ambiguousInteractions,
      setupOnlyTargets,
      recommendedNextSlice: buildCoverageRecommendations(
        artifactSourceVerdict,
        verificationTargets,
        uncoveredEndpoints,
        endpointsWithGaps,
        unverifiedEndpoints,
        missingStateNames,
        ambiguityMarkers,
      ),
    },
    ambiguityMarkers: uniqueSorted(ambiguityMarkers),
  };

  const gaps: string[] = [];
  if (ambiguityMarkers.length > 0) {
    gaps.push(...ambiguityMarkers);
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
  if (verificationTargets.some((target) => target.bootstrapOnly) && localPactHits.length === 0) {
    gaps.push('Bootstrap provider verification exists, but no grounded pact interactions were detected yet.');
  }
  if (providerStateNames.length === 0 && relevanceVerdict !== 'irrelevant') {
    gaps.push('No provider state hooks were detected.');
  }
  if (missingStateNames.length > 0) {
    gaps.push(`Missing provider state coverage: ${missingStateNames.join(', ')}.`);
  }
  if (controllerHits.length === 0 && relevanceVerdict !== 'irrelevant') {
    gaps.push('No Spring controller surface was detected for HTTP verification.');
  }
  if (uncoveredEndpoints.length > 0) {
    gaps.push(`Likely uncovered provider endpoints: ${uncoveredEndpoints.join(', ')}.`);
  }
  if (unverifiedEndpoints.length > 0) {
    gaps.push(`Contract interactions exist without grounded provider verification for: ${unverifiedEndpoints.join(', ')}.`);
  }
  if (ambiguousEndpoints.length > 0) {
    gaps.push(`Endpoint coverage remained ambiguous for: ${ambiguousEndpoints.join(', ')}.`);
  }
  if (unmappedInteractions.length > 0) {
    gaps.push(`Some pact interactions could not be mapped to the detected Spring HTTP surface: ${unmappedInteractions.join(', ')}.`);
  }
  gaps.push(...localPactParseIssues);

  return {
    schemaVersion: 2,
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
      evidence: artifactSourceEvidence,
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
      missingStateSupport: providerStateNames.length === 0 || missingStateNames.length > 0,
    },
    httpSurface: {
      controllerFiles: controllerHits,
      requestMappings: requestMappingHits,
      dtoFiles: dtoHits,
    },
    coverageModel,
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
    `- Provider confidence: ${state.provider.confidence}`,
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
    '### Coverage snapshot',
    `- Covered endpoints: ${state.coverageModel.coverageSummary.coveredEndpoints.join(', ') || '(none)'}`,
    `- Endpoints with gaps: ${state.coverageModel.coverageSummary.endpointsWithGaps.join(', ') || '(none)'}`,
    `- Unverified endpoints: ${state.coverageModel.coverageSummary.unverifiedEndpoints.join(', ') || '(none)'}`,
    `- Uncovered endpoints: ${state.coverageModel.coverageSummary.uncoveredEndpoints.join(', ') || '(none)'}`,
    `- Covered interactions: ${state.coverageModel.coverageSummary.coveredInteractions.join(', ') || '(none)'}`,
    `- Interaction state gaps: ${state.coverageModel.coverageSummary.interactionStateGaps.join(', ') || '(none)'}`,
    `- Unmapped interactions: ${state.coverageModel.coverageSummary.unmappedInteractions.join(', ') || '(none)'}`,
    `- Setup-only verification targets: ${state.coverageModel.coverageSummary.setupOnlyTargets.join(', ') || '(none)'}`,
    '',
    '### Provider state readiness',
    `- Existing provider state hooks: ${state.providerStates.stateAnnotations.join(', ') || '(none)'}`,
    `- Referenced provider states: ${state.coverageModel.stateInventory.referenced.join(', ') || '(none)'}`,
    `- Missing provider states: ${state.coverageModel.stateInventory.missing.join(', ') || '(none)'}`,
    `- State setup fixtures/helpers: ${state.providerStates.stateMethodFiles.join(', ') || '(none)'}`,
    '',
    '### HTTP provider surface',
    `- Controllers / request mappings: ${(state.httpSurface.controllerFiles.length > 0 ? state.httpSurface.controllerFiles : ['(none)']).join(', ')}`,
    `- Request mapping inventory: ${state.httpSurface.requestMappings.join(', ') || '(none)'}`,
    `- DTOs / serializers / payload models: ${state.httpSurface.dtoFiles.join(', ') || '(none)'}`,
    '',
    '### Main blockers',
    ...(state.gaps.length > 0 ? state.gaps.map((gap) => `- ${gap}`) : ['- None.']),
    '',
    '### Next concrete slice',
    ...(state.coverageModel.coverageSummary.recommendedNextSlice.length > 0
      ? state.coverageModel.coverageSummary.recommendedNextSlice.map((entry) => `- ${entry}`)
      : ['- None.']),
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
