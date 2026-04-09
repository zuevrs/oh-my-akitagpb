#!/usr/bin/env node

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPPORTED_SUBCOMMANDS,
  assertBuildSurface,
  createAssetCatalog,
  PackageSurfaceError,
  readPackageSurface,
  type SupportedSubcommand,
} from './runtime/asset-catalog.js';
import { executeInstallCommand } from './commands/install.js';
import { executeUpdateCommand } from './commands/update.js';
import { executeDoctorCommand } from './commands/doctor.js';

export type CliStatus = 'ok' | 'blocked' | 'error';

export interface CliResult {
  subcommand: SupportedSubcommand | 'unknown';
  status: CliStatus;
  reason: string;
  message: string;
  cwd: string | null;
  packageName?: string;
  packageVersion?: string;
  packageRoot?: string;
  binPath?: string;
  availableSubcommands: readonly SupportedSubcommand[];
  usage?: readonly string[];
  assetCatalogRoot?: string;
  assetCatalogEntries?: readonly string[];
  nextStep?: string;
  details?: Record<string, string>;
}

interface ParsedArguments {
  subcommand: string | undefined;
  cwd: string;
}

function usageLines(): readonly string[] {
  return ['Usage: oh-my-pactgpb <install|update|doctor> [--cwd <path>]', 'Example: oh-my-pactgpb install --cwd .'];
}

function isSupportedSubcommand(value: string): value is SupportedSubcommand {
  return (SUPPORTED_SUBCOMMANDS as readonly string[]).includes(value);
}

function parseArguments(argv: readonly string[], currentWorkingDirectory: string): ParsedArguments {
  let subcommand: string | undefined;
  let cwd = currentWorkingDirectory;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined) {
      continue;
    }

    if (token === '--cwd') {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new PackageSurfaceError('cwd-argument-missing', 'The --cwd option requires a path value.');
      }

      cwd = path.resolve(currentWorkingDirectory, nextValue);
      index += 1;
      continue;
    }

    if (!subcommand) {
      subcommand = token;
      continue;
    }

    throw new PackageSurfaceError('unexpected-argument', `Unexpected argument "${token}".`, {
      token,
    });
  }

  return { subcommand, cwd };
}

function validateWorkingDirectory(cwd: string): void {
  if (!existsSync(cwd)) {
    throw new PackageSurfaceError('working-directory-missing', 'The requested working directory does not exist.', {
      cwd,
    });
  }

  const stat = lstatSync(cwd);
  if (!stat.isDirectory()) {
    throw new PackageSurfaceError('working-directory-invalid', 'The requested working directory is not a directory.', {
      cwd,
    });
  }
}

function toErrorResult(error: unknown, cwd: string | null, subcommand: string | undefined): CliResult {
  if (error instanceof PackageSurfaceError) {
    return {
      subcommand: subcommand && isSupportedSubcommand(subcommand) ? subcommand : 'unknown',
      status: 'error',
      reason: error.code,
      message: error.message,
      cwd,
      availableSubcommands: SUPPORTED_SUBCOMMANDS,
      usage: usageLines(),
      details: error.details,
    };
  }

  return {
    subcommand: subcommand && isSupportedSubcommand(subcommand) ? subcommand : 'unknown',
    status: 'error',
    reason: 'unhandled-exception',
    message: error instanceof Error ? error.message : 'An unknown error occurred.',
    cwd,
    availableSubcommands: SUPPORTED_SUBCOMMANDS,
    usage: usageLines(),
  };
}

function executeLifecycleCommand(subcommand: SupportedSubcommand, cwd: string): CliResult {
  const surface = assertBuildSurface(readPackageSurface());
  const assetCatalog = createAssetCatalog(surface.packageRoot);

  if (subcommand === 'install') {
    return executeInstallCommand({
      cwd,
      packageSurface: surface,
      assetCatalog,
    });
  }

  if (subcommand === 'update') {
    return executeUpdateCommand({
      cwd,
      packageSurface: surface,
      assetCatalog,
    });
  }

  if (subcommand === 'doctor') {
    return executeDoctorCommand({
      cwd,
      packageSurface: surface,
      assetCatalog,
    });
  }

  return {
    subcommand,
    status: 'blocked',
    reason: 'command-not-implemented',
    message: `${subcommand} is routed through the published CLI, but lifecycle behavior is not implemented yet.`,
    cwd,
    packageName: surface.packageName,
    packageVersion: surface.packageVersion,
    packageRoot: surface.packageRoot,
    binPath: surface.binPath,
    availableSubcommands: SUPPORTED_SUBCOMMANDS,
    assetCatalogRoot: assetCatalog.assetsRoot,
    assetCatalogEntries: Object.keys(assetCatalog.entries),
    nextStep: `Implement the ${subcommand} runtime before relying on this command for bootstrap lifecycle work.`,
  };
}

export function executeCli(argv: readonly string[], currentWorkingDirectory: string = process.cwd()): CliResult {
  let parsedSubcommand: string | undefined;
  let parsedCwd: string | null = currentWorkingDirectory;

  try {
    const parsed = parseArguments(argv, currentWorkingDirectory);
    parsedSubcommand = parsed.subcommand;
    parsedCwd = parsed.cwd;

    validateWorkingDirectory(parsed.cwd);

    if (!parsed.subcommand) {
      throw new PackageSurfaceError('subcommand-missing', 'A subcommand is required.', {
        cwd: parsed.cwd,
      });
    }

    if (!isSupportedSubcommand(parsed.subcommand)) {
      throw new PackageSurfaceError('unknown-subcommand', `Unknown subcommand "${parsed.subcommand}".`, {
        subcommand: parsed.subcommand,
      });
    }

    return executeLifecycleCommand(parsed.subcommand, parsed.cwd);
  } catch (error) {
    return toErrorResult(error, parsedCwd, parsedSubcommand);
  }
}

export function exitCodeForResult(result: CliResult): number {
  if (result.status === 'ok') {
    return 0;
  }

  if (result.status === 'blocked') {
    return 2;
  }

  return 1;
}

export function renderResult(result: CliResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2), currentWorkingDirectory: string = process.cwd()): Promise<number> {
  const result = executeCli(argv, currentWorkingDirectory);
  process.stdout.write(renderResult(result));
  return exitCodeForResult(result);
}

function isDirectExecution(moduleUrl: string): boolean {
  if (!process.argv[1]) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);

  try {
    return realpathSync(process.argv[1]) === realpathSync(modulePath);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(modulePath);
  }
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
