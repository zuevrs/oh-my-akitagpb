import type { CliResult } from '../cli.js';
import type { AssetCatalog, PackageSurface, SupportedSubcommand } from '../runtime/asset-catalog.js';
import { buildDoctorReport, writeDoctorReport } from '../runtime/doctor-report.js';

interface ExecuteDoctorOptions {
  cwd: string;
  packageSurface: PackageSurface;
  assetCatalog: AssetCatalog;
}

function buildResult(
  subcommand: SupportedSubcommand,
  options: ExecuteDoctorOptions,
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

export function executeDoctorCommand(options: ExecuteDoctorOptions): CliResult {
  const report = writeDoctorReport(options.cwd, buildDoctorReport(options.cwd, options.packageSurface));
  const detailMap = {
    doctorStatus: report.status,
    reportPath: report.reportPath,
    findingCount: String(report.findings.length),
    conflictCount: String(report.ownership.conflicts.length),
    ownedModifiedCount: String(report.drift.ownedModified.length),
    ownedMissingCount: String(report.drift.ownedMissing.length),
    managedModifiedCount: String(report.drift.managedModified.length),
    packageVersionMismatch: String(report.drift.packageVersionMismatch),
  };

  if (report.status === 'blocked') {
    return buildResult(
      'doctor',
      options,
      'blocked',
      'doctor-blocked',
      report.summary,
      report.nextStep,
      detailMap,
    );
  }

  if (report.status === 'migrate-required') {
    return buildResult(
      'doctor',
      options,
      'ok',
      'doctor-migrate-required',
      report.summary,
      report.nextStep,
      detailMap,
    );
  }

  return buildResult(
    'doctor',
    options,
    'ok',
    'doctor-compatible',
    report.summary,
    report.nextStep,
    detailMap,
  );
}
