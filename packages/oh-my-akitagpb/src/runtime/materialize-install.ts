import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  type AssetCatalog,
  getAssetEntry,
  type PackageSurface,
  PackageSurfaceError,
  resolveCapabilityBundleAssetFiles,
} from './asset-catalog.js';
import { applyManagedGitignoreBlock } from './gitignore-block.js';
import {
  applyManagedAgentsBlock,
  applyManagedOpencodeConfig,
  hashContent,
  type ManagedSurfaceWriteResult,
} from './managed-blocks.js';
import {
  DATA_HANDLING_POLICY_RELATIVE_PATH,
  PACK_RUNTIME_ROOT,
  PROJECT_MODE_RELATIVE_PATH,
  VERSION_RELATIVE_PATH,
} from './layout.js';
import { type ManagedSurfaceRecord, type OwnedFileRecord } from './install-state.js';
import { createProjectModeRecord, readProjectModeRecord, type ProjectModeClassification } from './project-mode.js';

export interface PlannedFile {
  relativePath: string;
  content: string;
  generatedBy: 'asset' | 'runtime';
  assetKey?: string;
}

export interface MaterializedInstall {
  ownedFiles: readonly OwnedFileRecord[];
  managedSurfaces: readonly ManagedSurfaceRecord[];
}

export const COMMAND_IDS = ['akita-scan', 'akita-plan', 'akita-write', 'akita-validate', 'akita-promote'] as const;
export const WORKFLOW_SKILL_IDS = [
  'akita-scan-workflow',
  'akita-plan-workflow',
  'akita-write-workflow',
  'akita-validate-workflow',
  'akita-promote-workflow',
] as const;
export const MANAGED_INSTRUCTION_PATHS = [
  'AGENTS.md',
  `${PACK_RUNTIME_ROOT}/instructions/rules/manifest-first.md`,
  `${PACK_RUNTIME_ROOT}/instructions/rules/default-language-russian.md`,
  `${PACK_RUNTIME_ROOT}/instructions/rules/never-invent-steps.md`,
  `${PACK_RUNTIME_ROOT}/instructions/rules/redact-shared-state.md`,
  `${PACK_RUNTIME_ROOT}/instructions/rules/prefer-existing-prior-art.md`,
  `${PACK_RUNTIME_ROOT}/instructions/rules/explicit-unsupported.md`,
  `${PACK_RUNTIME_ROOT}/instructions/rules/respect-pack-ownership.md`,
] as const;

const PACK_OWNED_ASSET_KEYS = [
  'oma/capability-manifest',
  'oma/runtime/shared/data-handling-policy',
  'oma/instructions/rules/manifest-first',
  'oma/instructions/rules/default-language-russian',
  'oma/instructions/rules/never-invent-steps',
  'oma/instructions/rules/redact-shared-state',
  'oma/instructions/rules/prefer-existing-prior-art',
  'oma/instructions/rules/explicit-unsupported',
  'oma/instructions/rules/respect-pack-ownership',
  'oma/templates/feature/README',
  'oma/templates/feature/default',
  'oma/templates/feature/with-background',
  'oma/templates/feature/with-omissions-note',
  'oma/templates/payload/README',
  'oma/templates/payload/json-body',
  'oma/templates/payload/property-file',
  'oma/templates/payload/minimal-fixture',
  'oma/templates/scan/state-contract',
  'oma/templates/scan/scan-summary',
  'oma/templates/plan/state-contract',
  'oma/templates/plan/plan-summary',
  'oma/templates/write/state-contract',
  'oma/templates/write/write-summary',
  'oma/templates/validate/state-contract',
  'oma/templates/validate/validate-summary',
  'oma/templates/promote/state-contract',
  'oma/templates/promote/promote-summary',
] as const;

function assertPathIsNotSymlink(targetPath: string, code: string, message: string): void {
  if (!existsSync(targetPath)) {
    return;
  }

  if (lstatSync(targetPath).isSymbolicLink()) {
    throw new PackageSurfaceError(code, message, {
      path: targetPath,
    });
  }
}

function loadAssetText(catalog: AssetCatalog, assetKey: string): string {
  return readFileSync(getAssetEntry(catalog, assetKey), 'utf8');
}

function runtimeRelativePathFromAssetKey(catalog: AssetCatalog, assetKey: string): string {
  const assetRelativePath = catalog.entries[assetKey];
  if (!assetRelativePath || !assetRelativePath.startsWith('oma/')) {
    throw new PackageSurfaceError('asset-catalog-missing-entry', 'Pack-owned asset key did not resolve to an oma asset path.', {
      assetKey,
      assetRelativePath: assetRelativePath ?? '(missing)',
    });
  }

  return `${PACK_RUNTIME_ROOT}/${assetRelativePath.slice('oma/'.length)}`;
}

function planPackOwnedAssetFiles(catalog: AssetCatalog): PlannedFile[] {
  return PACK_OWNED_ASSET_KEYS.map((assetKey) => ({
    relativePath: runtimeRelativePathFromAssetKey(catalog, assetKey),
    content: loadAssetText(catalog, assetKey),
    generatedBy: 'asset' as const,
    assetKey,
  }));
}

function planCapabilityBundleFiles(catalog: AssetCatalog): PlannedFile[] {
  return resolveCapabilityBundleAssetFiles(catalog).map((bundleAssetFile) => ({
    relativePath: bundleAssetFile.runtimePath,
    content: readFileSync(bundleAssetFile.assetAbsolutePath, 'utf8'),
    generatedBy: 'asset' as const,
    assetKey: bundleAssetFile.assetRelativePath,
  }));
}

export function planMaterializedFiles(
  projectRoot: string,
  catalog: AssetCatalog,
  packageSurface: PackageSurface,
  classification: ProjectModeClassification,
): PlannedFile[] {
  const existingProjectMode = readProjectModeRecord(projectRoot);
  const classifiedAt =
    existingProjectMode &&
    existingProjectMode.mode === classification.mode &&
    existingProjectMode.reasons.join('\u0000') === classification.reasons.join('\u0000')
      ? existingProjectMode.classifiedAt
      : new Date().toISOString();

  const plannedFiles: PlannedFile[] = [
    ...planPackOwnedAssetFiles(catalog),
    {
      relativePath: VERSION_RELATIVE_PATH,
      content: `${JSON.stringify(
        {
          schemaVersion: 1,
          packageName: packageSurface.packageName,
          packageVersion: packageSurface.packageVersion,
        },
        null,
        2,
      )}\n`,
      generatedBy: 'runtime',
    },
    {
      relativePath: PROJECT_MODE_RELATIVE_PATH,
      content: `${JSON.stringify(createProjectModeRecord(projectRoot, classification, classifiedAt), null, 2)}\n`,
      generatedBy: 'runtime',
    },
  ];

  for (const commandId of COMMAND_IDS) {
    const assetKey = `commands/${commandId}`;
    plannedFiles.push({
      relativePath: `.opencode/commands/${commandId}.md`,
      content: loadAssetText(catalog, assetKey),
      generatedBy: 'asset',
      assetKey,
    });
  }

  for (const workflowSkillId of WORKFLOW_SKILL_IDS) {
    const assetKey = `opencode/skills/${workflowSkillId}`;
    plannedFiles.push({
      relativePath: `.opencode/skills/${workflowSkillId}/SKILL.md`,
      content: loadAssetText(catalog, assetKey),
      generatedBy: 'asset',
      assetKey,
    });
  }

  plannedFiles.push(...planCapabilityBundleFiles(catalog));

  return plannedFiles;
}

function writeOwnedFile(projectRoot: string, file: PlannedFile): OwnedFileRecord {
  const absolutePath = path.join(projectRoot, file.relativePath);
  assertPathIsNotSymlink(absolutePath, 'install-path-symlink', 'A pack-managed path is a symlink, so ownership is unsafe.');

  if (existsSync(absolutePath)) {
    const stat = lstatSync(absolutePath);
    if (!stat.isFile()) {
      throw new PackageSurfaceError('install-path-conflict', 'A pack-managed path already exists but is not a regular file.', {
        path: absolutePath,
        relativePath: file.relativePath,
      });
    }

    const existingContent = readFileSync(absolutePath, 'utf8');
    if (existingContent !== file.content) {
      throw new PackageSurfaceError('install-path-conflict', 'A pack-managed path already exists with different content.', {
        path: absolutePath,
        relativePath: file.relativePath,
        nextStep: 'Run `npx oh-my-akitagpb doctor` before retrying the install.',
      });
    }
  } else {
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.content, 'utf8');
  }

  return {
    kind: 'file',
    relativePath: file.relativePath,
    sha256: hashContent(file.content),
    generatedBy: file.generatedBy,
    assetKey: file.assetKey,
  };
}

function toManagedSurfaceRecord(result: ManagedSurfaceWriteResult): ManagedSurfaceRecord {
  return {
    kind: 'managed-surface',
    relativePath: result.relativePath,
    manager: result.manager,
    sha256: result.sha256,
  };
}

export function materializeFreshInstall(
  projectRoot: string,
  catalog: AssetCatalog,
  packageSurface: PackageSurface,
  classification: ProjectModeClassification,
): MaterializedInstall {
  assertPathIsNotSymlink(path.join(projectRoot, '.oma'), 'managed-root-symlink', 'The `.oma` path is a symlink, so install cannot safely continue.');
  assertPathIsNotSymlink(path.join(projectRoot, '.opencode'), 'managed-root-symlink', 'The `.opencode` path is a symlink, so install cannot safely continue.');

  const plannedFiles = planMaterializedFiles(projectRoot, catalog, packageSurface, classification);
  const ownedFiles = plannedFiles.map((file) => writeOwnedFile(projectRoot, file));

  const managedSurfaces = [
    applyManagedAgentsBlock(path.join(projectRoot, 'AGENTS.md'), packageSurface.packageName, packageSurface.packageVersion, COMMAND_IDS),
    applyManagedOpencodeConfig(path.join(projectRoot, 'opencode.json'), {
      packageName: packageSurface.packageName,
      packageVersion: packageSurface.packageVersion,
      instructions: MANAGED_INSTRUCTION_PATHS,
      commands: COMMAND_IDS.map((commandId) => `.opencode/commands/${commandId}.md`),
      skills: WORKFLOW_SKILL_IDS.map((workflowSkillId) => `.opencode/skills/${workflowSkillId}/SKILL.md`),
    }),
    applyManagedGitignoreBlock(path.join(projectRoot, '.gitignore')),
  ].map((result) => toManagedSurfaceRecord(result));

  return {
    ownedFiles,
    managedSurfaces,
  };
}
