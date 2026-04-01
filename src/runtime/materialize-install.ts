import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  type AssetCatalog,
  getAssetEntry,
  type PackageSurface,
  PackageSurfaceError,
  resolveCapabilityBundleAssetFiles,
} from './asset-catalog.js';
import {
  applyManagedAgentsBlock,
  applyManagedOpencodeConfig,
  hashContent,
  type ManagedSurfaceWriteResult,
} from './managed-blocks.js';
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

export const COMMAND_IDS = ['akita-scan', 'akita-plan', 'akita-write', 'akita-validate'] as const;
export const WORKFLOW_SKILL_IDS = [
  'akita-scan-workflow',
  'akita-plan-workflow',
  'akita-write-workflow',
  'akita-validate-workflow',
] as const;
export const MANAGED_INSTRUCTION_PATHS = [
  'AGENTS.md',
  '.oma/instructions/rules/manifest-first.md',
  '.oma/instructions/rules/never-invent-steps.md',
  '.oma/instructions/rules/redact-shared-state.md',
  '.oma/instructions/rules/prefer-existing-prior-art.md',
  '.oma/instructions/rules/explicit-unsupported.md',
  '.oma/instructions/rules/respect-pack-ownership.md',
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
    {
      relativePath: '.oma/capability-manifest.json',
      content: loadAssetText(catalog, 'oma/capability-manifest'),
      generatedBy: 'asset',
      assetKey: 'oma/capability-manifest',
    },
    {
      relativePath: '.oma/runtime/shared/data-handling-policy.json',
      content: loadAssetText(catalog, 'oma/runtime/shared/data-handling-policy'),
      generatedBy: 'asset',
      assetKey: 'oma/runtime/shared/data-handling-policy',
    },
    {
      relativePath: '.oma/instructions/rules/manifest-first.md',
      content: loadAssetText(catalog, 'oma/instructions/rules/manifest-first'),
      generatedBy: 'asset',
      assetKey: 'oma/instructions/rules/manifest-first',
    },
    {
      relativePath: '.oma/instructions/rules/never-invent-steps.md',
      content: loadAssetText(catalog, 'oma/instructions/rules/never-invent-steps'),
      generatedBy: 'asset',
      assetKey: 'oma/instructions/rules/never-invent-steps',
    },
    {
      relativePath: '.oma/instructions/rules/redact-shared-state.md',
      content: loadAssetText(catalog, 'oma/instructions/rules/redact-shared-state'),
      generatedBy: 'asset',
      assetKey: 'oma/instructions/rules/redact-shared-state',
    },
    {
      relativePath: '.oma/instructions/rules/prefer-existing-prior-art.md',
      content: loadAssetText(catalog, 'oma/instructions/rules/prefer-existing-prior-art'),
      generatedBy: 'asset',
      assetKey: 'oma/instructions/rules/prefer-existing-prior-art',
    },
    {
      relativePath: '.oma/instructions/rules/explicit-unsupported.md',
      content: loadAssetText(catalog, 'oma/instructions/rules/explicit-unsupported'),
      generatedBy: 'asset',
      assetKey: 'oma/instructions/rules/explicit-unsupported',
    },
    {
      relativePath: '.oma/instructions/rules/respect-pack-ownership.md',
      content: loadAssetText(catalog, 'oma/instructions/rules/respect-pack-ownership'),
      generatedBy: 'asset',
      assetKey: 'oma/instructions/rules/respect-pack-ownership',
    },
    {
      relativePath: '.oma/templates/feature/README.md',
      content: loadAssetText(catalog, 'oma/templates/feature/README'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/feature/README',
    },
    {
      relativePath: '.oma/templates/feature/default.feature.md',
      content: loadAssetText(catalog, 'oma/templates/feature/default'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/feature/default',
    },
    {
      relativePath: '.oma/templates/feature/with-background.feature.md',
      content: loadAssetText(catalog, 'oma/templates/feature/with-background'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/feature/with-background',
    },
    {
      relativePath: '.oma/templates/feature/with-omissions-note.feature.md',
      content: loadAssetText(catalog, 'oma/templates/feature/with-omissions-note'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/feature/with-omissions-note',
    },
    {
      relativePath: '.oma/templates/payload/README.md',
      content: loadAssetText(catalog, 'oma/templates/payload/README'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/payload/README',
    },
    {
      relativePath: '.oma/templates/payload/json-body.md',
      content: loadAssetText(catalog, 'oma/templates/payload/json-body'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/payload/json-body',
    },
    {
      relativePath: '.oma/templates/payload/property-file.md',
      content: loadAssetText(catalog, 'oma/templates/payload/property-file'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/payload/property-file',
    },
    {
      relativePath: '.oma/templates/payload/minimal-fixture.md',
      content: loadAssetText(catalog, 'oma/templates/payload/minimal-fixture'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/payload/minimal-fixture',
    },
    {
      relativePath: '.oma/templates/scan/state-contract.json',
      content: loadAssetText(catalog, 'oma/templates/scan/state-contract'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/scan/state-contract',
    },
    {
      relativePath: '.oma/templates/scan/scan-summary.md',
      content: loadAssetText(catalog, 'oma/templates/scan/scan-summary'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/scan/scan-summary',
    },
    {
      relativePath: '.oma/templates/plan/state-contract.json',
      content: loadAssetText(catalog, 'oma/templates/plan/state-contract'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/plan/state-contract',
    },
    {
      relativePath: '.oma/templates/plan/plan-summary.md',
      content: loadAssetText(catalog, 'oma/templates/plan/plan-summary'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/plan/plan-summary',
    },
    {
      relativePath: '.oma/templates/write/state-contract.json',
      content: loadAssetText(catalog, 'oma/templates/write/state-contract'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/write/state-contract',
    },
    {
      relativePath: '.oma/templates/write/write-summary.md',
      content: loadAssetText(catalog, 'oma/templates/write/write-summary'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/write/write-summary',
    },
    {
      relativePath: '.oma/templates/validate/state-contract.json',
      content: loadAssetText(catalog, 'oma/templates/validate/state-contract'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/validate/state-contract',
    },
    {
      relativePath: '.oma/templates/validate/validate-summary.md',
      content: loadAssetText(catalog, 'oma/templates/validate/validate-summary'),
      generatedBy: 'asset',
      assetKey: 'oma/templates/validate/validate-summary',
    },
    {
      relativePath: '.oma/runtime/shared/version.json',
      content: `${JSON.stringify({
        schemaVersion: 1,
        packageName: packageSurface.packageName,
        packageVersion: packageSurface.packageVersion,
      }, null, 2)}\n`,
      generatedBy: 'runtime',
    },
    {
      relativePath: '.oma/runtime/local/project-mode.json',
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
  ].map((result) => toManagedSurfaceRecord(result));

  return {
    ownedFiles,
    managedSurfaces,
  };
}
