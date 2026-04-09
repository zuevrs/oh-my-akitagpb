import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type AssetCatalog, type PackageSurface, PackageSurfaceError } from './asset-catalog.js';
import {
  applyManagedAgentsBlock,
  applyManagedOpencodeConfig,
  hashContent,
  inspectAgentsFile,
  inspectOpencodeConfig,
  renderManagedAgentsBlock,
  renderManagedAgentsFileContent,
  renderManagedOpencodeContent,
} from './managed-blocks.js';
import {
  applyManagedGitignoreBlock,
  inspectGitignoreFile,
  renderManagedGitignoreBlock,
  renderManagedGitignoreFileContent,
} from './gitignore-block.js';
import { type InstallState, type ManagedSurfaceRecord, type OwnedFileRecord } from './install-state.js';
import {
  COMMAND_IDS,
  MANAGED_INSTRUCTION_PATHS,
  planMaterializedFiles,
  type PlannedFile,
  WORKFLOW_SKILL_IDS,
} from './materialize-install.js';
import type { ProjectModeClassification } from './project-mode.js';

export interface OwnershipSafeUpdateResult {
  changedPaths: readonly string[];
  unchangedPaths: readonly string[];
  refusedPaths: readonly string[];
  ownedFiles: readonly OwnedFileRecord[];
  managedSurfaces: readonly ManagedSurfaceRecord[];
}

interface StagedOwnedWrite {
  absolutePath: string;
  content: string;
}

interface ManagedSurfaceStageOutcome {
  status: 'changed' | 'unchanged' | 'refused';
  nextRecord: ManagedSurfaceRecord;
  stagedWrite?: {
    absolutePath: string;
  };
}

interface OwnedPathInspection {
  absolutePath: string;
  status: 'missing' | 'file' | 'conflict';
  content?: string;
}

function joinPaths(paths: readonly string[]): string {
  return paths.length === 0 ? '(none)' : paths.join(', ');
}

function createManagedPayload(packageSurface: PackageSurface) {
  return {
    packageName: packageSurface.packageName,
    packageVersion: packageSurface.packageVersion,
    instructions: MANAGED_INSTRUCTION_PATHS,
    commands: COMMAND_IDS.map((commandId) => `.opencode/commands/${commandId}.md`),
    skills: WORKFLOW_SKILL_IDS.map((workflowSkillId) => `.opencode/skills/${workflowSkillId}/SKILL.md`),
  };
}

function inspectOwnedPath(projectRoot: string, relativePath: string): OwnedPathInspection {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      absolutePath,
      status: 'missing',
    };
  }

  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return {
      absolutePath,
      status: 'conflict',
    };
  }

  return {
    absolutePath,
    status: 'file',
    content: readFileSync(absolutePath, 'utf8'),
  };
}

function stageRecordedOwnedFileWrite(
  projectRoot: string,
  plannedFile: PlannedFile,
  changedPaths: string[],
  unchangedPaths: string[],
  refusedPaths: string[],
): StagedOwnedWrite | null {
  const current = inspectOwnedPath(projectRoot, plannedFile.relativePath);
  if (current.status !== 'file') {
    refusedPaths.push(plannedFile.relativePath);
    return null;
  }

  if (current.content === plannedFile.content) {
    unchangedPaths.push(plannedFile.relativePath);
    return null;
  }

  changedPaths.push(plannedFile.relativePath);
  return {
    absolutePath: current.absolutePath,
    content: plannedFile.content,
  };
}

function stageNewOwnedFileWrite(
  projectRoot: string,
  plannedFile: PlannedFile,
  changedPaths: string[],
  refusedPaths: string[],
): StagedOwnedWrite | null {
  const current = inspectOwnedPath(projectRoot, plannedFile.relativePath);

  if (current.status === 'conflict') {
    refusedPaths.push(plannedFile.relativePath);
    return null;
  }

  if (current.status === 'file') {
    if (current.content !== plannedFile.content) {
      refusedPaths.push(plannedFile.relativePath);
      return null;
    }

    changedPaths.push(plannedFile.relativePath);
    return null;
  }

  changedPaths.push(plannedFile.relativePath);
  return {
    absolutePath: current.absolutePath,
    content: plannedFile.content,
  };
}

function createAgentsManagedRecord(packageSurface: PackageSurface): ManagedSurfaceRecord {
  return {
    kind: 'managed-surface',
    relativePath: 'AGENTS.md',
    manager: 'agents-markdown',
    sha256: hashContent(renderManagedAgentsBlock(packageSurface.packageName, packageSurface.packageVersion, COMMAND_IDS)),
  };
}

function createOpencodeManagedRecord(expectedContent: string): ManagedSurfaceRecord {
  return {
    kind: 'managed-surface',
    relativePath: 'opencode.json',
    manager: 'opencode-json',
    sha256: hashContent(expectedContent),
  };
}

function createGitignoreManagedRecord(): ManagedSurfaceRecord {
  return {
    kind: 'managed-surface',
    relativePath: '.gitignore',
    manager: 'gitignore-block',
    sha256: hashContent(renderManagedGitignoreBlock()),
  };
}

function stageManagedSurfaceWrite(
  projectRoot: string,
  packageSurface: PackageSurface,
  record: InstallState['managedSurfaces'][number],
  changedPaths: string[],
  unchangedPaths: string[],
  refusedPaths: string[],
): ManagedSurfaceStageOutcome {
  const absolutePath = path.join(projectRoot, record.relativePath);

  if (record.relativePath === 'AGENTS.md') {
    const inspection = inspectAgentsFile(absolutePath);
    const nextRecord = createAgentsManagedRecord(packageSurface);
    if (inspection.state !== 'managed' || inspection.content === undefined) {
      refusedPaths.push(record.relativePath);
      return {
        status: 'refused',
        nextRecord,
      };
    }

    const expectedContent = renderManagedAgentsFileContent(
      inspection.content,
      packageSurface.packageName,
      packageSurface.packageVersion,
      COMMAND_IDS,
    );

    if (inspection.content === expectedContent) {
      unchangedPaths.push(record.relativePath);
      return {
        status: 'unchanged',
        nextRecord,
      };
    }

    changedPaths.push(record.relativePath);
    return {
      status: 'changed',
      nextRecord,
      stagedWrite: {
        absolutePath,
      },
    };
  }

  if (record.relativePath === 'opencode.json') {
    const inspection = inspectOpencodeConfig(absolutePath);
    if (inspection.state !== 'managed' || inspection.content === undefined) {
      refusedPaths.push(record.relativePath);
      return {
        status: 'refused',
        nextRecord: createOpencodeManagedRecord(''),
      };
    }

    const expectedContent = renderManagedOpencodeContent(inspection.content, createManagedPayload(packageSurface));
    const nextRecord = createOpencodeManagedRecord(expectedContent);
    if (inspection.content === expectedContent) {
      unchangedPaths.push(record.relativePath);
      return {
        status: 'unchanged',
        nextRecord,
      };
    }

    changedPaths.push(record.relativePath);
    return {
      status: 'changed',
      nextRecord,
      stagedWrite: {
        absolutePath,
      },
    };
  }

  if (record.relativePath === '.gitignore') {
    const inspection = inspectGitignoreFile(absolutePath);
    if (inspection.state === 'symlink' || inspection.state === 'malformed') {
      refusedPaths.push(record.relativePath);
      return {
        status: 'refused',
        nextRecord: createGitignoreManagedRecord(),
      };
    }

    const expectedContent = inspection.state === 'missing'
      ? renderManagedGitignoreBlock()
      : renderManagedGitignoreFileContent(inspection.content ?? '');
    const nextRecord = createGitignoreManagedRecord();
    if (inspection.state === 'managed' && inspection.content === expectedContent) {
      unchangedPaths.push(record.relativePath);
      return {
        status: 'unchanged',
        nextRecord,
      };
    }

    changedPaths.push(record.relativePath);
    return {
      status: 'changed',
      nextRecord,
      stagedWrite: {
        absolutePath,
      },
    };
  }

  throw new PackageSurfaceError('install-state-invalid', 'The install-state ledger contains an unknown managed surface entry.', {
    relativePath: record.relativePath,
  });
}

function createOwnedFileRecord(plannedFile: PlannedFile): OwnedFileRecord {
  return {
    kind: 'file',
    relativePath: plannedFile.relativePath,
    sha256: hashContent(plannedFile.content),
    generatedBy: plannedFile.generatedBy,
    assetKey: plannedFile.assetKey,
  };
}

export function applyOwnershipSafeUpdate(
  projectRoot: string,
  assetCatalog: AssetCatalog,
  packageSurface: PackageSurface,
  installState: InstallState,
  projectMode: ProjectModeClassification,
): OwnershipSafeUpdateResult {
  const plannedFiles = planMaterializedFiles(projectRoot, assetCatalog, packageSurface, projectMode);
  const plannedFileMap = new Map(plannedFiles.map((file) => [file.relativePath, file]));
  const recordedOwnedFileMap = new Map(installState.ownedFiles.map((record) => [record.relativePath, record]));

  const changedPaths: string[] = [];
  const unchangedPaths: string[] = [];
  const refusedPaths: string[] = [];
  const stagedOwnedWrites: StagedOwnedWrite[] = [];
  const stagedManagedWrites: Array<{ absolutePath: string; relativePath: string }> = [];

  for (const record of installState.ownedFiles) {
    if (!plannedFileMap.has(record.relativePath)) {
      throw new PackageSurfaceError('install-state-invalid', 'The install-state ledger references an owned file that this package no longer materializes.', {
        installStatePath: installState.installStatePath,
        relativePath: record.relativePath,
      });
    }
  }

  const nextOwnedFiles = plannedFiles.map((plannedFile) => {
    const stagedWrite = recordedOwnedFileMap.has(plannedFile.relativePath)
      ? stageRecordedOwnedFileWrite(projectRoot, plannedFile, changedPaths, unchangedPaths, refusedPaths)
      : stageNewOwnedFileWrite(projectRoot, plannedFile, changedPaths, refusedPaths);

    if (stagedWrite) {
      stagedOwnedWrites.push(stagedWrite);
    }

    return createOwnedFileRecord(plannedFile);
  });

  const nextManagedSurfaces = installState.managedSurfaces.map((record) => {
    const outcome = stageManagedSurfaceWrite(projectRoot, packageSurface, record, changedPaths, unchangedPaths, refusedPaths);
    if (outcome.status === 'changed' && outcome.stagedWrite) {
      stagedManagedWrites.push({
        absolutePath: outcome.stagedWrite.absolutePath,
        relativePath: record.relativePath,
      });
    }

    return outcome.nextRecord;
  });

  if (refusedPaths.length > 0) {
    throw new PackageSurfaceError('update-ownership-conflict', 'Update cannot safely rewrite one or more recorded bootstrap artifacts.', {
      refusedPaths: joinPaths(refusedPaths),
      changedPaths: joinPaths(changedPaths),
      unchangedPaths: joinPaths(unchangedPaths),
      nextStep: 'Run `npx oh-my-akitagpb doctor` before retrying the update.',
    });
  }

  for (const stagedWrite of stagedOwnedWrites) {
    mkdirSync(path.dirname(stagedWrite.absolutePath), { recursive: true });
    writeFileSync(stagedWrite.absolutePath, stagedWrite.content, 'utf8');
  }

  for (const stagedWrite of stagedManagedWrites) {
    if (stagedWrite.relativePath === 'AGENTS.md') {
      applyManagedAgentsBlock(
        stagedWrite.absolutePath,
        packageSurface.packageName,
        packageSurface.packageVersion,
        COMMAND_IDS,
      );
      continue;
    }

    if (stagedWrite.relativePath === 'opencode.json') {
      applyManagedOpencodeConfig(stagedWrite.absolutePath, createManagedPayload(packageSurface));
      continue;
    }

    applyManagedGitignoreBlock(stagedWrite.absolutePath);
  }

  return {
    changedPaths,
    unchangedPaths,
    refusedPaths,
    ownedFiles: nextOwnedFiles,
    managedSurfaces: nextManagedSurfaces,
  };
}
