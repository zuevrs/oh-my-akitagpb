import type { CliResult } from '../cli.js';
import { type AssetCatalog, type PackageSurface, PackageSurfaceError, type SupportedSubcommand } from '../runtime/asset-catalog.js';
import { assessUpdateCompatibility } from '../runtime/compatibility.js';
import { writeInstallState } from '../runtime/install-state.js';
import { applyOwnershipSafeUpdate } from '../runtime/ownership.js';

interface ExecuteUpdateOptions {
  cwd: string;
  packageSurface: PackageSurface;
  assetCatalog: AssetCatalog;
}

function serializePaths(paths: readonly string[]): string {
  return paths.length === 0 ? '(none)' : paths.join(', ');
}

function buildResult(
  subcommand: SupportedSubcommand,
  options: ExecuteUpdateOptions,
  status: CliResult['status'],
  reason: string,
  message: string,
  nextStep: string,
  details: Record<string, string>,
): CliResult {
  return {
    subcommand,
    status,
    reason,
    message,
    cwd: options.cwd,
    packageName: options.packageSurface.packageName,
    packageVersion: options.packageSurface.packageVersion,
    packageRoot: options.packageSurface.packageRoot,
    binPath: options.packageSurface.binPath,
    availableSubcommands: ['install', 'update', 'doctor'],
    assetCatalogRoot: options.assetCatalog.assetsRoot,
    assetCatalogEntries: Object.keys(options.assetCatalog.entries),
    nextStep,
    details,
  };
}

export function executeUpdateCommand(options: ExecuteUpdateOptions): CliResult {
  const compatibility = assessUpdateCompatibility(options.cwd, options.packageSurface);
  if (compatibility.classification !== 'update-required' || !compatibility.installState) {
    return buildResult(
      'update',
      options,
      'blocked',
      compatibility.reason,
      compatibility.message,
      compatibility.nextStep,
      compatibility.details,
    );
  }

  try {
    const updated = applyOwnershipSafeUpdate(
      options.cwd,
      options.assetCatalog,
      options.packageSurface,
      compatibility.installState,
      compatibility.projectMode,
    );

    const installState = writeInstallState(options.cwd, {
      schemaVersion: 1,
      packageName: options.packageSurface.packageName,
      packageVersion: options.packageSurface.packageVersion,
      projectRoot: options.cwd,
      projectMode: compatibility.projectMode.mode,
      installedAt: new Date().toISOString(),
      ownedFiles: updated.ownedFiles,
      managedSurfaces: updated.managedSurfaces,
    });

    const changedPaths = serializePaths(updated.changedPaths);
    const unchangedPaths = serializePaths(updated.unchangedPaths);
    const details = {
      classification: compatibility.classification,
      installStatePath: installState.installStatePath,
      changedPaths,
      unchangedPaths,
      refusedPaths: serializePaths(updated.refusedPaths),
      changedCount: String(updated.changedPaths.length),
      unchangedCount: String(updated.unchangedPaths.length),
      refusedCount: String(updated.refusedPaths.length),
    };

    if (updated.changedPaths.length === 0) {
      return buildResult(
        'update',
        options,
        'ok',
        'update-noop',
        'All recorded pack-owned artifacts already match the current package surface.',
        'Run `npx oh-my-pactgpb doctor` if you expected different bootstrap content.',
        details,
      );
    }

    return buildResult(
      'update',
      options,
      'ok',
      'update-complete',
      'Recorded pack-owned artifacts were refreshed successfully.',
      'Open OpenCode in this repo and run `/pact-scan`.',
      details,
    );
  } catch (error) {
    if (error instanceof PackageSurfaceError) {
      return buildResult(
        'update',
        options,
        'blocked',
        error.code,
        error.message,
        error.details?.nextStep ?? 'Run `npx oh-my-pactgpb doctor` before retrying.',
        {
          classification: error.code === 'update-ownership-conflict' ? 'conflict' : 'blocked',
          ...error.details,
        },
      );
    }

    throw error;
  }
}
