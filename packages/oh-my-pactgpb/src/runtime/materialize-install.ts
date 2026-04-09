import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  type AssetCatalog,
  getAssetEntry,
  type PackageSurface,
  PackageSurfaceError,
} from './asset-catalog.js';
import {
  applyManagedAgentsBlock,
  applyManagedOpencodeConfig,
  hashContent,
  type ManagedSurfaceWriteResult,
} from './managed-blocks.js';
import { applyManagedGitignoreBlock } from './gitignore-block.js';
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

export const COMMAND_IDS = ['pact-scan'] as const;
export const WORKFLOW_SKILL_IDS = ['pact-scan-workflow'] as const;
export const MANAGED_INSTRUCTION_PATHS = [
  'AGENTS.md',
  '.oma/instructions/rules/manifest-first.md',
  '.oma/instructions/rules/default-language-russian.md',
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

  return [
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
      relativePath: '.oma/instructions/rules/default-language-russian.md',
      content: loadAssetText(catalog, 'oma/instructions/rules/default-language-russian'),
      generatedBy: 'asset',
      assetKey: 'oma/instructions/rules/default-language-russian',
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
      relativePath: '.oma/runtime/shared/version.json',
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
      relativePath: '.oma/runtime/local/project-mode.json',
      content: `${JSON.stringify(createProjectModeRecord(projectRoot, classification, classifiedAt), null, 2)}\n`,
      generatedBy: 'runtime',
    },
    {
      relativePath: '.opencode/commands/pact-scan.md',
      content: loadAssetText(catalog, 'commands/pact-scan'),
      generatedBy: 'asset',
      assetKey: 'commands/pact-scan',
    },
    {
      relativePath: '.opencode/skills/pact-scan-workflow/SKILL.md',
      content: loadAssetText(catalog, 'opencode/skills/pact-scan-workflow'),
      generatedBy: 'asset',
      assetKey: 'opencode/skills/pact-scan-workflow',
    },
  ];
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
        nextStep: 'Run `npx oh-my-pactgpb doctor` before retrying the install.',
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
      commands: ['.opencode/commands/pact-scan.md'],
      skills: ['.opencode/skills/pact-scan-workflow/SKILL.md'],
    }),
    applyManagedGitignoreBlock(path.join(projectRoot, '.gitignore')),
  ].map((result) => toManagedSurfaceRecord(result));

  return {
    ownedFiles,
    managedSurfaces,
  };
}
