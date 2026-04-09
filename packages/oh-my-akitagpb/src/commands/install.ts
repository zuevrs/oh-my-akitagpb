import path from 'node:path';

import type { CliResult } from '../cli.js';
import { type AssetCatalog, type PackageSurface, PackageSurfaceError, type SupportedSubcommand } from '../runtime/asset-catalog.js';
import { assessInstallCompatibility } from '../runtime/compatibility.js';
import { writeInstallState } from '../runtime/install-state.js';
import { inspectAgentsFile, inspectOpencodeConfig } from '../runtime/managed-blocks.js';
import { materializeFreshInstall } from '../runtime/materialize-install.js';

interface ExecuteInstallOptions {
  cwd: string;
  packageSurface: PackageSurface;
  assetCatalog: AssetCatalog;
}

function buildBlockedResult(
  subcommand: SupportedSubcommand,
  options: ExecuteInstallOptions,
  reason: string,
  message: string,
  nextStep: string,
  details: Record<string, string>,
): CliResult {
  return {
    subcommand,
    status: 'blocked',
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

export function executeInstallCommand(options: ExecuteInstallOptions): CliResult {
  const compatibility = assessInstallCompatibility(options.cwd, options.packageSurface);
  if (compatibility.classification !== 'fresh') {
    return buildBlockedResult(
      'install',
      options,
      compatibility.reason,
      compatibility.message,
      compatibility.nextStep,
      compatibility.details,
    );
  }

  const agentsInspection = inspectAgentsFile(path.join(options.cwd, 'AGENTS.md'));
  if (agentsInspection.state === 'user-owned' || agentsInspection.state === 'malformed' || agentsInspection.state === 'symlink') {
    return buildBlockedResult(
      'install',
      options,
      `install-${agentsInspection.state}-agents`,
      'AGENTS.md cannot be safely claimed for pack-managed wiring during install.',
      'Move the conflicting file aside, clear it, or run `npx oh-my-akitagpb doctor` before retrying.',
      {
        classification: 'blocked',
        path: path.join(options.cwd, 'AGENTS.md'),
        inspection: agentsInspection.state,
      },
    );
  }

  const opencodeInspection = inspectOpencodeConfig(path.join(options.cwd, 'opencode.json'));
  if (opencodeInspection.state === 'user-owned' || opencodeInspection.state === 'malformed' || opencodeInspection.state === 'symlink') {
    return buildBlockedResult(
      'install',
      options,
      `install-${opencodeInspection.state}-opencode`,
      'opencode.json cannot be safely claimed for pack-managed wiring during install.',
      'Move the conflicting file aside, clear it, or run `npx oh-my-akitagpb doctor` before retrying.',
      {
        classification: 'blocked',
        path: path.join(options.cwd, 'opencode.json'),
        inspection: opencodeInspection.state,
      },
    );
  }

  try {
    const materialized = materializeFreshInstall(options.cwd, options.assetCatalog, options.packageSurface, compatibility.projectMode);
    const installState = writeInstallState(options.cwd, {
      schemaVersion: 1,
      packageName: options.packageSurface.packageName,
      packageVersion: options.packageSurface.packageVersion,
      projectRoot: options.cwd,
      projectMode: compatibility.projectMode.mode,
      installedAt: new Date().toISOString(),
      ownedFiles: materialized.ownedFiles,
      managedSurfaces: materialized.managedSurfaces,
    });

    return {
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
      message: 'Fresh bootstrap surfaces were materialized successfully.',
      cwd: options.cwd,
      packageName: options.packageSurface.packageName,
      packageVersion: options.packageSurface.packageVersion,
      packageRoot: options.packageSurface.packageRoot,
      binPath: options.packageSurface.binPath,
      availableSubcommands: ['install', 'update', 'doctor'],
      assetCatalogRoot: options.assetCatalog.assetsRoot,
      assetCatalogEntries: Object.keys(options.assetCatalog.entries),
      nextStep: 'Open OpenCode in this repo and run `/akita-scan`.',
      details: {
        classification: 'fresh',
        projectMode: compatibility.projectMode.mode,
        installStatePath: installState.installStatePath,
        ownedFileCount: String(materialized.ownedFiles.length),
        managedSurfaceCount: String(materialized.managedSurfaces.length),
      },
    };
  } catch (error) {
    if (error instanceof PackageSurfaceError) {
      return buildBlockedResult(
        'install',
        options,
        error.code,
        error.message,
        error.details?.nextStep ?? 'Run `npx oh-my-akitagpb doctor` before retrying.',
        {
          classification: 'blocked',
          ...error.details,
        },
      );
    }

    throw error;
  }
}
