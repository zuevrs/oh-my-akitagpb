import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_SUBCOMMANDS = ['install', 'update', 'doctor'] as const;

export type SupportedSubcommand = (typeof SUPPORTED_SUBCOMMANDS)[number];

export interface PackageSurface {
  packageRoot: string;
  packageJsonPath: string;
  packageName: string;
  packageVersion: string;
  binRelativePath: string;
  binPath: string;
}

export interface AssetCatalog {
  packageRoot: string;
  assetsRoot: string;
  entries: Readonly<Record<string, string>>;
}

export interface CapabilityBundleReferences {
  capabilityContract: string;
  unsupportedCases: string;
  examples: string;
  provenance: string;
}

export interface CapabilityManifestBundle {
  bundleId: string;
  module: {
    id: string;
    pin: string;
  };
  skillPath: string;
  references: CapabilityBundleReferences;
}

export interface CapabilityManifest {
  schemaVersion: 1;
  activeCommandIds: string[];
  activeWorkflowSkills: string[];
  activeCapabilityBundles: CapabilityManifestBundle[];
}

export interface CapabilityBundleAssetFile {
  bundleId: string;
  runtimePath: string;
  assetRelativePath: string;
  assetAbsolutePath: string;
}

export class PackageSurfaceError extends Error {
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'PackageSurfaceError';
    this.code = code;
    this.details = details;
  }
}

const ASSET_ENTRIES = Object.freeze({
  'commands/pact-scan': 'commands/pact-scan.md',
  'commands/pact-plan': 'commands/pact-plan.md',
  'commands/pact-write': 'commands/pact-write.md',
  'opencode/skills/pact-scan-workflow': 'opencode/skills/pact-scan-workflow/SKILL.md',
  'opencode/skills/pact-plan-workflow': 'opencode/skills/pact-plan-workflow/SKILL.md',
  'opencode/skills/pact-write-workflow': 'opencode/skills/pact-write-workflow/SKILL.md',
  'oma/capability-manifest': 'oma/capability-manifest.json',
  'oma/runtime/shared/data-handling-policy': 'oma/runtime/shared/data-handling-policy.json',
  'oma/instructions/rules/manifest-first': 'oma/instructions/rules/manifest-first.md',
  'oma/instructions/rules/default-language-russian': 'oma/instructions/rules/default-language-russian.md',
  'oma/instructions/rules/never-invent-steps': 'oma/instructions/rules/never-invent-steps.md',
  'oma/instructions/rules/redact-shared-state': 'oma/instructions/rules/redact-shared-state.md',
  'oma/instructions/rules/prefer-existing-prior-art': 'oma/instructions/rules/prefer-existing-prior-art.md',
  'oma/instructions/rules/explicit-unsupported': 'oma/instructions/rules/explicit-unsupported.md',
  'oma/instructions/rules/respect-pack-ownership': 'oma/instructions/rules/respect-pack-ownership.md',
  'oma/templates/scan/state-contract': 'oma/templates/scan/state-contract.json',
  'oma/templates/scan/scan-summary': 'oma/templates/scan/scan-summary.md',
  'oma/templates/plan/state-contract': 'oma/templates/plan/state-contract.json',
  'oma/templates/plan/plan-summary': 'oma/templates/plan/plan-summary.md',
  'oma/templates/write/state-contract': 'oma/templates/write/state-contract.json',
  'oma/templates/write/write-summary': 'oma/templates/write/write-summary.md',
} satisfies Record<string, string>);

const CAPABILITY_BUNDLE_PREFIX = 'pact-capability-';
const CAPABILITY_BUNDLE_RUNTIME_ROOT = '.opencode/skills';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function createManifestError(message: string, details?: Record<string, string>): PackageSurfaceError {
  return new PackageSurfaceError('capability-manifest-invalid', message, details);
}

function assertCapabilityBundleRuntimePath(bundleId: string, runtimePath: string, field: string, filename: string): void {
  const expectedPath = `${CAPABILITY_BUNDLE_RUNTIME_ROOT}/${bundleId}/${filename}`;
  if (runtimePath !== expectedPath) {
    throw createManifestError('The capability manifest contains a stale or unexpected runtime path.', {
      bundleId,
      field,
      runtimePath,
      expectedPath,
    });
  }

  if (path.posix.normalize(runtimePath) !== runtimePath || runtimePath.includes('..')) {
    throw createManifestError('The capability manifest contains a non-normalized runtime path.', {
      bundleId,
      field,
      runtimePath,
    });
  }

  if (!runtimePath.startsWith(`${CAPABILITY_BUNDLE_RUNTIME_ROOT}/${CAPABILITY_BUNDLE_PREFIX}`)) {
    throw createManifestError('The capability manifest points outside the pack-owned capability namespace.', {
      bundleId,
      field,
      runtimePath,
    });
  }
}

function parseCapabilityManifest(rawManifest: unknown, manifestPath: string): CapabilityManifest {
  if (!isRecord(rawManifest)) {
    throw createManifestError('The capability manifest must contain an object.', {
      manifestPath,
    });
  }

  const { schemaVersion, activeCommandIds, activeWorkflowSkills, activeCapabilityBundles } = rawManifest;

  if (
    schemaVersion !== 1 ||
    !isStringArray(activeCommandIds) ||
    !isStringArray(activeWorkflowSkills) ||
    !Array.isArray(activeCapabilityBundles)
  ) {
    throw createManifestError('The capability manifest is missing required fields.', {
      manifestPath,
    });
  }

  const seenBundleIds = new Set<string>();
  const bundles: CapabilityManifestBundle[] = activeCapabilityBundles.map((entry, index) => {
    if (!isRecord(entry)) {
      throw createManifestError('The capability manifest contains a non-object bundle entry.', {
        manifestPath,
        entryIndex: String(index),
      });
    }

    const { bundleId, module, skillPath, references } = entry;
    if (
      typeof bundleId !== 'string' ||
      !bundleId.startsWith(CAPABILITY_BUNDLE_PREFIX) ||
      !isRecord(module) ||
      typeof module.id !== 'string' ||
      typeof module.pin !== 'string' ||
      typeof skillPath !== 'string' ||
      !isRecord(references) ||
      typeof references.capabilityContract !== 'string' ||
      typeof references.unsupportedCases !== 'string' ||
      typeof references.examples !== 'string' ||
      typeof references.provenance !== 'string'
    ) {
      throw createManifestError('The capability manifest contains an invalid bundle entry.', {
        manifestPath,
        entryIndex: String(index),
      });
    }

    if (seenBundleIds.has(bundleId)) {
      throw createManifestError('The capability manifest contains duplicate bundle ids.', {
        manifestPath,
        bundleId,
      });
    }
    seenBundleIds.add(bundleId);

    assertCapabilityBundleRuntimePath(bundleId, skillPath, 'skillPath', 'SKILL.md');
    assertCapabilityBundleRuntimePath(bundleId, references.capabilityContract, 'references.capabilityContract', 'references/capability-contract.json');
    assertCapabilityBundleRuntimePath(bundleId, references.unsupportedCases, 'references.unsupportedCases', 'references/unsupported-cases.json');
    assertCapabilityBundleRuntimePath(bundleId, references.examples, 'references.examples', 'references/examples.json');
    assertCapabilityBundleRuntimePath(bundleId, references.provenance, 'references.provenance', 'references/provenance.json');

    return {
      bundleId,
      module: {
        id: module.id,
        pin: module.pin,
      },
      skillPath,
      references: {
        capabilityContract: references.capabilityContract,
        unsupportedCases: references.unsupportedCases,
        examples: references.examples,
        provenance: references.provenance,
      },
    };
  });

  return {
    schemaVersion: 1,
    activeCommandIds,
    activeWorkflowSkills,
    activeCapabilityBundles: bundles,
  };
}

function resolveCapabilityRuntimePath(catalog: AssetCatalog, bundleId: string, runtimePath: string): CapabilityBundleAssetFile {
  const assetRelativePath = runtimePath.slice(1);
  const assetAbsolutePath = path.resolve(catalog.assetsRoot, assetRelativePath);

  if (!existsSync(assetAbsolutePath)) {
    throw new PackageSurfaceError('asset-file-missing', 'A capability manifest entry points to a missing shipped asset.', {
      bundleId,
      runtimePath,
      assetPath: assetAbsolutePath,
    });
  }

  return {
    bundleId,
    runtimePath,
    assetRelativePath,
    assetAbsolutePath,
  };
}

export function resolvePackageRoot(moduleUrl: string = import.meta.url): string {
  const modulePath = fileURLToPath(moduleUrl);
  return path.resolve(path.dirname(modulePath), '..', '..');
}

export function readPackageSurface(packageRoot: string = resolvePackageRoot()): PackageSurface {
  const packageJsonPath = path.join(packageRoot, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new PackageSurfaceError('package-metadata-missing', 'The package.json file is missing.', {
      packageJsonPath,
    });
  }

  const rawJson = readFileSync(packageJsonPath, 'utf8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new PackageSurfaceError('package-metadata-invalid', 'The package.json file is not valid JSON.', {
      packageJsonPath,
      cause: error instanceof Error ? error.message : 'unknown parse failure',
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new PackageSurfaceError('package-metadata-invalid', 'The package.json file must contain an object.', {
      packageJsonPath,
    });
  }

  const packageJson = parsed as Record<string, unknown>;
  const packageName = typeof packageJson.name === 'string' ? packageJson.name : undefined;
  const packageVersion = typeof packageJson.version === 'string' ? packageJson.version : undefined;
  const binField = packageJson.bin;

  if (!packageName) {
    throw new PackageSurfaceError('package-name-missing', 'The package.json file must declare a package name.', {
      packageJsonPath,
    });
  }

  if (!packageVersion) {
    throw new PackageSurfaceError('package-version-missing', 'The package.json file must declare a version.', {
      packageJsonPath,
    });
  }

  const binRecord = binField && typeof binField === 'object' ? (binField as Record<string, unknown>) : undefined;
  const namespacedBinPath = typeof binRecord?.['oh-my-pactgpb'] === 'string' ? binRecord['oh-my-pactgpb'] : undefined;
  const binRelativePath = typeof binField === 'string' ? binField : namespacedBinPath;

  if (!binRelativePath) {
    throw new PackageSurfaceError(
      'package-bin-missing',
      'The package.json file must expose the oh-my-pactgpb bin entry.',
      { packageJsonPath },
    );
  }

  return {
    packageRoot,
    packageJsonPath,
    packageName,
    packageVersion,
    binRelativePath,
    binPath: path.resolve(packageRoot, binRelativePath),
  };
}

export function assertBuildSurface(surface: PackageSurface): PackageSurface {
  if (!existsSync(surface.binPath)) {
    throw new PackageSurfaceError('build-output-missing', 'The compiled CLI entrypoint is missing. Run the build first.', {
      binPath: surface.binPath,
    });
  }

  return surface;
}

export function createAssetCatalog(packageRoot: string = resolvePackageRoot()): AssetCatalog {
  return {
    packageRoot,
    assetsRoot: path.join(packageRoot, 'assets'),
    entries: ASSET_ENTRIES,
  };
}

export function getAssetEntry(catalog: AssetCatalog, key: string): string {
  const relativePath = catalog.entries[key];

  if (!relativePath) {
    throw new PackageSurfaceError('asset-catalog-missing-entry', `Asset catalog entry "${key}" is not defined.`, {
      key,
      assetsRoot: catalog.assetsRoot,
    });
  }

  const absolutePath = path.resolve(catalog.assetsRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new PackageSurfaceError('asset-file-missing', `Asset catalog entry "${key}" is missing on disk.`, {
      key,
      assetPath: absolutePath,
    });
  }

  return absolutePath;
}

export function readCapabilityManifest(catalog: AssetCatalog): CapabilityManifest {
  const manifestPath = getAssetEntry(catalog, 'oma/capability-manifest');

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw createManifestError('The capability manifest is not valid JSON.', {
      manifestPath,
      cause: error instanceof Error ? error.message : 'unknown parse failure',
    });
  }

  return parseCapabilityManifest(parsed, manifestPath);
}

export function resolveCapabilityBundleAssetFiles(catalog: AssetCatalog): CapabilityBundleAssetFile[] {
  const manifest = readCapabilityManifest(catalog);
  const seenRuntimePaths = new Set<string>();
  const bundleAssetFiles: CapabilityBundleAssetFile[] = [];

  for (const bundle of manifest.activeCapabilityBundles) {
    const runtimePaths = [
      bundle.skillPath,
      bundle.references.capabilityContract,
      bundle.references.unsupportedCases,
      bundle.references.examples,
      bundle.references.provenance,
    ];

    for (const runtimePath of runtimePaths) {
      if (seenRuntimePaths.has(runtimePath)) {
        throw createManifestError('The capability manifest contains duplicate runtime paths.', {
          bundleId: bundle.bundleId,
          runtimePath,
        });
      }
      seenRuntimePaths.add(runtimePath);
      bundleAssetFiles.push(resolveCapabilityRuntimePath(catalog, bundle.bundleId, runtimePath));
    }
  }

  return bundleAssetFiles;
}
