import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { PackageSurfaceError } from './asset-catalog.js';

export interface OwnedFileRecord {
  kind: 'file';
  relativePath: string;
  sha256: string;
  generatedBy: 'asset' | 'runtime';
  assetKey?: string;
}

export interface ManagedSurfaceRecord {
  kind: 'managed-surface';
  relativePath: string;
  manager: 'agents-markdown' | 'opencode-json' | 'gitignore-block';
  sha256: string;
}

export interface InstallState {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  projectRoot: string;
  installStatePath: string;
  projectMode: 'fresh' | 'resume';
  installedAt: string;
  ownedFiles: readonly OwnedFileRecord[];
  managedSurfaces: readonly ManagedSurfaceRecord[];
}

export function resolveInstallStatePath(projectRoot: string): string {
  return path.join(projectRoot, '.oma', 'install-state.json');
}

export function hasInstallState(projectRoot: string): boolean {
  return existsSync(resolveInstallStatePath(projectRoot));
}

export function writeInstallState(projectRoot: string, state: Omit<InstallState, 'installStatePath'>): InstallState {
  const installStatePath = resolveInstallStatePath(projectRoot);
  mkdirSync(path.dirname(installStatePath), { recursive: true });

  const payload: InstallState = {
    ...state,
    installStatePath,
  };

  writeFileSync(installStatePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function isOwnedFileRecord(value: unknown): value is OwnedFileRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<OwnedFileRecord>;
  return (
    record.kind === 'file' &&
    typeof record.relativePath === 'string' &&
    record.relativePath.length > 0 &&
    typeof record.sha256 === 'string' &&
    record.sha256.length > 0 &&
    (record.generatedBy === 'asset' || record.generatedBy === 'runtime') &&
    (record.assetKey === undefined || typeof record.assetKey === 'string')
  );
}

function isManagedSurfaceRecord(value: unknown): value is ManagedSurfaceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<ManagedSurfaceRecord>;
  return (
    record.kind === 'managed-surface' &&
    typeof record.relativePath === 'string' &&
    record.relativePath.length > 0 &&
    typeof record.sha256 === 'string' &&
    record.sha256.length > 0 &&
    (record.manager === 'agents-markdown' || record.manager === 'opencode-json' || record.manager === 'gitignore-block')
  );
}

function assertUniqueRelativePaths(records: readonly { relativePath: string }[], installStatePath: string, field: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.relativePath)) {
      throw new PackageSurfaceError('install-state-invalid', 'The install-state ledger contains duplicate ownership entries.', {
        installStatePath,
        field,
        relativePath: record.relativePath,
      });
    }
    seen.add(record.relativePath);
  }
}

export function readInstallState(projectRoot: string): InstallState {
  const installStatePath = resolveInstallStatePath(projectRoot);

  if (!existsSync(installStatePath)) {
    throw new PackageSurfaceError('install-state-missing', 'The install-state ledger is missing.', {
      installStatePath,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(installStatePath, 'utf8'));
  } catch (error) {
    throw new PackageSurfaceError('install-state-invalid', 'The install-state ledger is not valid JSON.', {
      installStatePath,
      cause: error instanceof Error ? error.message : 'unknown parse failure',
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new PackageSurfaceError('install-state-invalid', 'The install-state ledger must contain an object.', {
      installStatePath,
    });
  }

  const record = parsed as Partial<InstallState>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.packageName !== 'string' ||
    typeof record.packageVersion !== 'string' ||
    typeof record.projectRoot !== 'string' ||
    typeof record.installStatePath !== 'string' ||
    (record.projectMode !== 'fresh' && record.projectMode !== 'resume') ||
    typeof record.installedAt !== 'string' ||
    !Array.isArray(record.ownedFiles) ||
    !Array.isArray(record.managedSurfaces)
  ) {
    throw new PackageSurfaceError('install-state-invalid', 'The install-state ledger is missing required fields.', {
      installStatePath,
    });
  }

  if (!record.ownedFiles.every((entry) => isOwnedFileRecord(entry)) || !record.managedSurfaces.every((entry) => isManagedSurfaceRecord(entry))) {
    throw new PackageSurfaceError('install-state-invalid', 'The install-state ledger contains unknown ownership entries.', {
      installStatePath,
    });
  }

  assertUniqueRelativePaths(record.ownedFiles, installStatePath, 'ownedFiles');
  assertUniqueRelativePaths(record.managedSurfaces, installStatePath, 'managedSurfaces');

  return record as InstallState;
}
